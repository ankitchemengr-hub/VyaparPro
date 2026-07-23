// Server-side mirror of bom-dialog.tsx's client-side unitCost() — the recipe
// cost rollup previously only ever existed ephemerally in the browser while
// that dialog happened to be open, recomputed from whatever purchasePrice
// values were loaded at the time. This version runs against the live DB so
// "Recalculate Prices" can cascade a raw material's rate change through
// every recipe (including recipes-of-recipes) without a browser involved.

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
