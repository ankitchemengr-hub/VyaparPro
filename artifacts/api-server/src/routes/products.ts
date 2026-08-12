import { Router, type IRouter } from "express";
import { eq, ilike, and, sql, or, isNull, ne, gte, lte, getTableColumns } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  productsTable,
  stockMovementsTable,
} from "@workspace/db";
import {
  ListProductsQueryParams,
  CreateProductBody,
  GetProductParams,
  UpdateProductParams,
  UpdateProductBody,
  DeleteProductParams,
  GetProductStockMovementsParams,
  CreateStockMovementParams,
  CreateStockMovementBody,
  BulkStockReconciliationBody,
} from "@workspace/api-zod";
import { getCompanyId, handleTenantError } from "../lib/tenant";
import { computeProductCosts } from "../lib/bom-cost";
import { computeRecalculation, applyRecalculation } from "../lib/recalculate-prices";
import { buildProductImageUrl, decodeProductImageDataUrl } from "../lib/product-image";

const router: IRouter = Router();

// GET /products
router.get("/products", async (req, res): Promise<void> => {
  const params = ListProductsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const { search, group, brand, forSale, forManufacturing } = params.data;

  const conditions: any[] = [
    eq(productsTable.companyId, companyId),
    isNull(productsTable.deletedAt),
  ];

  if (search) {
    conditions.push(
      or(
        ilike(productsTable.name, `%${search}%`),
        ilike(productsTable.itemCode, `%${search}%`),
        ilike(productsTable.brand, `%${search}%`),
        ilike(productsTable.group, `%${search}%`)
      )
    );
  }
  if (group) conditions.push(eq(productsTable.group, group));
  if (brand) conditions.push(eq(productsTable.brand, brand));
  if (forSale === true) conditions.push(eq(productsTable.notForSale, false));
  if (forManufacturing === true) conditions.push(eq(productsTable.addForManufacturing, true));

  // Every other column, minus the (potentially multi-MB, base64) imageUrl
  // text column — a search/list response has no business carrying full image
  // bytes for every row on every keystroke. `hasImage` is enough for
  // formatProduct() to build the lightweight, cacheable image URL below.
  const { imageUrl: _imageUrlCol, ...listColumns } = getTableColumns(productsTable);
  const products = await db
    .select({ ...listColumns, hasImage: sql<boolean>`${productsTable.imageUrl} is not null` })
    .from(productsTable)
    .where(and(...conditions))
    .orderBy(productsTable.name);

  // Live recipe-cost rollup for manufactured items, so Price List can show
  // what a BOM product actually costs to make right now — separate from
  // purchasePrice, which only gets synced to this when "Recalculate Prices"
  // is run and can otherwise drift as raw material rates change. Costed
  // against every company product (not just this filtered/searched page),
  // since a recipe's raw materials may not themselves match the filter.
  const bomRows = await pool.query(
    `SELECT b.finished_product_id, b.output_quantity, bi.material_product_id, bi.quantity
     FROM boms b
     JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
     WHERE b.company_id = $1`,
    [companyId],
  );
  let manufacturingCosts = new Map<number, number>();
  let finishedProductIds = new Set<number>();
  if (bomRows.rows.length > 0) {
    const bomItems = bomRows.rows.map((r: any) => ({
      finishedProductId: r.finished_product_id,
      materialProductId: r.material_product_id,
      quantity: r.quantity,
      outputQuantity: r.output_quantity,
    }));
    finishedProductIds = new Set(bomItems.map((b) => b.finishedProductId));
    const allProducts = await db
      .select({ id: productsTable.id, purchasePrice: productsTable.purchasePrice })
      .from(productsTable)
      .where(and(eq(productsTable.companyId, companyId), isNull(productsTable.deletedAt)));
    manufacturingCosts = computeProductCosts(allProducts, bomItems);
  }

  res.json(products.map((p) => ({
    ...formatProduct(p),
    manufacturingCost: finishedProductIds.has(p.id)
      ? Math.round((manufacturingCosts.get(p.id) ?? 0) * 100) / 100
      : null,
  })));
});

// POST /products
router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const data = parsed.data;

  // Prevent duplicate item codes within the same company.
  const newItemCode = data.itemCode?.trim();
  if (newItemCode) {
    const [dupe] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(eq(productsTable.companyId, companyId), eq(productsTable.itemCode, newItemCode)));
    if (dupe) {
      res.status(409).json({ error: `Item code "${newItemCode}" already exists` });
      return;
    }
  }

  // Compute prices based on pricing basis
  let retailPrice = data.retailPrice;
  let wholesalePrice = data.wholesalePrice;

  if (data.pricingBasis === "fixed_margin" && data.purchasePrice != null) {
    const purchase = Number(data.purchasePrice);
    if (data.wholesaleMargin != null) wholesalePrice = purchase * (1 + Number(data.wholesaleMargin) / 100);
    if (data.retailMargin != null) retailPrice = purchase * (1 + Number(data.retailMargin) / 100);
  }

  try {
    const [product] = await db
      .insert(productsTable)
      .values({
        ...data,
        companyId,
        itemCode: newItemCode ?? data.itemCode,
        purchasePrice: String(data.purchasePrice ?? 0),
        retailPrice: String(retailPrice),
        wholesalePrice: String(wholesalePrice),
        mrp: String(data.mrp),
        currentStock: String(data.openingStock ?? 0),
        minSalePrice: data.minSalePrice != null ? String(data.minSalePrice) : undefined,
        openingStock: data.openingStock != null ? String(data.openingStock) : undefined,
        openingStockValue: data.openingStockValue != null ? String(data.openingStockValue) : undefined,
        wholesaleMargin: data.wholesaleMargin != null ? String(data.wholesaleMargin) : undefined,
        retailMargin: data.retailMargin != null ? String(data.retailMargin) : undefined,
        taxRate: data.taxRate != null ? String(data.taxRate) : undefined,
        commissionPerLiter: data.commissionPerLiter != null ? String(data.commissionPerLiter) : undefined,
        volumeUnit: (data as any).volumeUnit ?? undefined,
        litersPerBox: data.litersPerBox != null ? String(data.litersPerBox) : undefined,
        unitsPerBox: data.unitsPerBox != null ? String(data.unitsPerBox) : undefined,
        nonGstPrice: (data as any).nonGstPrice != null ? String((data as any).nonGstPrice) : undefined,
        minStockThreshold: data.minStockThreshold != null ? String(data.minStockThreshold) : undefined,
      })
      .returning();

    // Log opening stock movement if any
    if (data.openingStock && Number(data.openingStock) > 0) {
      await db.insert(stockMovementsTable).values({
        companyId,
        productId: product.id,
        type: "inward",
        quantity: String(data.openingStock),
        reason: "Opening stock",
        userId: (req as any).session?.userId ?? 1,
      });
    }

    res.status(201).json(formatProduct(product));
  } catch (e: any) {
    // Race backstop: the (company_id, item_code) unique index can still reject
    // a concurrent insert that slipped past the pre-check above.
    if (String(e?.message ?? "").toLowerCase().includes("unique")) {
      res.status(409).json({ error: `Item code "${newItemCode ?? data.itemCode}" already exists` });
      return;
    }
    throw e;
  }
});

// GET /products/groups
router.get("/products/groups", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const result = await db
    .selectDistinct({ group: productsTable.group })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), isNull(productsTable.deletedAt)))
    .orderBy(productsTable.group);
  res.json(result.map((r) => r.group));
});

// GET /products/brands
router.get("/products/brands", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const result = await db
    .selectDistinct({ brand: productsTable.brand })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), isNull(productsTable.deletedAt)))
    .orderBy(productsTable.brand);
  res.json(result.map((r) => r.brand));
});

// GET /products/packaging-units
router.get("/products/packaging-units", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const result = await db
    .selectDistinct({ packagingUnit: productsTable.packagingUnit })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), isNull(productsTable.deletedAt)))
    .orderBy(productsTable.packagingUnit);
  res.json(result.map((r) => r.packagingUnit));
});

// GET /products/stock-adjustments — report of all "adjustment" type stock
// movements across the company's products, filterable by product and date
// range. Registered before GET /products/:id so Express does not swallow
// the literal path segment "stock-adjustments" as an :id param.
router.get("/products/stock-adjustments", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const companyId = getCompanyId(req);
  const { productId, from, to } = req.query as { productId?: string; from?: string; to?: string };

  const conditions: any[] = [
    eq(stockMovementsTable.companyId, companyId),
    eq(stockMovementsTable.type, "adjustment"),
  ];

  const pid = productId ? Number(productId) : NaN;
  if (!isNaN(pid)) conditions.push(eq(stockMovementsTable.productId, pid));
  if (from) conditions.push(gte(stockMovementsTable.createdAt, new Date(`${from}T00:00:00`)));
  if (to) conditions.push(lte(stockMovementsTable.createdAt, new Date(`${to}T23:59:59.999`)));

  const rows = await db
    .select({
      id: stockMovementsTable.id,
      productId: stockMovementsTable.productId,
      productName: productsTable.name,
      itemCode: productsTable.itemCode,
      unit: productsTable.unit,
      quantity: stockMovementsTable.quantity,
      reason: stockMovementsTable.reason,
      referenceType: stockMovementsTable.referenceType,
      createdAt: stockMovementsTable.createdAt,
    })
    .from(stockMovementsTable)
    .innerJoin(productsTable, eq(productsTable.id, stockMovementsTable.productId))
    .where(and(...conditions))
    .orderBy(sql`${stockMovementsTable.createdAt} DESC`);

  res.json(
    rows.map((r) => ({
      id: r.id,
      productId: r.productId,
      productName: r.productName,
      itemCode: r.itemCode,
      unit: r.unit,
      quantity: Number(r.quantity),
      reason: r.reason,
      referenceType: r.referenceType ?? null,
      createdAt: r.createdAt?.toISOString(),
    })),
  );
});

// GET /products/recalculate-preview — admin only. Dry-run: shows what
// "Recalculate Prices" would change without writing anything.
router.get("/products/recalculate-preview", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only admin can recalculate prices" });
    return;
  }
  const companyId = getCompanyId(req);
  const changes = await computeRecalculation(companyId);
  res.json(changes);
});

// POST /products/recalculate-apply — admin only. Applies the same
// computation as the preview and writes purchasePrice/wholesalePrice/
// retailPrice for every product whose recipe cost has moved.
router.post("/products/recalculate-apply", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only admin can recalculate prices" });
    return;
  }
  const companyId = getCompanyId(req);
  const changes = await applyRecalculation(companyId);
  res.json({ updated: changes.length, items: changes });
});

// GET /products/:id
router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [product] = await db
    .select()
    .from(productsTable)
    .where(
      and(
        eq(productsTable.companyId, companyId),
        eq(productsTable.id, params.data.id),
        isNull(productsTable.deletedAt)
      )
    );

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.json(formatProduct(product));
});

// GET /products/:id/image — serves the product photo as a real, cacheable
// HTTP resource (see lib/product-image.ts for why this exists). Not part of
// the JSON API surface — the frontend just points an <img> tag at the URL
// formatProduct() already builds, so this intentionally isn't in openapi.yaml.
router.get("/products/:id/image", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).end();
    return;
  }
  const companyId = getCompanyId(req);
  const [product] = await db
    .select({ imageUrl: productsTable.imageUrl })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)));

  const decoded = product?.imageUrl ? decodeProductImageDataUrl(product.imageUrl) : null;
  if (!decoded) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", decoded.mimeType);
  // Safe to cache indefinitely — the `v=` query param changes whenever the
  // image itself does (see buildProductImageUrl), so this exact URL never
  // points at stale content.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.send(decoded.bytes);
});

// GET /products/:id/recent-prices — last 3 sale and purchase prices, so
// billing/purchase entry can show what this product last went for instead of
// relying solely on the (possibly stale) static price fields on the product.
router.get("/products/:id/recent-prices", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const productId = params.data.id;

  const [salesRes, purchasesRes] = await Promise.all([
    pool.query(
      `SELECT ii.rate, i.invoice_date AS date
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = ii.company_id
       WHERE ii.company_id = $1 AND ii.product_id = $2 AND i.status = 'saved'
       ORDER BY i.invoice_date DESC, i.id DESC
       LIMIT 3`,
      [companyId, productId],
    ),
    pool.query(
      `SELECT pi.rate, p.bill_date AS date
       FROM purchase_items pi
       JOIN purchases p ON p.id = pi.purchase_id AND p.company_id = pi.company_id
       WHERE pi.company_id = $1 AND pi.product_id = $2 AND p.status != 'cancelled'
       ORDER BY p.bill_date DESC, p.id DESC
       LIMIT 3`,
      [companyId, productId],
    ),
  ]);

  res.json({
    lastSalePrices: salesRes.rows.map((r) => ({ rate: Number(r.rate), date: new Date(r.date).toISOString() })),
    lastPurchasePrices: purchasesRes.rows.map((r) => ({ rate: Number(r.rate), date: new Date(r.date).toISOString() })),
  });
});

// PATCH /products/bulk-price  — update pricing for multiple products at once.
// Must be registered BEFORE PATCH /products/:id so Express does not swallow
// the literal path segment "bulk-price" as an :id param.
// Only touches price-related fields; all historical invoice_items are unaffected.
router.patch("/products/bulk-price", async (req, res): Promise<void> => {
  try {
    const { updates } = req.body as {
      updates: Array<{
        id: number;
        purchasePrice?: number;
        wholesalePrice?: number;
        retailPrice?: number;
        nonGstPrice?: number | null;
        hsnCode?: string;
        taxRate?: number;
        nonGstMarginPct?: number | null;
        retailMarginPct?: number | null;
        wholesaleMarginPct?: number | null;
      }>;
    };

    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({ error: "updates must be a non-empty array" });
      return;
    }

    const companyId = getCompanyId(req);
    const ids = updates.map((u) => Number(u.id)).filter((n) => !isNaN(n));

    // Verify all ids belong to this company before writing anything.
    const owned = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(eq(productsTable.companyId, companyId), isNull(productsTable.deletedAt)));

    const ownedSet = new Set(owned.map((r) => r.id));
    const illegal = ids.filter((id) => !ownedSet.has(id));
    if (illegal.length > 0) {
      res.status(403).json({ error: `Products not found in your company: ${illegal.join(", ")}` });
      return;
    }

    const results: any[] = [];
    for (const u of updates) {
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (u.purchasePrice !== undefined) patch.purchasePrice = String(u.purchasePrice);
      if (u.wholesalePrice !== undefined) patch.wholesalePrice = String(u.wholesalePrice);
      if (u.retailPrice !== undefined) patch.retailPrice = String(u.retailPrice);
      if (u.nonGstPrice !== undefined) patch.nonGstPrice = u.nonGstPrice != null ? String(u.nonGstPrice) : null;
      if (u.hsnCode !== undefined) patch.hsnCode = u.hsnCode;
      if (u.taxRate !== undefined) patch.taxRate = String(u.taxRate);
      if (u.nonGstMarginPct !== undefined) patch.nonGstMarginPct = u.nonGstMarginPct != null ? String(u.nonGstMarginPct) : null;
      if (u.retailMarginPct !== undefined) patch.retailMarginPct = u.retailMarginPct != null ? String(u.retailMarginPct) : null;
      if (u.wholesaleMarginPct !== undefined) patch.wholesaleMarginPct = u.wholesaleMarginPct != null ? String(u.wholesaleMarginPct) : null;

      const [updated] = await db
        .update(productsTable)
        .set(patch)
        .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, Number(u.id))))
        .returning();

      if (updated) results.push(formatProduct(updated));
    }

    res.json({ updated: results.length, products: results });
  } catch (e) {
    if (handleTenantError(e, res)) return;
    throw e;
  }
});

// PATCH /products/:id
router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const data = parsed.data;

  // Prevent renaming to an item code already used by another product.
  if (data.itemCode != null) {
    const itemCode = data.itemCode.trim();
    data.itemCode = itemCode;
    const [dupe] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(
        and(
          eq(productsTable.companyId, companyId),
          eq(productsTable.itemCode, itemCode),
          ne(productsTable.id, params.data.id),
        ),
      );
    if (dupe) {
      res.status(409).json({ error: `Item code "${itemCode}" already exists` });
      return;
    }
  }

  // Recompute prices if fixed margin
  if (data.pricingBasis === "fixed_margin") {
    const [existing] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)));
    if (existing) {
      const purchase = Number(data.purchasePrice ?? existing.purchasePrice);
      if (data.wholesaleMargin != null) data.wholesalePrice = purchase * (1 + Number(data.wholesaleMargin) / 100);
      if (data.retailMargin != null) data.retailPrice = purchase * (1 + Number(data.retailMargin) / 100);
    }
  }

 const updateData: Record<string, any> = {};
for (const [k, v] of Object.entries(data)) {
  if (v !== undefined) updateData[k] = v;
}
// Explicitly handle nonGstPrice
if ((data as any).nonGstPrice !== undefined) {
  updateData.nonGstPrice = (data as any).nonGstPrice != null 
    ? String((data as any).nonGstPrice) 
    : null;
}

  try {
    const [product] = await db
      .update(productsTable)
      .set(updateData)
      .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)))
      .returning();

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    res.json(formatProduct(product));
  } catch (e: any) {
    // Race backstop for the (company_id, item_code) unique index.
    if (String(e?.message ?? "").toLowerCase().includes("unique")) {
      res.status(409).json({ error: `Item code "${data.itemCode}" already exists` });
      return;
    }
    throw e;
  }
});

// DELETE /products/:id
router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);

  // Soft-delete: products are referenced by invoice_items, stock_movements,
  // BOMs, and rewards. A hard DELETE would either violate FK constraints or
  // destroy historical invoice/audit context. Instead we set deleted_at so
  // the product disappears from catalog/inventory listings while existing
  // references continue to resolve.
  const [product] = await db
    .update(productsTable)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(productsTable.companyId, companyId),
        eq(productsTable.id, params.data.id),
        isNull(productsTable.deletedAt)
      )
    )
    .returning();

  if (!product) {
    // Either no such product, or it was already deleted — treat both as 404
    // so the UI's optimistic refresh resolves cleanly.
    res.status(404).json({ error: "Product not found" });
    return;
  }

  res.sendStatus(204);
});

// GET /products/:id/stock-movements
router.get("/products/:id/stock-movements", async (req, res): Promise<void> => {
  const params = GetProductStockMovementsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const movements = await db
    .select()
    .from(stockMovementsTable)
    .where(
      and(
        eq(stockMovementsTable.companyId, companyId),
        eq(stockMovementsTable.productId, params.data.id)
      )
    )
    .orderBy(sql`${stockMovementsTable.createdAt} DESC`);

  res.json(movements.map(formatMovement));
});
// POST /products/:id/stock-movements
// Admin-only: this endpoint directly mutates stock quantities (used for
// damage write-offs and physical stock reconciliation adjustments), so it
// must not be reachable by salesman or other non-admin roles.
router.post("/products/:id/stock-movements", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const params = CreateStockMovementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateStockMovementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const userId = session?.userId ?? 1;

  // Ensure the target product belongs to this company before mutating stock.
  const [owned] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)));
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const [movement] = await db.insert(stockMovementsTable).values({
    companyId,
    productId: params.data.id,
    type: parsed.data.type,
    quantity: String(parsed.data.quantity),
    reason: parsed.data.reason,
    referenceId: parsed.data.referenceId ?? null,
    referenceType: parsed.data.referenceType ?? null,
    userId,
  }).returning();

  // Update stock.
  // - inward / manufacturing_produce: quantity is always entered positive, adds to stock.
  // - outward / manufacturing_consume / damage: quantity is always entered positive, subtracts from stock.
  // - adjustment: quantity is a SIGNED difference (e.g. from physical stock
  //   reconciliation) — positive means more was counted than the system
  //   shows, negative means less. Applied as-is, in either direction.
  const delta =
    parsed.data.type === "adjustment"
      ? parsed.data.quantity
      : ["inward", "manufacturing_produce"].includes(parsed.data.type)
        ? parsed.data.quantity
        : -parsed.data.quantity;

  await db
    .update(productsTable)
    .set({ currentStock: sql`${productsTable.currentStock} + ${delta}` })
    .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)));

  res.status(201).json(formatMovement(movement));
});

// POST /products/stock-reconciliation
// Admin-only bulk endpoint for physical stock reconciliation: takes a list
// of { productId, countedStock, reason } entries, computes the signed
// difference against each product's current system stock, and records one
// "adjustment" stock movement + stock update per item, all in a single
// transaction (all succeed or all roll back together).
router.post("/products/stock-reconciliation", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const parsed = BulkStockReconciliationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const userId = session?.userId ?? 1;
  const items = parsed.data.items.filter((i) => i.countedStock != null);

  if (items.length === 0) {
    res.json({ adjustments: [] });
    return;
  }

  const results: any[] = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const item of items) {
      const productRows = await client.query(
        `SELECT id, current_stock FROM products WHERE id = $1 AND company_id = $2`,
        [item.productId, companyId]
      );
      const product = productRows.rows[0];
      if (!product) continue; // skip products that don't belong to this company

      const systemStock = Number(product.current_stock);
      const delta = item.countedStock - systemStock;

      // Skip items where the count matches — no adjustment needed, no log entry.
      if (delta === 0) continue;

      const movementRows = await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_type, user_id)
         VALUES ($1, $2, 'adjustment', $3, $4, 'stock_reconciliation', $5)
         RETURNING *`,
        [companyId, item.productId, String(delta), item.reason || "Physical stock reconciliation", userId]
      );

      await client.query(
        `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`,
        [delta, item.productId, companyId]
      );

      results.push(formatRawMovement(movementRows.rows[0]));
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ adjustments: results });
});
// POST /products/:id/stock-movements
router.post("/products/:id/stock-movements", async (req, res): Promise<void> => {
  const params = CreateStockMovementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;  }

  const parsed = CreateStockMovementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const userId = session?.userId ?? 1;

  // Ensure the target product belongs to this company before mutating stock.
  const [owned] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)));
  if (!owned) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const [movement] = await db.insert(stockMovementsTable).values({
    companyId,
    productId: params.data.id,
    type: parsed.data.type,
    quantity: String(parsed.data.quantity),
    reason: parsed.data.reason,
    referenceId: parsed.data.referenceId ?? null,
    referenceType: parsed.data.referenceType ?? null,
    userId,
  }).returning();

  // Update stock
  const delta = ["inward", "manufacturing_produce"].includes(parsed.data.type)
    ? parsed.data.quantity
    : -parsed.data.quantity;

  await db
    .update(productsTable)
    .set({ currentStock: sql`${productsTable.currentStock} + ${delta}` })
    .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, params.data.id)));

  res.status(201).json(formatMovement(movement));
});

function formatProduct(p: any) {
  return {
    id: p.id,
    name: p.name,
    printName: p.printName ?? null,
    group: p.group,
    brand: p.brand,
    itemCode: p.itemCode,
    unit: p.unit,
    purchasePrice: Number(p.purchasePrice),
    retailPrice: Number(p.retailPrice),
    wholesalePrice: Number(p.wholesalePrice),
    nonGstPrice: p.nonGstPrice != null ? Number(p.nonGstPrice) : null,
    mrp: Number(p.mrp),
    minSalePrice: p.minSalePrice != null ? Number(p.minSalePrice) : null,
    currentStock: Number(p.currentStock),
    openingStock: p.openingStock != null ? Number(p.openingStock) : null,
    openingStockValue: p.openingStockValue != null ? Number(p.openingStockValue) : null,
    pricingBasis: p.pricingBasis,
    wholesaleMargin: p.wholesaleMargin != null ? Number(p.wholesaleMargin) : null,
    retailMargin: p.retailMargin != null ? Number(p.retailMargin) : null,
    nonGstMarginPct: p.nonGstMarginPct != null ? Number(p.nonGstMarginPct) : null,
    retailMarginPct: p.retailMarginPct != null ? Number(p.retailMarginPct) : null,
    wholesaleMarginPct: p.wholesaleMarginPct != null ? Number(p.wholesaleMarginPct) : null,
    hsnCode: p.hsnCode ?? null,
    taxRate: p.taxRate != null ? Number(p.taxRate) : null,
    commissionPerLiter: p.commissionPerLiter != null ? Number(p.commissionPerLiter) : null,
    volumeUnit: (p as any).volumeUnit ?? "liter",
    litersPerBox: p.litersPerBox != null ? Number(p.litersPerBox) : null,
    unitsPerBox: p.unitsPerBox != null ? Number(p.unitsPerBox) : null,
    packagingUnit: p.packagingUnit ?? "Box",
    notForSale: p.notForSale,
    addForManufacturing: p.addForManufacturing,
    minStockThreshold: p.minStockThreshold != null ? Number(p.minStockThreshold) : null,
    // Rows from the list query above carry `hasImage` (no raw bytes fetched);
    // rows from a full `.select()` (single-product GET, create/update
    // responses) carry the actual base64 `imageUrl` — either way the client
    // only ever sees the small, cacheable URL below, never the raw blob.
    imageUrl: (p.hasImage !== undefined ? p.hasImage : p.imageUrl != null) ? buildProductImageUrl(p.id, p.updatedAt) : null,
    createdAt: p.createdAt?.toISOString(),
    updatedAt: p.updatedAt?.toISOString(),
    
  };
}

function formatMovement(m: any) {
  return {
    id: m.id,
    productId: m.productId,
    type: m.type,
    quantity: Number(m.quantity),
    reason: m.reason,
    referenceId: m.referenceId ?? null,
    referenceType: m.referenceType ?? null,
    userId: m.userId,
    createdAt: m.createdAt?.toISOString(),
  };
}
// Same shape as formatMovement, but for rows returned by raw pool.query()
// (snake_case columns, plain Date objects) rather than Drizzle's camelCase.
function formatRawMovement(m: any) {
  return {
    id: m.id,
    productId: m.product_id,
    type: m.type,
    quantity: Number(m.quantity),
    reason: m.reason,
    referenceId: m.reference_id ?? null,
    referenceType: m.reference_type ?? null,
    userId: m.user_id,
    createdAt: m.created_at instanceof Date ? m.created_at.toISOString() : m.created_at,
  };
}
export default router;
