import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  rewardSchemesTable,
  rewardProgressTable,
  productsTable,
  entitiesTable,
} from "@workspace/db";
import {
  CreateRewardSchemeBody,
  UpdateRewardSchemeParams,
  UpdateRewardSchemeBody,
  DeleteRewardSchemeParams,
  ListRewardProgressQueryParams,
  DisburseRewardParams,
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// GET /reward-schemes
router.get("/reward-schemes", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const schemes = await db
    .select({
      scheme: rewardSchemesTable,
      productName: productsTable.name,
    })
    .from(rewardSchemesTable)
    .leftJoin(
      productsTable,
      and(
        eq(rewardSchemesTable.productId, productsTable.id),
        eq(productsTable.companyId, companyId)
      )
    )
    .where(eq(rewardSchemesTable.companyId, companyId));

  res.json(schemes.map(({ scheme, productName }) => formatScheme(scheme, productName)));
});

// POST /reward-schemes
router.post("/reward-schemes", async (req, res): Promise<void> => {
  const parsed = CreateRewardSchemeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [scheme] = await db.insert(rewardSchemesTable).values({
    ...parsed.data,
    companyId,
    startDate: new Date(parsed.data.startDate),
    endDate: new Date(parsed.data.endDate),
    targetLiters: String(parsed.data.targetLiters),
  }).returning();

  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, scheme.productId)));
  res.status(201).json(formatScheme(scheme, product?.name ?? null));
});

// PATCH /reward-schemes/:id
router.patch("/reward-schemes/:id", async (req, res): Promise<void> => {
  const params = UpdateRewardSchemeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateRewardSchemeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const updateData: any = { ...parsed.data };
  if (parsed.data.startDate) updateData.startDate = new Date(parsed.data.startDate);
  if (parsed.data.endDate) updateData.endDate = new Date(parsed.data.endDate);
  if (parsed.data.targetLiters) updateData.targetLiters = String(parsed.data.targetLiters);

  const [scheme] = await db.update(rewardSchemesTable)
    .set(updateData)
    .where(and(eq(rewardSchemesTable.companyId, companyId), eq(rewardSchemesTable.id, params.data.id)))
    .returning();

  if (!scheme) {
    res.status(404).json({ error: "Scheme not found" });
    return;
  }

  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, scheme.productId)));
  res.json(formatScheme(scheme, product?.name ?? null));
});

// DELETE /reward-schemes/:id
router.delete("/reward-schemes/:id", async (req, res): Promise<void> => {
  const params = DeleteRewardSchemeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [scheme] = await db.delete(rewardSchemesTable).where(and(eq(rewardSchemesTable.companyId, companyId), eq(rewardSchemesTable.id, params.data.id))).returning();
  if (!scheme) {
    res.status(404).json({ error: "Scheme not found" });
    return;
  }
  res.sendStatus(204);
});

// GET /reward-progress
router.get("/reward-progress", async (req, res): Promise<void> => {
  const params = ListRewardProgressQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const conditions: any[] = [eq(rewardProgressTable.companyId, companyId)];
  if (params.data.customerId) conditions.push(eq(rewardProgressTable.customerId, params.data.customerId));

  const rows = await db
    .select({
      progress: rewardProgressTable,
      scheme: rewardSchemesTable,
      customerName: entitiesTable.name,
      productName: productsTable.name,
    })
    .from(rewardProgressTable)
    .leftJoin(
      rewardSchemesTable,
      and(
        eq(rewardProgressTable.schemeId, rewardSchemesTable.id),
        eq(rewardSchemesTable.companyId, companyId)
      )
    )
    .leftJoin(
      entitiesTable,
      and(
        eq(rewardProgressTable.customerId, entitiesTable.id),
        eq(entitiesTable.companyId, companyId)
      )
    )
    .leftJoin(
      productsTable,
      and(
        eq(rewardSchemesTable.productId, productsTable.id),
        eq(productsTable.companyId, companyId)
      )
    )
    .where(and(...conditions));

  res.json(rows.map(({ progress, scheme, customerName, productName }) =>
    formatProgress(progress, scheme, customerName, productName)
  ));
});

// POST /reward-progress/:id/disburse
router.post("/reward-progress/:id/disburse", async (req, res): Promise<void> => {
  const params = DisburseRewardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [progress] = await db.update(rewardProgressTable)
    .set({ isDisbursed: true, disbursedAt: new Date() })
    .where(and(eq(rewardProgressTable.companyId, companyId), eq(rewardProgressTable.id, params.data.id)))
    .returning();

  if (!progress) {
    res.status(404).json({ error: "Reward progress not found" });
    return;
  }

  const [scheme] = await db.select().from(rewardSchemesTable).where(and(eq(rewardSchemesTable.companyId, companyId), eq(rewardSchemesTable.id, progress.schemeId)));
  const [entity] = await db.select({ name: entitiesTable.name }).from(entitiesTable).where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, progress.customerId)));
  const [product] = await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, scheme?.productId ?? 0)));

  res.json(formatProgress(progress, scheme, entity?.name ?? null, product?.name ?? null));
});

function formatScheme(s: any, productName: string | null) {
  return {
    id: s.id,
    schemeName: s.schemeName ?? null,
    productId: s.productId,
    productName: productName ?? null,
    targetLiters: Number(s.targetLiters),
    rewardType: s.rewardType,
    rewardValue: s.rewardValue,
    startDate: s.startDate?.toISOString?.() ?? s.startDate,
    endDate: s.endDate?.toISOString?.() ?? s.endDate,
    isActive: s.isActive,
    createdAt: s.createdAt?.toISOString?.() ?? s.createdAt,
  };
}

function formatProgress(p: any, scheme: any, customerName: string | null, productName: string | null) {
  const achieved = Number(p.litersAchieved);
  const target = scheme ? Number(scheme.targetLiters) : 1;
  const pct = Math.min(100, Math.round((achieved / target) * 100));
  return {
    id: p.id,
    schemeId: p.schemeId,
    customerId: p.customerId,
    customerName: customerName ?? null,
    productName: productName ?? null,
    targetLiters: target,
    litersAchieved: achieved,
    progressPct: pct,
    isRewardAchieved: p.isRewardAchieved,
    isDisbursed: p.isDisbursed,
    rewardType: scheme?.rewardType ?? "",
    rewardValue: scheme?.rewardValue ?? "",
    schemeEndDate: scheme?.endDate?.toISOString?.() ?? "",
  };
}

export default router;
