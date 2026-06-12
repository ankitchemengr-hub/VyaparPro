import { pool } from "@workspace/db";
import { logger } from "./logger";

// Alert thresholds (days before expiry) → alert type label.
const THRESHOLDS: { days: number; type: string }[] = [
  { days: 30, type: "expiry_30" },
  { days: 15, type: "expiry_15" },
  { days: 7, type: "expiry_7" },
  { days: 3, type: "expiry_3" },
  { days: 0, type: "expiry_today" },
];

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

    // 3. Generate threshold alerts for active subscriptions.
    const { rows } = await pool.query(
      `SELECT s.id, s.company_id, s.subscription_end_date, c.name AS company_name
       FROM subscriptions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.subscription_status = 'active'`
    );

    const now = new Date();
    for (const sub of rows) {
      const end = new Date(sub.subscription_end_date);
      const daysRemaining = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const match = THRESHOLDS.find((t) => t.days === daysRemaining);
      if (!match) continue;

      const message =
        daysRemaining === 0
          ? `${sub.company_name}'s subscription expires today.`
          : `${sub.company_name}'s subscription expires in ${daysRemaining} day(s).`;

      await emitAlertOnce(sub.company_id, sub.id, match.type, message, daysRemaining);
    }

    // 4. Generate an "expired" alert (once) for subscriptions that just expired.
    const expiredRows = await pool.query(
      `SELECT s.id, s.company_id, c.name AS company_name
       FROM subscriptions s
       JOIN companies c ON c.id = s.company_id
       WHERE s.subscription_status = 'expired'`
    );
    for (const sub of expiredRows.rows) {
      await emitAlertOnce(
        sub.company_id,
        sub.id,
        "expired",
        `${sub.company_name}'s subscription has expired.`,
        0
      );
    }

    logger.info("Subscription maintenance completed");
  } catch (err) {
    logger.error({ err }, "Subscription maintenance failed");
  }
}

// Insert an alert at most once per (subscription, type). Race-safe: relies on the
// subscription_alert_type_unique index so overlapping scheduler runs can't double-insert.
async function emitAlertOnce(
  companyId: number,
  subscriptionId: number,
  alertType: string,
  message: string,
  daysRemaining: number
): Promise<void> {
  await pool.query(
    `INSERT INTO subscription_alerts (company_id, subscription_id, alert_type, message, days_remaining)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subscription_id, alert_type) DO NOTHING`,
    [companyId, subscriptionId, alertType, message, daysRemaining]
  );
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
