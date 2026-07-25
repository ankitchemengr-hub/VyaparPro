import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const DEFAULTS = { reinvestPct: 50, coverageDays: 30, lookbackDays: 30 };
const SETTINGS_KEYS = {
  reinvestPct: "smart_order_reinvest_pct",
  coverageDays: "smart_order_coverage_days",
  lookbackDays: "smart_order_lookback_days",
} as const;

async function loadSettings(companyId: number) {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE company_id = $1 AND key = ANY($2::text[])`,
    [companyId, Object.values(SETTINGS_KEYS)],
  );
  const byKey = new Map<string, string>(rows.map((r) => [r.key, r.value]));
  return {
    reinvestPct: Number(byKey.get(SETTINGS_KEYS.reinvestPct) ?? DEFAULTS.reinvestPct),
    coverageDays: Number(byKey.get(SETTINGS_KEYS.coverageDays) ?? DEFAULTS.coverageDays),
    lookbackDays: Number(byKey.get(SETTINGS_KEYS.lookbackDays) ?? DEFAULTS.lookbackDays),
  };
}

// GET /smart-order/settings
router.get("/smart-order/settings", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  res.json(await loadSettings(companyId));
});

// PUT /smart-order/settings — admin only
router.put("/smart-order/settings", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only administrators can change Smart Order settings" });
    return;
  }
  const companyId = getCompanyId(req);
  const body = req.body as { reinvestPct?: number; coverageDays?: number; lookbackDays?: number };
  const updates: Array<[string, number]> = [];
  if (body.reinvestPct != null) updates.push([SETTINGS_KEYS.reinvestPct, Number(body.reinvestPct)]);
  if (body.coverageDays != null) updates.push([SETTINGS_KEYS.coverageDays, Number(body.coverageDays)]);
  if (body.lookbackDays != null) updates.push([SETTINGS_KEYS.lookbackDays, Number(body.lookbackDays)]);

  for (const [key, value] of updates) {
    if (!Number.isFinite(value) || value < 0) {
      res.status(400).json({ error: `${key} must be a non-negative number` });
      return;
    }
    await pool.query(
      `INSERT INTO app_settings (company_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [companyId, key, String(value)],
    );
  }

  res.json(await loadSettings(companyId));
});

// GET /smart-order/suggestions
// Two independent velocity signals, since raw materials are never sold
// directly: finished goods (not_for_sale = false) rank by qty actually sold
// on real invoices; raw materials (not_for_sale = true) rank by qty consumed
// in Manufacturing. Only the sales side can carry a reinvestment boost —
// margin only exists where there's a sale price.
router.get("/smart-order/suggestions", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const settings = await loadSettings(companyId);
  const lookbackStart = new Date(Date.now() - settings.lookbackDays * 24 * 60 * 60 * 1000);

  const productRows = await pool.query(
    `SELECT p.id, p.name, p.item_code, p.unit, p.current_stock, p.purchase_price, p.image_url,
            SUM(ii.qty) AS units_moved,
            SUM(CASE WHEN ii.cost_price IS NOT NULL THEN (ii.net_price - ii.cost_price) * ii.qty ELSE 0 END) AS total_margin
     FROM products p
     JOIN invoice_items ii ON ii.product_id = p.id AND ii.company_id = p.company_id
     JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = p.company_id
     WHERE p.company_id = $1 AND p.deleted_at IS NULL AND p.not_for_sale = false
       AND i.invoice_type != 'quotation' AND i.status != 'cancelled'
       AND i.invoice_date >= $2
     GROUP BY p.id
     HAVING SUM(ii.qty) > 0`,
    [companyId, lookbackStart],
  );

  const rawMaterialRows = await pool.query(
    `SELECT p.id, p.name, p.item_code, p.unit, p.current_stock, p.purchase_price, p.image_url,
            SUM(sm.quantity) AS units_moved
     FROM products p
     JOIN stock_movements sm ON sm.product_id = p.id AND sm.company_id = p.company_id
     WHERE p.company_id = $1 AND p.deleted_at IS NULL AND p.not_for_sale = true
       AND sm.type = 'manufacturing_consume' AND sm.created_at >= $2
     GROUP BY p.id
     HAVING SUM(sm.quantity) > 0`,
    [companyId, lookbackStart],
  );

  function buildSuggestion(r: any, category: "product" | "raw_material") {
    const currentStock = Number(r.current_stock);
    const purchasePrice = Number(r.purchase_price);
    const unitsMoved = Number(r.units_moved);
    const totalMargin = Number(r.total_margin ?? 0);
    const avgDailyRate = unitsMoved / settings.lookbackDays;
    const velocityQty = Math.max(0, avgDailyRate * settings.coverageDays - currentStock);
    const reinvestBudget = totalMargin * (settings.reinvestPct / 100);
    const reinvestQty = purchasePrice > 0 ? reinvestBudget / purchasePrice : 0;
    return {
      productId: r.id,
      productName: r.name,
      itemCode: r.item_code ?? null,
      imageUrl: r.image_url ?? null,
      unit: r.unit,
      category,
      currentStock,
      unitsMoved,
      avgDailyRate: Math.round(avgDailyRate * 1000) / 1000,
      purchasePrice,
      totalMargin: Math.round(totalMargin * 100) / 100,
      velocityQty: Math.round(velocityQty * 1000) / 1000,
      reinvestQty: Math.round(reinvestQty * 1000) / 1000,
      suggestedQty: Math.round(velocityQty + reinvestQty),
    };
  }

  const suggestions = [
    ...productRows.rows.map((r) => buildSuggestion(r, "product" as const)),
    ...rawMaterialRows.rows.map((r) => buildSuggestion(r, "raw_material" as const)),
  ].sort((a, b) => b.suggestedQty - a.suggestedQty);

  res.json(suggestions);
});

export default router;
