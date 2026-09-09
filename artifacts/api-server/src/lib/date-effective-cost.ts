// Date-effective cost of goods — works out what a product actually cost on a
// given date, rather than reading the single live products.purchase_price
// field (which only ever holds the *last* rate anyone entered).
//
//   • A bought product costs whatever the most recent purchase bill dated on
//     or before `asOf` charged for it. No bill yet on that date → fall back to
//     the opening-stock unit value, then the current purchase_price.
//   • A manufactured product (one that has a recipe / BOM) costs the rolled-up
//     sum of its materials, each priced by the same as-of rule — recursing
//     through recipes-of-recipes. This is the "BOM cost at the time of the
//     invoice" the P&L needs.
//
// The recipe rollup itself is computeProductCosts() from bom-cost.ts, reused
// verbatim: we just hand it a per-material base cost that is the as-of rate
// instead of the live purchase_price.
import { pool } from "@workspace/db";
import { computeProductCosts, type BomItemRow } from "./bom-cost";

export interface CostInputs {
  products: {
    id: number;
    purchasePrice: string | number;
    openingStock: string | number | null;
    openingStockValue: string | number | null;
  }[];
  bomItems: BomItemRow[];
}

// Loads the company-wide product master + full BOM tree once, so a caller
// recomputing many invoices across many dates hits these two tables a single
// time instead of per invoice.
//
// Soft-deleted products are deliberately included: a discontinued product can
// still sit on historical invoices, and its cost as of those dates must stay
// computable — dropping it here would make its rolled-up cost resolve to 0.
export async function loadCostInputs(companyId: number): Promise<CostInputs> {
  const [prodRows, bomRows] = await Promise.all([
    pool.query(
      `SELECT id, purchase_price, opening_stock, opening_stock_value
         FROM products
        WHERE company_id = $1`,
      [companyId],
    ),
    pool.query(
      `SELECT b.finished_product_id, b.output_quantity, bi.material_product_id, bi.quantity
         FROM boms b
         JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
        WHERE b.company_id = $1`,
      [companyId],
    ),
  ]);

  return {
    products: prodRows.rows.map((r: any) => ({
      id: r.id,
      purchasePrice: r.purchase_price,
      openingStock: r.opening_stock,
      openingStockValue: r.opening_stock_value,
    })),
    bomItems: bomRows.rows.map((r: any) => ({
      finishedProductId: r.finished_product_id,
      materialProductId: r.material_product_id,
      quantity: r.quantity,
      outputQuantity: r.output_quantity,
    })),
  };
}

// Most-recent purchase-bill rate per product with bill_date <= asOf.
async function purchaseRatesAsOf(companyId: number, asOf: Date): Promise<Map<number, number>> {
  const rows = await pool.query(
    `SELECT DISTINCT ON (pi.product_id) pi.product_id, pi.rate
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id AND p.company_id = pi.company_id
      WHERE p.company_id = $1 AND p.bill_date <= $2 AND p.status <> 'cancelled'
      ORDER BY pi.product_id, p.bill_date DESC, p.id DESC`,
    [companyId, asOf],
  );
  const m = new Map<number, number>();
  for (const r of rows.rows) m.set(Number(r.product_id), Number(r.rate));
  return m;
}

/**
 * Per-unit cost of every company product as of `asOf`. Manufactured products
 * are rolled up from their recipe; everything else is the date-effective
 * purchase rate (→ opening-stock value → current purchase_price → 0).
 */
export async function computeCostAsOf(
  companyId: number,
  asOf: Date,
  inputs: CostInputs,
): Promise<Map<number, number>> {
  const rates = await purchaseRatesAsOf(companyId, asOf);

  const baseCost = new Map<number, number>();
  for (const p of inputs.products) {
    const eff = rates.get(p.id);
    if (eff != null) {
      baseCost.set(p.id, eff);
      continue;
    }
    const os = Number(p.openingStock ?? 0);
    const osv = Number(p.openingStockValue ?? 0);
    if (os > 0 && osv > 0) {
      baseCost.set(p.id, osv / os);
      continue;
    }
    baseCost.set(p.id, Number(p.purchasePrice) || 0);
  }

  // computeProductCosts uses the passed purchasePrice only for products that
  // have no recipe of their own; recipe products are computed from their
  // items. Feeding it the as-of base cost therefore prices raw materials at
  // the as-of rate and cascades that through every recipe.
  return computeProductCosts(
    inputs.products.map((p) => ({ id: p.id, purchasePrice: baseCost.get(p.id) ?? 0 })),
    inputs.bomItems,
  );
}

// Convenience for a single ad-hoc lookup (invoice create/edit) — loads inputs
// and computes in one call. Callers recomputing in bulk should use
// loadCostInputs + computeCostAsOf directly to avoid reloading per date.
export async function costForDate(companyId: number, asOf: Date): Promise<Map<number, number>> {
  const inputs = await loadCostInputs(companyId);
  return computeCostAsOf(companyId, asOf, inputs);
}
