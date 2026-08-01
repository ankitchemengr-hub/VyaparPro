// Shared by the manual "Recalculate Prices" routes (products.ts) and the
// automatic recalculation that runs whenever a BOM is created/edited
// (manufacturing.ts) — for every product whose recipe (BOM) cost rollup has
// moved since its stored purchasePrice, works out the new purchasePrice
// (= recipe cost, so Price List/COGS/P&L reporting stays accurate) and, for
// fixed_margin products, the new wholesale/retail price too.
import { eq, and, isNull } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { productsTable } from "@workspace/db";
import { computeProductCosts } from "./bom-cost";

export interface RecalculationChange {
  id: number;
  name: string;
  itemCode: string;
  oldCost: number;
  newCost: number;
  oldWholesalePrice: number;
  newWholesalePrice: number;
  oldRetailPrice: number;
  newRetailPrice: number;
}

export async function computeRecalculation(companyId: number): Promise<RecalculationChange[]> {
  const products = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), isNull(productsTable.deletedAt)));

  const bomRows = await pool.query(
    `SELECT b.finished_product_id, b.output_quantity, bi.material_product_id, bi.quantity
     FROM boms b
     JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
     WHERE b.company_id = $1`,
    [companyId],
  );
  const bomItems = bomRows.rows.map((r: any) => ({
    finishedProductId: r.finished_product_id,
    materialProductId: r.material_product_id,
    quantity: r.quantity,
    outputQuantity: r.output_quantity,
  }));
  const finishedProductIds = new Set(bomItems.map((b) => b.finishedProductId));

  const costs = computeProductCosts(
    products.map((p) => ({ id: p.id, purchasePrice: p.purchasePrice })),
    bomItems,
  );

  const changes: RecalculationChange[] = [];

  for (const p of products) {
    // Only products with their own recipe get their cost/purchasePrice
    // touched — a raw material like Refine Oil has no BOM of its own; its
    // purchasePrice is the very rate the admin edits by hand to kick this off.
    if (!finishedProductIds.has(p.id)) continue;
    const newCost = Math.round((costs.get(p.id) ?? 0) * 100) / 100;
    const oldCost = Number(p.purchasePrice);

    const oldWholesalePrice = Number(p.wholesalePrice);
    const oldRetailPrice = Number(p.retailPrice);
    let newWholesalePrice = oldWholesalePrice;
    let newRetailPrice = oldRetailPrice;
    if (p.pricingBasis === "fixed_margin") {
      if (p.wholesaleMargin != null) newWholesalePrice = Math.round(newCost * (1 + Number(p.wholesaleMargin) / 100) * 100) / 100;
      if (p.retailMargin != null) newRetailPrice = Math.round(newCost * (1 + Number(p.retailMargin) / 100) * 100) / 100;
    }

    const changed =
      Math.abs(newCost - oldCost) > 0.004 ||
      Math.abs(newWholesalePrice - oldWholesalePrice) > 0.004 ||
      Math.abs(newRetailPrice - oldRetailPrice) > 0.004;
    if (!changed) continue;

    changes.push({
      id: p.id, name: p.name, itemCode: p.itemCode,
      oldCost, newCost, oldWholesalePrice, newWholesalePrice, oldRetailPrice, newRetailPrice,
    });
  }

  return changes;
}

export async function applyRecalculation(companyId: number): Promise<RecalculationChange[]> {
  const changes = await computeRecalculation(companyId);
  if (changes.length === 0) return changes;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of changes) {
      await client.query(
        `UPDATE products SET purchase_price = $1, wholesale_price = $2, retail_price = $3, updated_at = NOW()
         WHERE id = $4 AND company_id = $5`,
        [c.newCost, c.newWholesalePrice, c.newRetailPrice, c.id, companyId],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return changes;
}
