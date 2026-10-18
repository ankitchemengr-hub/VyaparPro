import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendExpiryEmail } from "./customer-emails";

// Alert thresholds (days before expiry) → alert type label, smallest first.
const THRESHOLDS: { days: number; type: string }[] = [
  { days: 0, type: "expiry_today" },
  { days: 1, type: "expiry_1" },
  { days: 3, type: "expiry_3" },
  { days: 7, type: "expiry_7" },
  { days: 15, type: "expiry_15" },
  { days: 30, type: "expiry_30" },
];

// Which alerts also email the customer — short and close to the date, so the
// reminder is useful rather than noise. (30/15-day ones stay admin-only.)
const EMAILED_TYPES = new Set(["expiry_7", "expiry_3", "expiry_1", "expiry_today", "expired"]);

// Don't email "expired" to tenants that lapsed long ago (e.g. the first run
// after this feature ships) — only to ones that just ran out.
const EXPIRED_EMAIL_WINDOW_DAYS = 3;

// Calendar date in India ("YYYY-MM-DD") — reminders count whole days the way
// the customer does, not 24-hour blocks from whenever the job happens to run.
const istDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
function daysUntil(end: Date, now = new Date()): number {
  return Math.round((Date.parse(istDate(end)) - Date.parse(istDate(now))) / 86_400_000);
}

// Runs the daily maintenance: expire lapsed subs, mark overdue payments,
// and emit idempotent alerts for upcoming/passed expiries.
export async function runSubscriptionMaintenance(): Promise<void> {
  try {
    // 1. Expire active subscriptions whose end date has passed.
    await pool.query(
      `UPDATE subscriptions
       SET subscription_status = 'expired', updated_at = NOW()
       WHERE subscription_status = 'active'
         AND subscription_end_date < NOW()`
    );

    // 2. Mark unpaid subscriptions whose due date has passed as overdue.
    await pool.query(
      `UPDATE subscriptions
       SET payment_status = 'overdue', updated_at = NOW()
       WHERE payment_status = 'pending'
         AND next_due_date IS NOT NULL
         AND next_due_date < NOW()`
    );

    // 3. Threshold alerts (+ customer email) for active subscriptions. Picks
    // the tightest threshold the subscription is inside, so a day the job
    // didn't run (server down) still gets its reminder the next day.
    const { rows } = await pool.query(
      `SELECT s.id, s.company_id, s.subscription_end_date, s.payment_status, c.name AS company_name
       FROM subscriptions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.subscription_status = 'active'`
    );

    for (const sub of rows) {
      const end = new Date(sub.subscription_end_date);
      const daysRemaining = daysUntil(end);
      if (daysRemaining < 0) continue;

      const match = THRESHOLDS.find((t) => daysRemaining <= t.days);
      if (!match) continue;

      const message =
        daysRemaining === 0
          ? `${sub.company_name}'s subscription expires today.`
          : `${sub.company_name}'s subscription expires in ${daysRemaining} day(s).`;

      const alertId = await emitAlertOnce(sub.company_id, sub.id, match.type, message, daysRemaining, end);
      if (alertId && EMAILED_TYPES.has(match.type)) {
        const sent = await sendExpiryEmail({
          companyId: sub.company_id, daysRemaining, endDate: end,
          isTrial: sub.payment_status !== "paid", expired: false,
        });
        if (sent) await markEmailed(alertId);
      }
    }

    // 4. An "expired" alert (once per period) for expired subscriptions; the
    // customer is emailed only if it ran out in the last few days.
    const expiredRows = await pool.query(
      `SELECT s.id, s.company_id, s.subscription_end_date, s.payment_status, c.name AS company_name
       FROM subscriptions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.subscription_status = 'expired'`
    );
    for (const sub of expiredRows.rows) {
      const end = new Date(sub.subscription_end_date);
      const alertId = await emitAlertOnce(
        sub.company_id,
        sub.id,
        "expired",
        `${sub.company_name}'s subscription has expired.`,
        0,
        end,
      );
      if (alertId && -daysUntil(end) <= EXPIRED_EMAIL_WINDOW_DAYS) {
        const sent = await sendExpiryEmail({
          companyId: sub.company_id, daysRemaining: 0, endDate: end,
          isTrial: sub.payment_status !== "paid", expired: true,
        });
        if (sent) await markEmailed(alertId);
      }
    }

    logger.info("Subscription maintenance completed");
  } catch (err) {
    logger.error({ err }, "Subscription maintenance failed");
  }
}

// Insert an alert at most once per (subscription, type, billing period) and
// return its id — or null if it already existed, so the caller emails only
// on the first insert. Keyed by the period's end date so a renewed
// subscription gets a fresh set of reminders for its next expiry. Race-safe:
// relies on the subscription_alert_period_unique index (bootstrap.ts).
async function emitAlertOnce(
  companyId: number,
  subscriptionId: number,
  alertType: string,
  message: string,
  daysRemaining: number,
  periodEnd: Date,
): Promise<number | null> {
  const { rows } = await pool.query(
    `INSERT INTO subscription_alerts (company_id, subscription_id, alert_type, message, days_remaining, period_end)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     ON CONFLICT (subscription_id, alert_type, period_end) DO NOTHING
     RETURNING id`,
    [companyId, subscriptionId, alertType, message, daysRemaining, istDate(periodEnd)]
  );
  return rows[0]?.id ?? null;
}

async function markEmailed(alertId: number): Promise<void> {
  await pool.query(`UPDATE subscription_alerts SET emailed_at = NOW() WHERE id = $1`, [alertId]);
}

let timer: NodeJS.Timeout | null = null;

// Starts the scheduler: runs once on boot, then every day at local midnight.
export function startSubscriptionScheduler(): void {
  void runSubscriptionMaintenance();

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0); // next local midnight
    const delay = next.getTime() - now.getTime();
    timer = setTimeout(() => {
      void runSubscriptionMaintenance();
      scheduleNext();
    }, delay);
  };

  scheduleNext();
  logger.info("Subscription scheduler started");
}
