import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, pool, usersTable } from "@workspace/db";
import {
  CreateSubscriptionBody,
  ChangeSubscriptionPlanBody,
  UpdateSubscriptionBody,
} from "@workspace/api-zod";
import { COMPANY_TABLES } from "../lib/company-data";

const router: IRouter = Router();

const PLAN_MONTHS: Record<string, number> = {
  trial: 0,
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

// The subscription/company registry is the PLATFORM console — it spans all
// tenants, so only the cross-company super_admin may touch it. Re-check the DB
// on every call so a stale cookie role can't grant access.
async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [current] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  if (!current || !current.isActive || current.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only" });
    return;
  }
  next();
}

// Every route in this router is super_admin-only.
router.use(requireSuperAdmin);

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function monthlyValue(amount: number, planName: string): number {
  const months = PLAN_MONTHS[planName] ?? 1;
  return amount / months;
}

// Map a joined subscription+company row to the API shape.
function mapRow(r: any) {
  const end = new Date(r.subscription_end_date);
  const now = new Date();
  return {
    id: Number(r.id),
    companyId: Number(r.company_id),
    companyName: r.company_name,
    ownerName: r.owner_name ?? null,
    mobile: r.mobile ?? null,
    email: r.email ?? null,
    planName: r.plan_name,
    subscriptionStartDate: new Date(r.subscription_start_date).toISOString(),
    subscriptionEndDate: end.toISOString(),
    subscriptionAmount: Number(r.subscription_amount),
    paymentStatus: r.payment_status,
    subscriptionStatus: r.subscription_status,
    lastPaymentDate: r.last_payment_date ? new Date(r.last_payment_date).toISOString() : null,
    nextDueDate: r.next_due_date ? new Date(r.next_due_date).toISOString() : null,
    daysRemaining: daysBetween(now, end),
  };
}

const SELECT_JOIN = `
  SELECT s.*, c.name AS company_name, c.owner_name, c.mobile, c.email
  FROM subscriptions s
  JOIN companies c ON c.id = s.company_id
`;

// GET /subscriptions/dashboard
router.get("/subscriptions/dashboard", async (req, res): Promise<void> => {

  const { rows } = await pool.query(`${SELECT_JOIN}`);
  const subs = rows.map(mapRow);

  const active = subs.filter((s) => s.subscriptionStatus === "active");
  const totalActive = active.length;
  const totalExpired = subs.filter((s) => s.subscriptionStatus === "expired").length;
  const totalSuspended = subs.filter((s) => s.subscriptionStatus === "suspended").length;
  const expiringIn7Days = active.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 7).length;
  const expiringIn30Days = active.filter((s) => s.daysRemaining >= 0 && s.daysRemaining <= 30).length;

  const mrr = active.reduce((sum, s) => sum + monthlyValue(s.subscriptionAmount, s.planName), 0);
  const arr = mrr * 12;

  const companiesRow = await pool.query(`SELECT COUNT(*) AS c FROM companies`);

  res.json({
    totalActive,
    totalExpired,
    totalSuspended,
    expiringIn7Days,
    expiringIn30Days,
    mrr: Math.round(mrr * 100) / 100,
    arr: Math.round(arr * 100) / 100,
    totalCompanies: Number(companiesRow.rows[0]?.c ?? 0),
  });
});

// GET /subscriptions/charts
router.get("/subscriptions/charts", async (req, res): Promise<void> => {

  // Monthly revenue: sum of subscription_amount whose last_payment_date falls in each of the last 12 months.
  const revenueRows = await pool.query(`
    WITH months AS (
      SELECT to_char(date_trunc('month', (CURRENT_DATE - (n || ' months')::interval)), 'YYYY-MM') AS month
      FROM generate_series(0, 11) AS n
    )
    SELECT m.month,
      COALESCE(SUM(s.subscription_amount), 0) AS revenue
    FROM months m
    LEFT JOIN subscriptions s
      ON to_char(s.last_payment_date, 'YYYY-MM') = m.month
    GROUP BY m.month
    ORDER BY m.month ASC
  `);

  // Subscription growth: cumulative count of subscriptions created up to the end of each month.
  const growthRows = await pool.query(`
    WITH months AS (
      SELECT date_trunc('month', (CURRENT_DATE - (n || ' months')::interval)) AS m
      FROM generate_series(0, 11) AS n
    )
    SELECT to_char(m.m, 'YYYY-MM') AS month,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.created_at < (m.m + interval '1 month')) AS total
    FROM months m
    ORDER BY m.m ASC
  `);

  // Expiry trend: count of subscriptions ending in each of the last/next 12 months window (last 12).
  const expiryRows = await pool.query(`
    WITH months AS (
      SELECT to_char(date_trunc('month', (CURRENT_DATE - (n || ' months')::interval)), 'YYYY-MM') AS month
      FROM generate_series(0, 11) AS n
    )
    SELECT m.month,
      COUNT(s.id) AS expiring
    FROM months m
    LEFT JOIN subscriptions s
      ON to_char(s.subscription_end_date, 'YYYY-MM') = m.month
    GROUP BY m.month
    ORDER BY m.month ASC
  `);

  res.json({
    monthlyRevenue: revenueRows.rows.map((r) => ({ month: r.month, revenue: Number(r.revenue) })),
    subscriptionGrowth: growthRows.rows.map((r) => ({ month: r.month, total: Number(r.total) })),
    expiryTrend: expiryRows.rows.map((r) => ({ month: r.month, expiring: Number(r.expiring) })),
  });
});

// GET /subscriptions/alerts
router.get("/subscriptions/alerts", async (req, res): Promise<void> => {

  const { rows } = await pool.query(`
    SELECT a.*, c.name AS company_name
    FROM subscription_alerts a
    JOIN companies c ON c.id = a.company_id
    ORDER BY a.created_at DESC
    LIMIT 200
  `);

  res.json(rows.map((r) => ({
    id: Number(r.id),
    companyId: Number(r.company_id),
    subscriptionId: Number(r.subscription_id),
    companyName: r.company_name,
    alertType: r.alert_type,
    message: r.message,
    daysRemaining: Number(r.days_remaining),
    isRead: r.is_read,
    createdAt: new Date(r.created_at).toISOString(),
  })));
});

// GET /subscriptions/expiring?days=30
router.get("/subscriptions/expiring", async (req, res): Promise<void> => {

  const parsedDays = Number(req.query.days);
  const days = Number.isFinite(parsedDays) && parsedDays >= 0 ? Math.floor(parsedDays) : 30;
  const { rows } = await pool.query(
    `${SELECT_JOIN}
     WHERE s.subscription_status = 'active'
       AND s.subscription_end_date >= NOW()
       AND s.subscription_end_date <= NOW() + ($1 || ' days')::interval
     ORDER BY s.subscription_end_date ASC`,
    [days]
  );
  res.json(rows.map(mapRow));
});

// GET /subscriptions?search=&status=
router.get("/subscriptions", async (req, res): Promise<void> => {

  const search = String(req.query.search ?? "").trim();
  const status = String(req.query.status ?? "").trim();
  const params: any[] = [];
  let where = "WHERE 1=1";

  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR c.mobile ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
  }
  if (status) {
    params.push(status);
    where += ` AND s.subscription_status = $${params.length}`;
  }

  const { rows } = await pool.query(
    `${SELECT_JOIN} ${where} ORDER BY s.subscription_end_date ASC`,
    params
  );
  res.json(rows.map(mapRow));
});

// POST /subscriptions/create — create company + subscription (SERIALIZABLE money op)
router.post("/subscriptions/create", async (req, res): Promise<void> => {

  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const months = PLAN_MONTHS[body.planName];
  if (!months) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  const start = new Date(body.subscriptionStartDate);
  if (Number.isNaN(start.getTime())) {
    res.status(400).json({ error: "Invalid start date" });
    return;
  }
  const end = addMonths(start, months);
  const paymentStatus = body.paymentStatus ?? "pending";
  const lastPayment = paymentStatus === "paid" ? new Date() : null;

  // Optional: create an admin login for the new company in the same transaction
  // so it can sign in immediately. Both fields must be present together.
  const adminUsername = body.adminUsername?.trim() || null;
  const adminPassword = body.adminPassword?.trim() || null;
  if ((adminUsername && !adminPassword) || (!adminUsername && adminPassword)) {
    res.status(400).json({ error: "Both admin username and password are required to create a login" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    if (adminUsername) {
      // Duplicate check is scoped to the NEW company only.
      // The company row is inserted below, so at this point companyId does not exist
      // yet — we check by company name to detect re-creation races, but username
      // collisions across different companies are now intentionally allowed.
      // We still check within the to-be-created company by looking at the
      // pending INSERT: since the company_id won't exist yet, any pre-existing row
      // with the same (username, company_id) is impossible. The DB constraint
      // UNIQUE(company_id, username) will enforce it at INSERT time; no pre-check
      // needed here (we rely on the 23505 catch block below to handle races).
      // Note: we keep this block intentionally empty to document the decision,
      // and rely solely on the DB constraint + catch(23505) below.
    }

    const companyRes = await client.query(
      `INSERT INTO companies (name, owner_name, mobile, email)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [body.companyName, body.ownerName ?? null, body.mobile ?? null, body.email ?? null]
    );
    const companyId = companyRes.rows[0].id;

    if (adminUsername && adminPassword) {
      await client.query(
        `INSERT INTO users (username, password_hash, role, name, is_active, company_id)
         VALUES ($1, $2, 'admin', $3, true, $4)`,
        [adminUsername, adminPassword, body.ownerName?.trim() || `${body.companyName} Admin`, companyId]
      );
    }

    const subRes = await client.query(
      `INSERT INTO subscriptions
        (company_id, plan_name, subscription_start_date, subscription_end_date,
         subscription_amount, payment_status, subscription_status, last_payment_date, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $4)
       RETURNING id`,
      [companyId, body.planName, start, end, String(body.subscriptionAmount), paymentStatus, lastPayment]
    );

    await client.query("COMMIT");

    const { rows } = await pool.query(`${SELECT_JOIN} WHERE s.id = $1`, [subRes.rows[0].id]);
    res.status(201).json(mapRow(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    // Unique-violation on username (race between the duplicate check and insert)
    // → return a clean 409 instead of a generic 500.
    if ((err as { code?: string }).code === "23505") {
      res.status(409).json({ error: "Username already taken" });
      return;
    }
    throw err;
  } finally {
    client.release();
  }
});

// PUT /subscriptions/:id/renew — extend by plan period, mark paid (SERIALIZABLE money op)
router.put("/subscriptions/:id/renew", async (req, res): Promise<void> => {

  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const cur = await client.query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
    if (cur.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    const sub = cur.rows[0];
    const months = PLAN_MONTHS[sub.plan_name] ?? 1;
    // Renew from the later of now or current end date so paid time is never lost.
    const now = new Date();
    const curEnd = new Date(sub.subscription_end_date);
    const base = curEnd > now ? curEnd : now;
    const newEnd = addMonths(base, months);

    await client.query(
      `UPDATE subscriptions
       SET subscription_end_date = $1,
           subscription_status = 'active',
           payment_status = 'paid',
           last_payment_date = NOW(),
           next_due_date = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [newEnd, id]
    );

    await client.query("COMMIT");

    const { rows } = await pool.query(`${SELECT_JOIN} WHERE s.id = $1`, [id]);
    res.json(mapRow(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// PUT /subscriptions/:id/plan — upgrade/downgrade
router.put("/subscriptions/:id/plan", async (req, res): Promise<void> => {

  const id = Number(req.params.id);
  const parsed = ChangeSubscriptionPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { planName, subscriptionAmount } = parsed.data;
  const months = PLAN_MONTHS[planName];
  if (!months) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  const cur = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
  if (cur.rows.length === 0) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  const sub = cur.rows[0];
  // New end recalculated from the existing start using the new plan period.
  const newEnd = addMonths(new Date(sub.subscription_start_date), months);

  await pool.query(
    `UPDATE subscriptions
     SET plan_name = $1, subscription_amount = $2, subscription_end_date = $3, updated_at = NOW()
     WHERE id = $4`,
    [planName, String(subscriptionAmount), newEnd, id]
  );

  const { rows } = await pool.query(`${SELECT_JOIN} WHERE s.id = $1`, [id]);
  res.json(mapRow(rows[0]));
});

// PUT /subscriptions/:id/suspend
router.put("/subscriptions/:id/suspend", async (req, res): Promise<void> => {

  const id = Number(req.params.id);
  const result = await pool.query(
    `UPDATE subscriptions SET subscription_status = 'suspended', updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  const { rows } = await pool.query(`${SELECT_JOIN} WHERE s.id = $1`, [id]);
  res.json(mapRow(rows[0]));
});

// PUT /subscriptions/:id/activate
router.put("/subscriptions/:id/activate", async (req, res): Promise<void> => {

  const id = Number(req.params.id);
  const cur = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
  if (cur.rows.length === 0) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  const sub = cur.rows[0];
  // If the period already lapsed, reactivating alone leaves it expired; status reflects the end date.
  const status = new Date(sub.subscription_end_date) > new Date() ? "active" : "expired";

  await pool.query(
    `UPDATE subscriptions SET subscription_status = $1, updated_at = NOW() WHERE id = $2`,
    [status, id]
  );

  const { rows } = await pool.query(`${SELECT_JOIN} WHERE s.id = $1`, [id]);
  res.json(mapRow(rows[0]));
});

// PUT /subscriptions/:id — edit company + subscription details (SERIALIZABLE)
router.put("/subscriptions/:id", async (req, res): Promise<void> => {

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid subscription id" });
    return;
  }
  const parsed = UpdateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  if (!PLAN_MONTHS[body.planName]) {
    res.status(400).json({ error: "Invalid plan" });
    return;
  }

  const start = new Date(body.subscriptionStartDate);
  const end = new Date(body.subscriptionEndDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400).json({ error: "Invalid start or end date" });
    return;
  }
  if (end <= start) {
    res.status(400).json({ error: "End date must be after the start date" });
    return;
  }
  if (!Number.isFinite(body.subscriptionAmount) || body.subscriptionAmount <= 0) {
    res.status(400).json({ error: "Amount must be a positive number" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const cur = await client.query(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
    if (cur.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    const sub = cur.rows[0];
    const companyId = sub.company_id;

    // Suspended accounts stay suspended; otherwise status follows the (possibly
    // edited) end date so the list never shows a misleading "active" past expiry.
    const status =
      sub.subscription_status === "suspended"
        ? "suspended"
        : end > new Date()
          ? "active"
          : "expired";

    await client.query(
      `UPDATE companies
       SET name = $1, owner_name = $2, mobile = $3, email = $4, updated_at = NOW()
       WHERE id = $5`,
      [body.companyName.trim(), body.ownerName ?? null, body.mobile ?? null, body.email ?? null, companyId]
    );

    await client.query(
      `UPDATE subscriptions
       SET plan_name = $1,
           subscription_amount = $2,
           subscription_start_date = $3,
           subscription_end_date = $4,
           payment_status = $5,
           subscription_status = $6,
           next_due_date = $4,
           updated_at = NOW()
       WHERE id = $7`,
      [body.planName, String(body.subscriptionAmount), start, end, body.paymentStatus, status, id]
    );

    await client.query("COMMIT");

    const { rows } = await pool.query(`${SELECT_JOIN} WHERE s.id = $1`, [id]);
    res.json(mapRow(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /subscriptions/:id — permanently remove a tenant company, its
// subscription and ALL of its business data (logins, transactions, history).
// Destructive and irreversible. SERIALIZABLE so a concurrent write can't leave
// the tenant half-deleted.
router.delete("/subscriptions/:id", async (req, res): Promise<void> => {

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid subscription id" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const cur = await client.query(
      `SELECT s.company_id, c.name AS company_name
       FROM subscriptions s JOIN companies c ON c.id = s.company_id
       WHERE s.id = $1`,
      [id]
    );
    if (cur.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    const companyId = cur.rows[0].company_id;
    const companyName = cur.rows[0].company_name as string;

    // Wipe every company-scoped business table (reverse FK order), then the
    // tenant-management rows. COMPANY_TABLES is the same allow-list used by
    // backup/restore/reset, so table names are never derived from user input.
    for (const table of [...COMPANY_TABLES].reverse()) {
      await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
    }
    await client.query(`DELETE FROM backups WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM backup_settings WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM subscription_alerts WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM subscriptions WHERE company_id = $1`, [companyId]);
    await client.query(`DELETE FROM companies WHERE id = $1`, [companyId]);

    await client.query("COMMIT");

    res.json({ message: "Tenant company and all its data have been permanently deleted.", companyName });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});

export default router;
