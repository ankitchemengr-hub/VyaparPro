import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const READ_ROLES = new Set(["admin", "accountant"]);
function requireRead(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !READ_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /khatabook?type=customer|vendor
// Lists customer or vendor balances plus their nearest unpaid due date, pulled
// from invoices (customer) or purchase bills (vendor) — there's no dueDate
// column on entities itself, only on the transaction documents.
router.get("/khatabook", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  const type = req.query.type === "vendor" ? "vendor" : "customer";
  const dueDateCol = type === "vendor" ? "vendor_id" : "customer_id";
  const dueDateTable = type === "vendor" ? "purchases" : "invoices";

  try {
    const result = await pool.query(
      `SELECT e.id, e.name, e.mobile, e.gstin, e.pricing_tier, e.outstanding_balance,
              d.next_due_date
       FROM entities e
       LEFT JOIN (
         SELECT ${dueDateCol} AS entity_id, MIN(due_date) AS next_due_date
         FROM ${dueDateTable}
         WHERE company_id = $1 AND status != 'cancelled' AND balance_due > 0 AND due_date IS NOT NULL
         GROUP BY ${dueDateCol}
       ) d ON d.entity_id = e.id
       WHERE e.company_id = $1 AND e.type = $2
       ORDER BY e.name`,
      [companyId, type]
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        gstin: r.gstin ?? null,
        pricingTier: r.pricing_tier ?? null,
        outstandingBalance: Number(r.outstanding_balance ?? 0),
        nextDueDate: r.next_due_date ? new Date(r.next_due_date).toISOString().slice(0, 10) : null,
      }))
    );
  } catch (err) {
    logger.error({ err }, "GET /khatabook failed");
    res.status(500).json({ error: "Failed to load khatabook" });
  }
});

export default router;
