import { Router, type IRouter } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  bomsTable,
  bomItemsTable,
  workloadCardsTable,
  productsTable,
} from "@workspace/db";
import {
  CreateBomBody,
  GetBomParams,
  UpdateBomParams,
  UpdateBomBody,
  ListWorkloadCardsQueryParams,
  CreateWorkloadCardBody,
  UpdateWorkloadCardBody,
  AssembleItemBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// GET /boms
router.get("/boms", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const boms = await db
    .select({
      bom: bomsTable,
      productName: productsTable.name,
    })
    .from(bomsTable)
    .leftJoin(productsTable, eq(bomsTable.finishedProductId, productsTable.id))
    .where(eq(bomsTable.companyId, companyId));

  const result = await Promise.all(
    boms.map(async ({ bom, productName }) => {
      const items = await db
        .select({
          item: bomItemsTable,
          materialName: productsTable.name,
        })
        .from(bomItemsTable)
        .leftJoin(productsTable, eq(bomItemsTable.materialProductId, productsTable.id))
        .where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, bom.id)));

      return formatBom(bom, productName, items);
    })
  );

  res.json(result);
});

// POST /boms — admin only
router.post("/boms", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only administrators can create BOMs" });
    return;
  }
  const parsed = CreateBomBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ body: req.body, issues: parsed.error.issues }, "BOM create validation failed");
    res.status(400).json({ error: parsed.error.message, issues: parsed.error.issues });
    return;
  }

  // Extra validation: positive quantities, no self-referencing materials, no duplicates
  if (Number(parsed.data.outputQuantity) <= 0) {
    res.status(400).json({ error: "outputQuantity must be greater than 0" });
    return;
  }
  const seenMaterials = new Set<number>();
  for (const item of parsed.data.items) {
    if (Number(item.quantity) <= 0) {
      res.status(400).json({ error: "Each material quantity must be greater than 0" });
      return;
    }
    if (item.materialProductId === parsed.data.finishedProductId) {
      res.status(400).json({ error: "A product cannot be a material of itself" });
      return;
    }
    if (seenMaterials.has(item.materialProductId)) {
      res.status(400).json({ error: "Duplicate material in BOM" });
      return;
    }
    seenMaterials.add(item.materialProductId);
  }

  // All referenced products must belong to the caller's company, or a tenant
  // could attach another company's product into their BOM.
  const productIds = [parsed.data.finishedProductId, ...parsed.data.items.map((i) => i.materialProductId)];
  const owned = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), inArray(productsTable.id, productIds)));
  const ownedIds = new Set(owned.map((p) => p.id));
  for (const pid of productIds) {
    if (!ownedIds.has(pid)) {
      res.status(400).json({ error: "Product does not belong to your company" });
      return;
    }
  }

  const client = await pool.connect();
  let bomId: number;
  try {
    await client.query("BEGIN");
    const bomResult = await client.query(
      `INSERT INTO boms (company_id, finished_product_id, output_quantity) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, parsed.data.finishedProductId, String(parsed.data.outputQuantity)],
    );
    bomId = bomResult.rows[0].id;

    if (parsed.data.items.length > 0) {
      const values: any[] = [];
      const placeholders = parsed.data.items
        .map((item, i) => {
          const b = i * 5;
          values.push(companyId, bomId, item.materialProductId, String(item.quantity), item.unit);
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
        })
        .join(", ");
      await client.query(
        `INSERT INTO bom_items (company_id, bom_id, material_product_id, quantity, unit) VALUES ${placeholders}`,
        values,
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to create BOM");
    res.status(500).json({ error: "Failed to create BOM" });
    return;
  } finally {
    client.release();
  }

  const [bom] = await db.select().from(bomsTable).where(and(eq(bomsTable.companyId, companyId), eq(bomsTable.id, bomId)));
  const items = await db
    .select({ item: bomItemsTable, materialName: productsTable.name })
    .from(bomItemsTable)
    .leftJoin(productsTable, eq(bomItemsTable.materialProductId, productsTable.id))
    .where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, bomId)));
  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, bom.finishedProductId)));

  res.status(201).json(formatBom(bom, product?.name ?? null, items));
});

// GET /boms/:id
router.get("/boms/:id", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const params = GetBomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [bom] = await db.select().from(bomsTable).where(and(eq(bomsTable.companyId, companyId), eq(bomsTable.id, params.data.id)));
  if (!bom) {
    res.status(404).json({ error: "BOM not found" });
    return;
  }

  const items = await db
    .select({ item: bomItemsTable, materialName: productsTable.name })
    .from(bomItemsTable)
    .leftJoin(productsTable, eq(bomItemsTable.materialProductId, productsTable.id))
    .where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, bom.id)));

  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, bom.finishedProductId)));

  res.json(formatBom(bom, product?.name ?? null, items));
});

// PATCH /boms/:id — admin only
router.patch("/boms/:id", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only administrators can edit BOMs" });
    return;
  }
  const params = UpdateBomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateBomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Confirm the BOM belongs to the caller's company before mutating anything.
  const [existingBom] = await db
    .select()
    .from(bomsTable)
    .where(and(eq(bomsTable.companyId, companyId), eq(bomsTable.id, params.data.id)));
  if (!existingBom) {
    res.status(404).json({ error: "BOM not found" });
    return;
  }

  const updateData: any = {};
  if (parsed.data.outputQuantity != null) updateData.outputQuantity = String(parsed.data.outputQuantity);

  let bom: any = existingBom;
  if (Object.keys(updateData).length > 0) {
    [bom] = await db
      .update(bomsTable)
      .set(updateData)
      .where(and(eq(bomsTable.companyId, companyId), eq(bomsTable.id, params.data.id)))
      .returning();
  }

  if (parsed.data.items) {
    // Validate any new material products belong to the company.
    const materialIds = parsed.data.items
      .filter((i) => i.materialProductId)
      .map((i) => i.materialProductId as number);
    if (materialIds.length > 0) {
      const owned = await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(and(eq(productsTable.companyId, companyId), inArray(productsTable.id, materialIds)));
      const ownedIds = new Set(owned.map((p) => p.id));
      for (const mid of materialIds) {
        if (!ownedIds.has(mid)) {
          res.status(400).json({ error: "Material product does not belong to your company" });
          return;
        }
      }
    }

    await db.delete(bomItemsTable).where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, params.data.id)));
    const rowsToInsert = parsed.data.items
      .filter((item) => item.materialProductId && item.quantity)
      .map((item) => ({
        companyId,
        bomId: params.data.id,
        materialProductId: item.materialProductId as number,
        quantity: String(item.quantity),
        unit: item.unit ?? "QTY",
      }));
    if (rowsToInsert.length > 0) {
      await db.insert(bomItemsTable).values(rowsToInsert);
    }
  }

  const items = await db
    .select({ item: bomItemsTable, materialName: productsTable.name })
    .from(bomItemsTable)
    .leftJoin(productsTable, eq(bomItemsTable.materialProductId, productsTable.id))
    .where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, bom.id)));

  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, bom.finishedProductId)));

  res.json(formatBom(bom, product?.name ?? null, items));
});

// GET /workload
router.get("/workload", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const params = ListWorkloadCardsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const conditions: any[] = [eq(workloadCardsTable.companyId, companyId)];
  if (params.data.status) conditions.push(eq(workloadCardsTable.status, params.data.status));

  const cards = await db
    .select({ card: workloadCardsTable, productName: productsTable.name, productImageUrl: productsTable.imageUrl })
    .from(workloadCardsTable)
    .leftJoin(productsTable, eq(workloadCardsTable.productId, productsTable.id))
    .where(and(...conditions))
    .orderBy(sql`${workloadCardsTable.createdAt} DESC`);

  res.json(cards.map(({ card, productName, productImageUrl }) => formatWorkloadCard(card, productName, productImageUrl)));
});

// POST /workload
router.post("/workload", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const parsed = CreateWorkloadCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // The product must belong to the caller's company.
  const [ownedProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.companyId, companyId)));
  if (!ownedProduct) {
    res.status(400).json({ error: "Product does not belong to your company" });
    return;
  }

  const [card] = await db.insert(workloadCardsTable).values({
    companyId,
    productId: parsed.data.productId,
    targetQty: String(parsed.data.targetQty),
    orderType: parsed.data.orderType,
    workerId: parsed.data.workerId ?? null,
    referenceOrderId: parsed.data.referenceOrderId ?? null,
    status: "pending",
  }).returning();

  const [product] = await db.select({ name: productsTable.name, imageUrl: productsTable.imageUrl })
    .from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, card.productId)));

  res.status(201).json(formatWorkloadCard(card, product?.name ?? null, product?.imageUrl ?? null));
});

// PATCH /workload/:id
router.patch("/workload/:id", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = UpdateWorkloadCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(workloadCardsTable)
    .where(and(eq(workloadCardsTable.companyId, companyId), eq(workloadCardsTable.id, id)));
  if (!existing) {
    res.status(404).json({ error: "Workload card not found" });
    return;
  }

  const updateData: any = {};
  if (parsed.data.status) {
    updateData.status = parsed.data.status;
    if (parsed.data.status === "processing" && !existing.startedAt) {
      updateData.startedAt = new Date();
    }
    if (parsed.data.status === "done") {
      updateData.completedAt = new Date();

      // If the worker provided a final produced qty at done-time, that's the
      // source of truth for both the recipe math and the persisted card.
      const finalQty = parsed.data.targetQty != null
        ? Number(parsed.data.targetQty)
        : Number(existing.targetQty);
      if (!isFinite(finalQty) || finalQty <= 0) {
        res.status(400).json({ error: "targetQty must be > 0 when marking done" });
        return;
      }
      updateData.targetQty = String(finalQty);

      const session = (req as any).session;
      const userId = session?.userId ?? 1;

      // Execute BOM recipe: consume raw materials, produce finished good
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

        const [bom] = await db
          .select()
          .from(bomsTable)
          .where(and(eq(bomsTable.companyId, companyId), eq(bomsTable.finishedProductId, existing.productId)));
        if (bom) {
          const bomItems = await db
            .select()
            .from(bomItemsTable)
            .where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, bom.id)));
          const outputQty = Number(bom.outputQuantity);
          const batchMultiplier = finalQty / outputQty;

          for (const item of bomItems) {
            const consumeQty = Number(item.quantity) * batchMultiplier;
            await client.query(
              `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
               VALUES ($1, $2, 'manufacturing_consume', $3, 'Manufacturing batch', $4, 'workload', $5)`,
              [companyId, item.materialProductId, consumeQty, id, userId],
            );
            await client.query(
              `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`,
              [consumeQty, item.materialProductId, companyId]
            );
          }
        }

        // Produce finished good
        await client.query(
          `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
           VALUES ($1, $2, 'manufacturing_produce', $3, 'Manufacturing complete', $4, 'workload', $5)`,
          [companyId, existing.productId, finalQty, id, userId],
        );
        await client.query(
          `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`,
          [finalQty, existing.productId, companyId]
        );

        await client.query("COMMIT");
      } catch (err) {
        // Propagate failure: do NOT silently mark the card as 'done' when the
        // recipe transaction rolled back — that would corrupt the stock ledger.
        await client.query("ROLLBACK");
        logger.error({ err }, "Failed to execute manufacturing recipe");
        client.release();
        res.status(500).json({ error: "Failed to execute manufacturing recipe" });
        return;
      }
      client.release();
    }
  }

  if (parsed.data.workerId != null) updateData.workerId = parsed.data.workerId;

  const [card] = await db
    .update(workloadCardsTable)
    .set(updateData)
    .where(and(eq(workloadCardsTable.companyId, companyId), eq(workloadCardsTable.id, id)))
    .returning();
  const [product] = await db.select({ name: productsTable.name, imageUrl: productsTable.imageUrl })
    .from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, card.productId)));

  res.json(formatWorkloadCard(card, product?.name ?? null, product?.imageUrl ?? null));
});

// POST /manufacturing/assemble
// Atomic: create a completed workload card, debit raw materials, credit
// finished stock, write all stock movements — all in one SERIALIZABLE
// transaction. Prevents orphan workload cards on partial failure.
router.post("/manufacturing/assemble", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const parsed = AssembleItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { bomId, batches } = parsed.data;
  if (Number(batches) <= 0) {
    res.status(400).json({ error: "batches must be greater than 0" });
    return;
  }

  const [bom] = await db.select().from(bomsTable).where(and(eq(bomsTable.companyId, companyId), eq(bomsTable.id, bomId)));
  if (!bom) {
    res.status(404).json({ error: "BOM not found" });
    return;
  }
  const bomItems = await db
    .select({
      item: bomItemsTable,
      materialName: productsTable.name,
    })
    .from(bomItemsTable)
    .leftJoin(productsTable, eq(bomItemsTable.materialProductId, productsTable.id))
    .where(and(eq(bomItemsTable.companyId, companyId), eq(bomItemsTable.bomId, bomId)));

  const outputUnits = Number(bom.outputQuantity) * Number(batches);

  const client = await pool.connect();
  let cardId: number | null = null;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Sufficiency check inside the txn so SELECT participates in the snapshot
    const shortages: Array<{
      materialProductId: number;
      materialProductName: string | null;
      required: number;
      available: number;
      unit: string;
    }> = [];
    for (const { item, materialName } of bomItems) {
      const required = Number(item.quantity) * Number(batches);
      const stockRow = await client.query(
        `SELECT current_stock FROM products WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
        [item.materialProductId, companyId],
      );
      const available = Number(stockRow.rows[0]?.current_stock ?? 0);
      if (available < required) {
        shortages.push({
          materialProductId: item.materialProductId,
          materialProductName: materialName ?? null,
          required,
          available,
          unit: item.unit,
        });
      }
    }
    if (shortages.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Insufficient raw material", shortages });
      return;
    }

    // Create the workload card already marked done — single row, no orphan state
    const session = (req as any).session;
    const userId = session?.userId ?? 1;
    const now = new Date();
    const cardRes = await client.query(
      `INSERT INTO workload_cards
         (company_id, product_id, target_qty, status, order_type, started_at, completed_at)
       VALUES ($1, $2, $3, 'done', 'production', $4, $4)
       RETURNING id`,
      [companyId, bom.finishedProductId, String(outputUnits), now],
    );
    cardId = cardRes.rows[0].id;

    for (const { item } of bomItems) {
      const consumeQty = Number(item.quantity) * Number(batches);
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'manufacturing_consume', $3, 'Manufacturing batch', $4, 'workload', $5)`,
        [companyId, item.materialProductId, consumeQty, cardId, userId],
      );
      await client.query(
        `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`,
        [consumeQty, item.materialProductId, companyId],
      );
    }

    // Credit finished good
    await client.query(
      `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
       VALUES ($1, $2, 'manufacturing_produce', $3, 'Manufacturing complete', $4, 'workload', $5)`,
      [companyId, bom.finishedProductId, outputUnits, cardId, userId],
    );
    await client.query(
      `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`,
      [outputUnits, bom.finishedProductId, companyId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Assemble failed");
    res.status(500).json({ error: "Failed to assemble item" });
    return;
  } finally {
    client.release();
  }

  const [card] = await db.select().from(workloadCardsTable).where(and(eq(workloadCardsTable.companyId, companyId), eq(workloadCardsTable.id, cardId!)));
  const [product] = await db
    .select({ name: productsTable.name, imageUrl: productsTable.imageUrl })
    .from(productsTable)
    .where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, card.productId)));
  res.status(201).json(formatWorkloadCard(card, product?.name ?? null, product?.imageUrl ?? null));
});

function formatBom(bom: any, productName: string | null, items: any[]) {
  return {
    id: bom.id,
    finishedProductId: bom.finishedProductId,
    finishedProductName: productName ?? null,
    outputQuantity: Number(bom.outputQuantity),
    items: items.map(({ item, materialName }) => ({
      id: item.id,
      bomId: item.bomId,
      materialProductId: item.materialProductId,
      materialProductName: materialName ?? null,
      quantity: Number(item.quantity),
      unit: item.unit,
    })),
    createdAt: bom.createdAt?.toISOString?.() ?? bom.createdAt,
  };
}

function formatWorkloadCard(c: any, productName: string | null, productImageUrl: string | null) {
  return {
    id: c.id,
    productId: c.productId,
    productName: productName ?? null,
    productImageUrl: productImageUrl ?? null,
    targetQty: Number(c.targetQty),
    status: c.status,
    workerId: c.workerId ?? null,
    workerName: c.workerName ?? null,
    orderType: c.orderType,
    referenceOrderId: c.referenceOrderId ?? null,
    startedAt: c.startedAt ? c.startedAt.toISOString() : null,
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    createdAt: c.createdAt?.toISOString?.() ?? c.createdAt,
  };
}

export default router;
