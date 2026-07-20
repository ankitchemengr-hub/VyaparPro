import { Router, type IRouter } from "express";
import { eq, and, ilike } from "drizzle-orm";
import { db } from "@workspace/db";
import { brandsTable } from "@workspace/db";
import { CreateBrandBody, UpdateBrandParams, UpdateBrandBody, DeleteBrandParams } from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

function formatBrand(b: typeof brandsTable.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    createdAt: b.createdAt.toISOString(),
  };
}

// GET /brands
router.get("/brands", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const brands = await db
    .select()
    .from(brandsTable)
    .where(eq(brandsTable.companyId, companyId))
    .orderBy(brandsTable.name);
  res.json(brands.map(formatBrand));
});

// POST /brands
router.post("/brands", async (req, res): Promise<void> => {
  const parsed = CreateBrandBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Brand name is required" });
    return;
  }

  const [existing] = await db
    .select({ id: brandsTable.id })
    .from(brandsTable)
    .where(and(eq(brandsTable.companyId, companyId), ilike(brandsTable.name, name)));
  if (existing) {
    res.status(409).json({ error: `Brand "${name}" already exists` });
    return;
  }

  const [created] = await db.insert(brandsTable).values({ companyId, name }).returning();
  res.status(201).json(formatBrand(created));
});

// PATCH /brands/:id
router.patch("/brands/:id", async (req, res): Promise<void> => {
  const params = UpdateBrandParams.safeParse(req.params);
  const parsed = UpdateBrandBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: (params.error ?? parsed.error)?.message });
    return;
  }
  const companyId = getCompanyId(req);
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Brand name is required" });
    return;
  }

  const [existing] = await db
    .select({ id: brandsTable.id })
    .from(brandsTable)
    .where(and(eq(brandsTable.companyId, companyId), ilike(brandsTable.name, name)));
  if (existing && existing.id !== params.data.id) {
    res.status(409).json({ error: `Brand "${name}" already exists` });
    return;
  }

  const [updated] = await db
    .update(brandsTable)
    .set({ name })
    .where(and(eq(brandsTable.companyId, companyId), eq(brandsTable.id, params.data.id)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }
  res.json(formatBrand(updated));
});

// DELETE /brands/:id
router.delete("/brands/:id", async (req, res): Promise<void> => {
  const params = DeleteBrandParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [deleted] = await db
    .delete(brandsTable)
    .where(and(eq(brandsTable.companyId, companyId), eq(brandsTable.id, params.data.id)))
    .returning({ id: brandsTable.id });
  if (!deleted) {
    res.status(404).json({ error: "Brand not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
