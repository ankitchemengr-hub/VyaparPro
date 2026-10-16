import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import {
  AUTO_MANUFACTURE_KEY,
  isAutoManufactureEnabled,
  coverManufacturedShortfall,
} from "../lib/auto-manufacture";

const router: IRouter = Router();

function requireAdminRole(req: any, res: any): boolean {
  const role = req.session?.role;
  if (role !== "admin" && role !== "super_admin") {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// GET /auto-manufacture/settings
router.get("/auto-manufacture/settings", async (req, res): Promise<void> => {
  if (!requireAdminRole(req, res)) return;
  res.json({ enabled: await isAutoManufactureEnabled(pool, getCompanyId(req)) });
});

// PUT /auto-manufacture/settings { enabled }
router.put("/auto-manufacture/settings", async (req, res): Promise<void> => {
  if (!requireAdminRole(req, res)) return;
  if (typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be true or false" });
    return;
  }
  await pool.query(
    `INSERT INTO app_settings (company_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [getCompanyId(req), AUTO_MANUFACTURE_KEY, req.body.enabled ? "true" : "false"],
  );
  res.json({ enabled: req.body.enabled });
});

// One-time fix for manufactured products already below zero: each is
// brought back to 0 by the same rule a sale now follows (Ready Material
// first, then the BOM's raw materials). Preview runs the identical writes
// and rolls back, so what it lists is exactly what Apply does.
async function runNegativeStockFix(companyId: number, apply: boolean, session: any) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const negRes = await client.query(
      `SELECT p.id, p.current_stock
       FROM products p
       WHERE p.company_id = $1 AND p.deleted_at IS NULL AND p.current_stock < 0
         AND EXISTS (SELECT 1 FROM boms b WHERE b.company_id = p.company_id AND b.finished_product_id = p.id)
       ORDER BY p.name`,
      [companyId],
    );
    const userId = session?.userId ?? 1;
    const products: any[] = [];
    for (const row of negRes.rows) {
      const cover = await coverManufacturedShortfall(client, {
        companyId, productId: row.id, shortfall: -Number(row.current_stock),
        reason: "negative stock fix", userId,
      });
      if (cover) products.push({ ...cover, stockBefore: Number(row.current_stock), stockAfter: 0 });
    }
    // Raw materials this leaves below zero — the real shortage to purchase.
    const rawShort = new Map<number, { productId: number; name: string; unit: string; stockAfter: number }>();
    for (const p of products) {
      for (const m of p.materials) {
        if (m.stockAfter < 0) rawShort.set(m.productId, { productId: m.productId, name: m.name, unit: m.unit, stockAfter: m.stockAfter });
      }
    }
    const summary = {
      productCount: products.length,
      rawMaterialsNegative: [...rawShort.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
    if (apply && products.length > 0) {
      await client.query(
        `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
         VALUES ($1, 'negative_stock_fix', $2, $3, $4, $5)`,
        [
          companyId,
          `Manufactured stock fixed to zero for ${products.length} products (raw materials consumed per BOM)`,
          userId,
          session?.name ?? "Unknown",
          JSON.stringify(products.map((p) => ({ productId: p.productId, stockBefore: p.stockBefore, fromReady: p.fromReady, manufactured: p.manufactured, materials: p.materials.map((m: any) => [m.productId, m.qty]) }))),
        ],
      );
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { applied: apply, ...summary, products };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

router.get("/auto-manufacture/negative-stock/preview", async (req, res): Promise<void> => {
  if (!requireAdminRole(req, res)) return;
  try {
    res.json(await runNegativeStockFix(getCompanyId(req), false, (req as any).session));
  } catch (err) {
    logger.error({ err }, "Negative stock preview failed");
    res.status(500).json({ error: "Could not check negative stock" });
  }
});

router.post("/auto-manufacture/negative-stock/apply", async (req, res): Promise<void> => {
  if (!requireAdminRole(req, res)) return;
  try {
    res.json(await runNegativeStockFix(getCompanyId(req), true, (req as any).session));
  } catch (err) {
    logger.error({ err }, "Negative stock fix failed");
    res.status(500).json({ error: "Could not fix negative stock" });
  }
});

export default router;
