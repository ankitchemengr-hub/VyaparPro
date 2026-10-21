// Server-side mirror of bom-dialog.tsx's client-side unitCost() — the recipe
// cost rollup previously only ever existed ephemerally in the browser while
// that dialog happened to be open, recomputed from whatever purchasePrice
// values were loaded at the time. This version runs against the live DB so
// "Recalculate Prices" can cascade a raw material's rate change through
// every recipe (including recipes-of-recipes) without a browser involved.

import { pool } from "@workspace/db";

export interface ProductCostRow {
  id: number;
  purchasePrice: string | number;
}

export interface BomItemRow {
  finishedProductId: number;
  materialProductId: number;
  quantity: string | number;
  outputQuantity: string | number;
}

/**
 * Computes the rolled-up per-unit cost of every product in `productIds` that
 * has a recipe (BOM), recursing into nested recipes and falling back to a
 * product's own purchasePrice for raw materials / anything without a BOM.
 * Guards cycles so a self-referencing or circular recipe can't infinite-loop.
 */
export function computeProductCosts(
  products: ProductCostRow[],
  bomItems: BomItemRow[],
): Map<number, number> {
  const purchasePriceById = new Map<number, number>(products.map((p) => [p.id, Number(p.purchasePrice) || 0]));
  const itemsByFinishedId = new Map<number, BomItemRow[]>();
  for (const item of bomItems) {
    const list = itemsByFinishedId.get(item.finishedProductId) ?? [];
    list.push(item);
    itemsByFinishedId.set(item.finishedProductId, list);
  }

  const cache = new Map<number, number>();

  function costOf(productId: number, visiting: Set<number>): number {
    if (cache.has(productId)) return cache.get(productId)!;
    if (visiting.has(productId)) return purchasePriceById.get(productId) ?? 0;

    const items = itemsByFinishedId.get(productId);
    if (!items || items.length === 0) {
      const cost = purchasePriceById.get(productId) ?? 0;
      cache.set(productId, cost);
      return cost;
    }

    visiting.add(productId);
    const outputQty = Number(items[0].outputQuantity) || 1;
    const batchCost = items.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0) * costOf(item.materialProductId, visiting),
      0,
    );
    visiting.delete(productId);

    const cost = outputQty > 0 ? batchCost / outputQty : 0;
    cache.set(productId, cost);
    return cost;
  }

  const result = new Map<number, number>();
  for (const p of products) {
    result.set(p.id, costOf(p.id, new Set()));
  }
  return result;
}

/**
 * Live per-unit manufacturing cost of every product in the company that has
 * a recipe (BOM), keyed by product id — products without a BOM are absent.
 * This is "what it really costs to make right now", as opposed to
 * purchasePrice, which only catches up when "Recalculate Prices" is run.
 * Used by the products list (Price List / billing cost alerts) and to
 * snapshot an invoice line's cost_price for profit reports.
 */
export async function loadManufacturingCosts(companyId: number): Promise<Map<number, number>> {
  const bomRows = await pool.query(
    `SELECT b.finished_product_id, b.output_quantity, bi.material_product_id, bi.quantity
     FROM boms b
     JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
     WHERE b.company_id = $1`,
    [companyId],
  );
  const result = new Map<number, number>();
  if (bomRows.rows.length === 0) return result;

  const bomItems: BomItemRow[] = bomRows.rows.map((r: any) => ({
    finishedProductId: r.finished_product_id,
    materialProductId: r.material_product_id,
    quantity: r.quantity,
    outputQuantity: r.output_quantity,
  }));
  // Costed against every company product (not just the ones being sold),
  // since a recipe's raw materials may be anything.
  const productRows = await pool.query(
    `SELECT id, purchase_price FROM products WHERE company_id = $1 AND deleted_at IS NULL`,
    [companyId],
  );
  const costs = computeProductCosts(
    productRows.rows.map((r: any) => ({ id: r.id, purchasePrice: r.purchase_price })),
    bomItems,
  );
  for (const finishedId of new Set(bomItems.map((b) => b.finishedProductId))) {
    result.set(finishedId, Math.round((costs.get(finishedId) ?? 0) * 100) / 100);
  }
  return result;
}

/**
 * The unit cost a sale should be measured against: the live BOM cost for a
 * manufactured product (when it rolls up to something > 0), otherwise the
 * product's purchasePrice.
 */
// GST % paid on each product's cost, keyed by product id: a bought item's own
// purchase_gst_pct; for a made item, worked out from its BOM materials
// (GST-inclusive recipe cost vs plain recipe cost). Used to snapshot
// invoice_items.cost_gst_pct and by the products list for billing alerts.
export async function loadCostGstPct(companyId: number): Promise<Map<number, number>> {
  const [prodRows, bomRows] = await Promise.all([
    pool.query(`SELECT id, purchase_price, purchase_gst_pct FROM products WHERE company_id = $1`, [companyId]),
    pool.query(
      `SELECT b.finished_product_id, b.output_quantity, bi.material_product_id, bi.quantity
       FROM boms b
       JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
       WHERE b.company_id = $1`,
      [companyId],
    ),
  ]);
  const pctById = new Map<number, number>(prodRows.rows.map((r: any) => [r.id, Number(r.purchase_gst_pct) || 0]));
  const result = new Map<number, number>(pctById);
  if (bomRows.rows.length === 0) return result;

  const bomItems: BomItemRow[] = bomRows.rows.map((r: any) => ({
    finishedProductId: r.finished_product_id,
    materialProductId: r.material_product_id,
    quantity: r.quantity,
    outputQuantity: r.output_quantity,
  }));
  const basic = computeProductCosts(
    prodRows.rows.map((r: any) => ({ id: r.id, purchasePrice: r.purchase_price })),
    bomItems,
  );
  const gross = computeProductCosts(
    prodRows.rows.map((r: any) => ({ id: r.id, purchasePrice: (Number(r.purchase_price) || 0) * (1 + (pctById.get(r.id) ?? 0) / 100) })),
    bomItems,
  );
  for (const finishedId of new Set(bomItems.map((b) => b.finishedProductId))) {
    const b = basic.get(finishedId) ?? 0;
    const g = gross.get(finishedId) ?? 0;
    if (b > 0) result.set(finishedId, Math.round(((g / b) - 1) * 100 * 1000) / 1000);
  }
  return result;
}

export function effectiveUnitCost(
  productId: number,
  purchasePrice: string | number | null | undefined,
  manufacturingCosts: Map<number, number>,
): number | null {
  const mfg = manufacturingCosts.get(productId);
  if (mfg != null && mfg > 0) return mfg;
  return purchasePrice != null ? Number(purchasePrice) : null;
}
