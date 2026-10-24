import { Router, type IRouter } from "express";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { pool } from "@workspace/db";
import { buildSupplierSettle, cashPosition } from "../lib/supplier-settle";

// Supplier Settle (see lib/supplier-settle.ts) — admin only: it shows the
// business's profit and what it owes each supplier.
const router: IRouter = Router();

router.get("/supplier-settle", async (req, res): Promise<void> => {
  const role = (req as any).session?.role;
  if (role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const companyId = getCompanyId(req);
    const report = await buildSupplierSettle(companyId);
    const due = await pool.query(
      `SELECT COALESCE(SUM(GREATEST(outstanding_balance, 0)), 0)::float8 AS due FROM entities WHERE company_id = $1 AND type = 'vendor'`,
      [companyId],
    );
    res.json({ ...report, cash: await cashPosition(companyId, Number(due.rows[0]?.due ?? 0)) });
  } catch (err) {
    logger.error({ err }, "GET /supplier-settle failed");
    res.status(500).json({ error: "Failed to load Supplier Settle" });
  }
});

export default router;
