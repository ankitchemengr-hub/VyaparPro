import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { expensesTable, expenseCategoriesTable, usersTable } from "@workspace/db";
import {
  CreateExpenseCategoryBody,
  DeleteExpenseCategoryParams,
  CreateExpenseBody,
  DeleteExpenseParams,
  ListExpensesQueryParams,
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";
import { generateSeriesNumber } from "../lib/number-series";
import { logger } from "../lib/logger";

// expenses.payment_mode (cash | upi | bank) -> account_transactions.mode enum.
const PAYMENT_MODE_TO_TXN_MODE: Record<string, string> = {
  cash: "cash",
  upi: "upi",
  bank: "bank_transfer",
};

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
    accountId: e.accountId ?? e.account_id ?? null,
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
      accountId: expensesTable.accountId,
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

// POST /expenses — also records a matching "out" entry in Cash Book
// (account_transactions) against the chosen account, atomically, so an
// expense's cash/bank impact is never silently missing from the ledger.
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

  const amount = Number(parsed.data.amount);
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const acctRes = await client.query(
      `SELECT id, name, current_balance FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true FOR UPDATE`,
      [companyId, parsed.data.accountId],
    );
    if (acctRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Account not found or inactive" });
      return;
    }
    const acct = acctRes.rows[0];
    // Not blocked on insufficient balance — a real expense still happened
    // even if the account's recorded balance hasn't caught up (a common gap
    // in small-business petty cash tracking). It's allowed to go negative,
    // same as a manual Material Transfer.

    const expenseRes = await client.query(
      `INSERT INTO expenses (company_id, date, category_id, category_name, amount, payment_mode, account_id, paid_to, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        companyId,
        parsed.data.date,
        parsed.data.categoryId,
        cat.name,
        String(amount),
        parsed.data.paymentMode,
        parsed.data.accountId,
        parsed.data.paidTo ?? null,
        parsed.data.notes ?? null,
        session?.userId ?? null,
      ],
    );
    const created = expenseRes.rows[0];

    const receiptNo = await generateSeriesNumber(client, "payment_receipt", companyId);
    await client.query(
      `INSERT INTO account_transactions
        (company_id, account_id, direction, amount, mode, party_name, notes, receipt_no, created_by_id, created_by_name, created_by_role)
       VALUES ($1,$2,'out',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        companyId,
        parsed.data.accountId,
        amount,
        PAYMENT_MODE_TO_TXN_MODE[parsed.data.paymentMode] ?? "other",
        parsed.data.paidTo ?? null,
        `Expense: ${cat.name}`,
        receiptNo,
        session?.userId ?? null,
        session?.name ?? session?.username ?? null,
        session?.role ?? null,
      ],
    );
    await client.query(
      `UPDATE accounts SET current_balance = current_balance - $1 WHERE company_id = $2 AND id = $3`,
      [amount, companyId, parsed.data.accountId],
    );

    await client.query("COMMIT");
    res.status(201).json(formatExpense(created));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to record expense");
    res.status(500).json({ error: "Failed to record expense" });
  } finally {
    client.release();
  }
});

// DELETE /expenses/:id — also reverses the linked Cash Book entry (if any)
// so deleting an expense doesn't leave a stale ledger entry / wrong balance.
router.delete("/expenses/:id", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const params = DeleteExpenseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const expRes = await client.query(
      `SELECT * FROM expenses WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [companyId, params.data.id],
    );
    const expense = expRes.rows[0];
    if (!expense) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Expense not found" });
      return;
    }

    if (expense.account_id) {
      // Match the linked ledger entry precisely (same account, "out",
      // matching amount, tagged with this expense's category) rather than
      // deleting anything: a stray failed lookup must never delete an
      // unrelated Cash Book row.
      const txnRes = await client.query(
        `SELECT id FROM account_transactions
         WHERE company_id = $1 AND account_id = $2 AND direction = 'out' AND amount = $3 AND notes = $4
         ORDER BY created_at DESC LIMIT 1`,
        [companyId, expense.account_id, expense.amount, `Expense: ${expense.category_name}`],
      );
      const txn = txnRes.rows[0];
      if (txn) {
        await client.query(`DELETE FROM account_transactions WHERE id = $1 AND company_id = $2`, [txn.id, companyId]);
        await client.query(
          `UPDATE accounts SET current_balance = current_balance + $1 WHERE company_id = $2 AND id = $3`,
          [Number(expense.amount), companyId, expense.account_id],
        );
      }
    }

    await client.query(`DELETE FROM expenses WHERE company_id = $1 AND id = $2`, [companyId, params.data.id]);
    await client.query("COMMIT");
    res.sendStatus(204);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to delete expense");
    res.status(500).json({ error: "Failed to delete expense" });
  } finally {
    client.release();
  }
});

export default router;
