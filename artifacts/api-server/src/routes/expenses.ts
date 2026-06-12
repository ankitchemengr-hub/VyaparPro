import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { expensesTable, expenseCategoriesTable, usersTable } from "@workspace/db";
import {
  CreateExpenseCategoryBody,
  DeleteExpenseCategoryParams,
  CreateExpenseBody,
  DeleteExpenseParams,
  ListExpensesQueryParams,
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const WRITE_ROLES = new Set(["admin", "accountant"]);
const READ_ROLES = new Set(["admin", "accountant"]);

function requireRead(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !READ_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}
function requireWrite(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !WRITE_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function formatCategory(c: any) {
  return {
    id: c.id,
    name: c.name,
    isActive: c.isActive ?? c.is_active ?? true,
    createdAt: (c.createdAt ?? c.created_at)?.toISOString
      ? (c.createdAt ?? c.created_at).toISOString()
      : (c.createdAt ?? c.created_at),
  };
}

function formatExpense(e: any, userName?: string | null) {
  return {
    id: e.id,
    date: e.date,
    categoryId: e.categoryId ?? e.category_id ?? null,
    categoryName: e.categoryName ?? e.category_name,
    amount: Number(e.amount),
    paymentMode: e.paymentMode ?? e.payment_mode,
    paidTo: e.paidTo ?? e.paid_to ?? null,
    notes: e.notes ?? null,
    createdByUserId: e.createdByUserId ?? e.created_by_user_id ?? null,
    createdByUserName: userName ?? null,
    createdAt: (e.createdAt ?? e.created_at)?.toISOString
      ? (e.createdAt ?? e.created_at).toISOString()
      : (e.createdAt ?? e.created_at),
  };
}

// GET /expense-categories
router.get("/expense-categories", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  const rows = await db
    .select()
    .from(expenseCategoriesTable)
    .where(eq(expenseCategoriesTable.companyId, companyId))
    .orderBy(sql`${expenseCategoriesTable.isActive} DESC, ${expenseCategoriesTable.name}`);
  // Seed defaults if empty
  if (rows.length === 0) {
    const defaults = ["Rent", "Electricity", "Transport", "Salary", "Office Supplies", "Repair & Maintenance", "Travel", "Misc"];
    const inserted = await db
      .insert(expenseCategoriesTable)
      .values(defaults.map((name) => ({ name, companyId })))
      .returning();
    res.json(inserted.map(formatCategory));
    return;
  }
  res.json(rows.map(formatCategory));
});

// POST /expense-categories
router.post("/expense-categories", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const parsed = CreateExpenseCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  try {
    const [created] = await db
      .insert(expenseCategoriesTable)
      .values({ name: parsed.data.name, companyId })
      .returning();
    res.status(201).json(formatCategory(created));
  } catch (e: any) {
    if (String(e?.message ?? "").includes("unique")) {
      res.status(409).json({ error: "Category name already exists" });
      return;
    }
    throw e;
  }
});

// DELETE /expense-categories/:id (soft)
router.delete("/expense-categories/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const params = DeleteExpenseCategoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  await db
    .update(expenseCategoriesTable)
    .set({ isActive: false })
    .where(and(eq(expenseCategoriesTable.companyId, companyId), eq(expenseCategoriesTable.id, params.data.id)));
  res.sendStatus(204);
});

// GET /expenses
router.get("/expenses", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const parsed = ListExpensesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const conds: any[] = [eq(expensesTable.companyId, companyId)];
  if (parsed.data.from) conds.push(gte(expensesTable.date, parsed.data.from));
  if (parsed.data.to) conds.push(lte(expensesTable.date, parsed.data.to));
  if (parsed.data.categoryId) conds.push(eq(expensesTable.categoryId, parsed.data.categoryId));
  const whereExpr = and(...conds);

  const rows = await db
    .select({
      id: expensesTable.id,
      date: expensesTable.date,
      categoryId: expensesTable.categoryId,
      categoryName: expensesTable.categoryName,
      amount: expensesTable.amount,
      paymentMode: expensesTable.paymentMode,
      paidTo: expensesTable.paidTo,
      notes: expensesTable.notes,
      createdByUserId: expensesTable.createdByUserId,
      createdByUserName: usersTable.name,
      createdAt: expensesTable.createdAt,
    })
    .from(expensesTable)
    .leftJoin(usersTable, eq(usersTable.id, expensesTable.createdByUserId))
    .where(whereExpr)
    .orderBy(desc(expensesTable.date), desc(expensesTable.id));

  const items = rows.map((r) => formatExpense(r, r.createdByUserName));
  const total = items.reduce((s, e) => s + e.amount, 0);

  const byCatMap = new Map<string, { categoryId: number | null; categoryName: string; total: number }>();
  for (const it of items) {
    const key = `${it.categoryId ?? "null"}:${it.categoryName}`;
    const cur = byCatMap.get(key) ?? { categoryId: it.categoryId, categoryName: it.categoryName, total: 0 };
    cur.total += it.amount;
    byCatMap.set(key, cur);
  }
  const byCategory = Array.from(byCatMap.values()).sort((a, b) => b.total - a.total);

  res.json({ items, total, byCategory });
});

// POST /expenses
router.post("/expenses", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const [cat] = await db.select().from(expenseCategoriesTable).where(and(eq(expenseCategoriesTable.companyId, companyId), eq(expenseCategoriesTable.id, parsed.data.categoryId)));
  if (!cat) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  const [created] = await db
    .insert(expensesTable)
    .values({
      companyId,
      date: parsed.data.date,
      categoryId: parsed.data.categoryId,
      categoryName: cat.name,
      amount: String(parsed.data.amount),
      paymentMode: parsed.data.paymentMode,
      paidTo: parsed.data.paidTo ?? null,
      notes: parsed.data.notes ?? null,
      createdByUserId: session?.userId ?? null,
    })
    .returning();
  res.status(201).json(formatExpense(created));
});

// DELETE /expenses/:id
router.delete("/expenses/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const params = DeleteExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  await db.delete(expensesTable).where(and(eq(expensesTable.companyId, companyId), eq(expensesTable.id, params.data.id)));
  res.sendStatus(204);
});

export default router;
