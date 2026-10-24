import { Router, type IRouter } from "express";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { buildSupplierSettle } from "../lib/supplier-settle";

// Supplier Settle (see lib/supplier-settle.ts) — admin and accountant, the
// same people who see Khatabook.
const router: IRouter = Router();

router.get("/supplier-settle", async (req, res): Promise<void> => {
  const role = (req as any).session?.role;
  if (role !== "admin" && role !== "accountant") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    res.json(await buildSupplierSettle(getCompanyId(req)));
  } catch (err) {
    logger.error({ err }, "GET /supplier-settle failed");
    res.status(500).json({ error: "Failed to load Supplier Settle" });
  }
});

export default router;
