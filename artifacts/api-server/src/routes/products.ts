import { Router, type IRouter } from "express";
import { eq, ilike, and, sql, or, isNull, ne } from "drizzle-orm";
import { db } from "@workspace/db";
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
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";

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
        ilike(productsTable.brand, `%${search}%`)
      )
    );
  }
  if (group) conditions.push(eq(productsTable.group, group));
  if (brand) conditions.push(eq(productsTable.brand, brand));
  if (forSale === true) conditions.push(eq(productsTable.notForSale, false));
  if (forManufacturing === true) conditions.push(eq(productsTable.addForManufacturing, true));

  const products = await db
    .select()
    .from(productsTable)
    .where(and(...conditions))
    .orderBy(productsTable.name);

  res.json(products.map(formatProduct));
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
    if (data.wholesaleMargin != null) wholesalePrice = purchase + Number(data.wholesaleMargin);
    if (data.retailMargin != null) retailPrice = purchase + Number(data.retailMargin);
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
        litersPerBox: data.litersPerBox != null ? String(data.litersPerBox) : undefined,
        unitsPerBox: data.unitsPerBox != null ? String(data.unitsPerBox) : undefined,
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
        hsnCode?: string;
        taxRate?: number;
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
      if (u.hsnCode !== undefined) patch.hsnCode = u.hsnCode;
      if (u.taxRate !== undefined) patch.taxRate = String(u.taxRate);

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
      if (data.wholesaleMargin != null) data.wholesalePrice = purchase + Number(data.wholesaleMargin);
      if (data.retailMargin != null) data.retailPrice = purchase + Number(data.retailMargin);
    }
  }

  const updateData: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) updateData[k] = v;
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
router.post("/products/:id/stock-movements", async (req, res): Promise<void> => {
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
    mrp: Number(p.mrp),
    minSalePrice: p.minSalePrice != null ? Number(p.minSalePrice) : null,
    currentStock: Number(p.currentStock),
    openingStock: p.openingStock != null ? Number(p.openingStock) : null,
    openingStockValue: p.openingStockValue != null ? Number(p.openingStockValue) : null,
    pricingBasis: p.pricingBasis,
    wholesaleMargin: p.wholesaleMargin != null ? Number(p.wholesaleMargin) : null,
    retailMargin: p.retailMargin != null ? Number(p.retailMargin) : null,
    hsnCode: p.hsnCode ?? null,
    taxRate: p.taxRate != null ? Number(p.taxRate) : null,
    commissionPerLiter: p.commissionPerLiter != null ? Number(p.commissionPerLiter) : null,
    litersPerBox: p.litersPerBox != null ? Number(p.litersPerBox) : null,
    unitsPerBox: p.unitsPerBox != null ? Number(p.unitsPerBox) : null,
    notForSale: p.notForSale,
    addForManufacturing: p.addForManufacturing,
    minStockThreshold: p.minStockThreshold != null ? Number(p.minStockThreshold) : null,
    imageUrl: p.imageUrl ?? null,
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

export default router;
