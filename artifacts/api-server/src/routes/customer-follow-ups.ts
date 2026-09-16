import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId, getSession } from "../lib/tenant";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SETTINGS_KEY = "inactive_customer_days_threshold";
const DEFAULT_DAYS = 10;

async function loadThreshold(companyId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE company_id = $1 AND key = $2`,
    [companyId, SETTINGS_KEY],
  );
  const value = Number(rows[0]?.value ?? DEFAULT_DAYS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DAYS;
}

// GET /customer-follow-ups/settings
router.get("/customer-follow-ups/settings", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  res.json({ days: await loadThreshold(companyId) });
});

// PUT /customer-follow-ups/settings — admin only
router.put("/customer-follow-ups/settings", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only administrators can change this setting" });
    return;
  }
  const companyId = getCompanyId(req);
  const days = Number((req.body ?? {}).days);
  if (!Number.isFinite(days) || days < 1) {
    res.status(400).json({ error: "days must be a positive number" });
    return;
  }
  await pool.query(
    `INSERT INTO app_settings (company_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
    [companyId, SETTINGS_KEY, String(days)],
  );
  res.json({ days });
});

// GET /customers/inactive — customers with no (non-cancelled) invoice within
// the configured threshold, including customers with no invoice at all.
// Most-inactive first (never-ordered, then oldest last order).
router.get("/customers/inactive", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  try {
    // ?days= lets the page preview a different threshold (the Search button)
    // without persisting it — only a valid positive integer overrides the
    // saved setting; anything else falls back to it same as before.
    const previewDays = Number(req.query.days);
    const days = Number.isFinite(previewDays) && previewDays > 0
      ? previewDays
      : await loadThreshold(companyId);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // A customer who has never invoiced only counts as inactive once they've
    // had the full threshold to place a first order (created_at < cutoff) —
    // otherwise every brand-new customer would show up here on day one.
    // A customer with a still-pending "remind me in N days" snooze
    // (inactive_reminder_until in the future) is excluded regardless —
    // see POST /customers/:id/remind.
    const { rows: customers } = await pool.query(
      `SELECT e.id, e.name, e.mobile, e.outstanding_balance, e.created_at,
              MAX(i.invoice_date) AS last_invoice_date
       FROM entities e
       LEFT JOIN invoices i
         ON i.customer_id = e.id AND i.company_id = e.company_id AND i.status != 'cancelled'
       WHERE e.company_id = $1 AND e.type = 'customer' AND e.is_active = true
         AND (e.inactive_reminder_until IS NULL OR e.inactive_reminder_until <= NOW())
       GROUP BY e.id
       HAVING MAX(i.invoice_date) < $2
          OR (MAX(i.invoice_date) IS NULL AND e.created_at < $2)
       ORDER BY COALESCE(MAX(i.invoice_date), e.created_at) ASC`,
      [companyId, cutoff],
    );

    const customerIds = customers.map((c) => c.id);
    const latestRemarkByCustomer = new Map<number, { remark: string; createdByName: string | null; createdAt: string }>();
    if (customerIds.length > 0) {
      const { rows: remarks } = await pool.query(
        `SELECT DISTINCT ON (customer_id) customer_id, remark, created_by_name, created_at
         FROM customer_follow_ups
         WHERE company_id = $1 AND customer_id = ANY($2::int[])
         ORDER BY customer_id, created_at DESC`,
        [companyId, customerIds],
      );
      for (const r of remarks) {
        latestRemarkByCustomer.set(r.customer_id, {
          remark: r.remark,
          createdByName: r.created_by_name ?? null,
          createdAt: r.created_at?.toISOString?.() ?? r.created_at,
        });
      }
    }

    const now = Date.now();
    res.json(customers.map((c) => ({
      customerId: c.id,
      name: c.name,
      mobile: c.mobile,
      outstandingBalance: Number(c.outstanding_balance ?? 0),
      lastInvoiceDate: c.last_invoice_date?.toISOString?.() ?? c.last_invoice_date ?? null,
      daysSinceLastInvoice: c.last_invoice_date
        ? Math.floor((now - new Date(c.last_invoice_date).getTime()) / (24 * 60 * 60 * 1000))
        : null,
      // Never invoiced — days since registration instead, so the UI can show
      // "registered N days ago, still no order" rather than a bare "Never ordered".
      daysSinceRegistered: c.last_invoice_date
        ? null
        : Math.floor((now - new Date(c.created_at).getTime()) / (24 * 60 * 60 * 1000)),
      lastRemark: latestRemarkByCustomer.get(c.id) ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "GET /customers/inactive failed");
    res.status(500).json({ error: "Failed to load inactive customers" });
  }
});

// GET /customers/:id/follow-ups — remark history, most recent first
router.get("/customers/:id/follow-ups", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const customerId = parseInt(req.params.id, 10);
  try {
    const { rows } = await pool.query(
      `SELECT id, remark, created_by_name, created_at
       FROM customer_follow_ups
       WHERE company_id = $1 AND customer_id = $2
       ORDER BY created_at DESC`,
      [companyId, customerId],
    );
    res.json(rows.map((r) => ({
      id: r.id,
      remark: r.remark,
      createdByName: r.created_by_name ?? null,
      createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    })));
  } catch (err) {
    logger.error({ err }, "GET /customers/:id/follow-ups failed");
    res.status(500).json({ error: "Failed to load follow-ups" });
  }
});

// POST /customers/:id/follow-ups
router.post("/customers/:id/follow-ups", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const customerId = parseInt(req.params.id, 10);
  const remark = String((req.body ?? {}).remark ?? "").trim();
  if (!remark) {
    res.status(400).json({ error: "remark is required" });
    return;
  }
  const session = getSession(req);
  try {
    const { rows } = await pool.query(
      `INSERT INTO customer_follow_ups (company_id, customer_id, remark, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, remark, created_by_name, created_at`,
      [companyId, customerId, remark, session?.userId ?? null, session?.name ?? null],
    );
    const r = rows[0];
    res.status(201).json({
      id: r.id,
      remark: r.remark,
      createdByName: r.created_by_name ?? null,
      createdAt: r.created_at?.toISOString?.() ?? r.created_at,
    });
  } catch (err) {
    logger.error({ err }, "POST /customers/:id/follow-ups failed");
    res.status(500).json({ error: "Failed to save remark" });
  }
});

// POST /customers/:id/remind — "I'll order in N days": snooze this customer
// off the Inactive Customers list until then. They reappear automatically
// once that date passes if they still haven't invoiced.
router.post("/customers/:id/remind", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const customerId = parseInt(req.params.id, 10);
  const days = Number((req.body ?? {}).days);
  if (!Number.isFinite(days) || days < 1) {
    res.status(400).json({ error: "days must be a positive number" });
    return;
  }
  try {
    const { rows } = await pool.query(
      `UPDATE entities
       SET inactive_reminder_until = NOW() + ($1::text || ' days')::interval
       WHERE id = $2 AND company_id = $3
       RETURNING inactive_reminder_until`,
      [days, customerId, companyId],
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json({ remindAfter: rows[0].inactive_reminder_until.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /customers/:id/remind failed");
    res.status(500).json({ error: "Failed to set reminder" });
  }
});

export default router;
