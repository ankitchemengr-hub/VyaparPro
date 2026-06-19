import { Router, type IRouter } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { accountsTable, paymentsTable } from "@workspace/db";
import {
  CreateAccountBody,
  UpdateAccountBody,
  UpdateAccountParams,
  DeleteAccountParams,
  CollectCashFromSalesmanBody,
  CreateAccountTransactionBody,
  ListAccountTransactionsQueryParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// All accounts/cashbook routes require admin or accountant role (financial data)
const FINANCIAL_ROLES = new Set(["admin", "accountant"]);
const WRITE_ROLES = new Set(["admin"]);

function requireFinancialRead(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !FINANCIAL_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function requireFinancialWrite(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !WRITE_ROLES.has(role)) {
    res.status(403).json({ error: "Forbidden — admin only" });
    return false;
  }
  return true;
}

function formatAccount(a: any) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    identifier: a.identifier ?? null,
    openingBalance: Number(a.openingBalance ?? a.opening_balance ?? 0),
    currentBalance: Number(a.currentBalance ?? a.current_balance ?? 0),
    isActive: a.isActive ?? a.is_active ?? true,
    notes: a.notes ?? null,
    createdAt: (a.createdAt ?? a.created_at)?.toISOString
      ? (a.createdAt ?? a.created_at).toISOString()
      : (a.createdAt ?? a.created_at),
  };
}

// GET /accounts
router.get("/accounts", async (req, res): Promise<void> => {
  if (!requireFinancialRead(req, res)) return;
  const companyId = getCompanyId(req);
  const rows = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.companyId, companyId))
    .orderBy(sql`${accountsTable.isActive} DESC, ${accountsTable.type}, ${accountsTable.name}`);
  res.json(rows.map(formatAccount));
});

// POST /accounts
router.post("/accounts", async (req, res): Promise<void> => {
  if (!requireFinancialWrite(req, res)) return;
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const opening = parsed.data.openingBalance ?? 0;
  const [created] = await db
    .insert(accountsTable)
    .values({
      companyId,
      name: parsed.data.name,
      type: parsed.data.type,
      identifier: parsed.data.identifier ?? null,
      openingBalance: String(opening),
      currentBalance: String(opening),
      isActive: parsed.data.isActive ?? true,
      notes: parsed.data.notes ?? null,
    })
    .returning();
  res.status(201).json(formatAccount(created));
});

// PUT /accounts/:id
router.put("/accounts/:id", async (req, res): Promise<void> => {
  if (!requireFinancialWrite(req, res)) return;
  const params = UpdateAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [existing] = await db.select().from(accountsTable).where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.id, params.data.id)));
  if (!existing) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  // If opening balance changed, shift current balance by the delta
  const newOpening = parsed.data.openingBalance ?? Number(existing.openingBalance);
  const delta = newOpening - Number(existing.openingBalance);
  const newCurrent = Number(existing.currentBalance) + delta;

  const [updated] = await db
    .update(accountsTable)
    .set({
      name: parsed.data.name,
      type: parsed.data.type,
      identifier: parsed.data.identifier ?? null,
      openingBalance: String(newOpening),
      currentBalance: String(newCurrent),
      isActive: parsed.data.isActive ?? existing.isActive,
      notes: parsed.data.notes ?? null,
    })
    .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.id, params.data.id)))
    .returning();
  res.json(formatAccount(updated));
});

// DELETE /accounts/:id  (soft-delete: deactivate)
router.delete("/accounts/:id", async (req, res): Promise<void> => {
  if (!requireFinancialWrite(req, res)) return;
  const params = DeleteAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  await db
    .update(accountsTable)
    .set({ isActive: false })
    .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.id, params.data.id)));
  res.sendStatus(204);
});

// GET /cashbook — per-salesman pending cash + account balances
router.get("/cashbook", async (req, res): Promise<void> => {
  if (!requireFinancialRead(req, res)) return;
  const companyId = getCompanyId(req);
  // Approved cash payments not yet collected (accountId IS NULL) grouped by salesman
  const pendingRows = await db
    .select({
      salesmanId: paymentsTable.salesmanId,
      salesmanName: paymentsTable.salesmanName,
      pendingCash: sql<string>`COALESCE(SUM(${paymentsTable.amount}), 0)`,
      paymentCount: sql<string>`COUNT(*)::int`,
    })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.companyId, companyId),
        eq(paymentsTable.mode, "cash"),
        eq(paymentsTable.status, "approved"),
        isNull(paymentsTable.accountId),
        sql`${paymentsTable.salesmanId} IS NOT NULL`,
      ),
    )
    .groupBy(paymentsTable.salesmanId, paymentsTable.salesmanName);

  const salesmen = pendingRows.map((r) => ({
    salesmanId: r.salesmanId ?? 0,
    salesmanName: r.salesmanName ?? "Unknown",
    pendingCash: Number(r.pendingCash),
    paymentCount: Number(r.paymentCount),
  }));

  const totalPendingCash = salesmen.reduce((s, x) => s + x.pendingCash, 0);

  const accounts = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.companyId, companyId))
    .orderBy(sql`${accountsTable.isActive} DESC, ${accountsTable.type}, ${accountsTable.name}`);

  res.json({
    salesmen,
    totalPendingCash,
    accounts: accounts.map(formatAccount),
  });
});

// POST /cashbook/collect
router.post("/cashbook/collect", async (req, res): Promise<void> => {
  if (!requireFinancialWrite(req, res)) return;
  const parsed = CollectCashFromSalesmanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);

  const { salesmanId, accountId, amount, notes } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Verify account exists and is active
    const acctRes = await client.query(
      `SELECT id, current_balance FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true FOR UPDATE`,
      [companyId, accountId],
    );
    if (acctRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Account not found or inactive" });
      return;
    }

    // Mark uncollected approved cash payments for this salesman as collected, up to `amount`.
    // Strategy: mark oldest payments first until cumulative sum reaches `amount`.
    const pendingRes = await client.query(
      `SELECT id, amount FROM payments
       WHERE company_id = $1 AND salesman_id = $2 AND mode = 'cash' AND status = 'approved' AND account_id IS NULL
       ORDER BY created_at ASC`,
      [companyId, salesmanId],
    );

    let collected = 0;
    const idsToMark: number[] = [];
    for (const row of pendingRes.rows) {
      const next = collected + Number(row.amount);
      if (next > amount + 0.001) break;
      collected = next;
      idsToMark.push(row.id);
      if (Math.abs(collected - amount) < 0.001) break;
    }

    if (idsToMark.length === 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "No matching pending cash payments found for that amount" });
      return;
    }

    await client.query(
      `UPDATE payments
       SET account_id = $1, collected_at = NOW(), collected_by_id = $2
       WHERE company_id = $3 AND id = ANY($4::int[])`,
      [accountId, session.userId, companyId, idsToMark],
    );

    const updAcct = await client.query(
      `UPDATE accounts SET current_balance = current_balance + $1 WHERE company_id = $2 AND id = $3 RETURNING *`,
      [collected, companyId, accountId],
    );

    await client.query("COMMIT");
    res.json({
      collectedCount: idsToMark.length,
      totalAmount: collected,
      account: formatAccount(updAcct.rows[0]),
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to collect cash");
    res.status(500).json({ error: "Failed to collect cash" });
  } finally {
    client.release();
  }
});

// GET /account-transactions — list cash in/out entries
router.get("/account-transactions", async (req, res): Promise<void> => {
  if (!requireFinancialRead(req, res)) return;
  const parsed = ListAccountTransactionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const { accountId, direction, from, to } = parsed.data;

  const where: any[] = [sql`t.company_id = ${companyId}`];
  if (accountId) where.push(sql`t.account_id = ${accountId}`);
  if (direction) where.push(sql`t.direction = ${direction}`);
  if (from) where.push(sql`t.created_at >= ${from}::timestamptz`);
  if (to) where.push(sql`t.created_at <= ${to}::timestamptz`);
  const whereSql = sql.join([sql`WHERE`, sql.join(where, sql` AND `)], sql` `);

  const rows = await db.execute(sql`
    SELECT t.id, t.receipt_no, t.account_id, t.direction, t.amount, t.mode,
           t.party_name, t.party_mobile, t.party_entity_id, t.notes,
           t.created_by_id, t.created_by_name, t.created_by_role,
           t.created_at, a.name as account_name
    FROM account_transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    ${whereSql}
    ORDER BY t.created_at DESC
    LIMIT 500
  `);
  const data = (rows as any).rows ?? rows;
  res.json(
    data.map((r: any) => ({
      id: r.id,
      receiptNo: r.receipt_no ?? null,
      accountId: r.account_id,
      accountName: r.account_name ?? null,
      direction: r.direction,
      amount: Number(r.amount),
      mode: r.mode,
      partyName: r.party_name ?? null,
      partyMobile: r.party_mobile ?? null,
      partyEntityId: r.party_entity_id ?? null,
      notes: r.notes ?? null,
      createdById: r.created_by_id ?? null,
      createdByName: r.created_by_name ?? null,
      createdByRole: r.created_by_role ?? null,
      balanceAfter: null,
      createdAt: r.created_at?.toISOString ? r.created_at.toISOString() : r.created_at,
    })),
  );
});

// POST /account-transactions — record Payment In / Out
router.post("/account-transactions", async (req, res): Promise<void> => {
  if (!requireFinancialWrite(req, res)) return;
  const parsed = CreateAccountTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);
  const { accountId, direction, amount, mode, partyName, partyMobile, partyEntityId, notes } = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const acctRes = await client.query(
      `SELECT id, name, current_balance FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true FOR UPDATE`,
      [companyId, accountId],
    );
    if (acctRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Account not found or inactive" });
      return;
    }
    const acct = acctRes.rows[0];
    const current = Number(acct.current_balance);
    if (direction === "out" && current < amount - 0.001) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: `Insufficient balance in ${acct.name} (₹${current.toFixed(2)})` });
      return;
    }

    const ins = await client.query(
      `INSERT INTO account_transactions
        (company_id, account_id, direction, amount, mode, party_name, party_mobile, party_entity_id, notes, created_by_id, created_by_name, created_by_role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        companyId,
        accountId,
        direction,
        amount,
        mode,
        partyName ?? null,
        partyMobile ?? null,
        partyEntityId ?? null,
        notes ?? null,
        session?.userId ?? null,
        session?.name ?? session?.username ?? null,
        session?.role ?? null,
      ],
    );
    const txn = ins.rows[0];

    // Build receipt number: RCP-YYYYMM-<id padded>
    const d = new Date(txn.created_at);
    const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
    const receiptNo = `RCP-${yyyymm}-${String(txn.id).padStart(5, "0")}`;
    await client.query(`UPDATE account_transactions SET receipt_no = $1 WHERE company_id = $2 AND id = $3`, [receiptNo, companyId, txn.id]);

    const delta = direction === "in" ? amount : -amount;
    const updAcct = await client.query(
      `UPDATE accounts SET current_balance = current_balance + $1 WHERE company_id = $2 AND id = $3 RETURNING current_balance`,
      [delta, companyId, accountId],
    );

    await client.query("COMMIT");

    res.status(201).json({
      id: txn.id,
      receiptNo,
      accountId: txn.account_id,
      accountName: acct.name,
      direction: txn.direction,
      amount: Number(txn.amount),
      mode: txn.mode,
      partyName: txn.party_name ?? null,
      partyMobile: txn.party_mobile ?? null,
      partyEntityId: txn.party_entity_id ?? null,
      notes: txn.notes ?? null,
      createdById: txn.created_by_id ?? null,
      createdByName: txn.created_by_name ?? null,
      createdByRole: txn.created_by_role ?? null,
      balanceAfter: Number(updAcct.rows[0].current_balance),
      createdAt: txn.created_at?.toISOString ? txn.created_at.toISOString() : txn.created_at,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to record account transaction");
    res.status(500).json({ error: "Failed to record transaction" });
  } finally {
    client.release();
  }
});

// POST /accounts/transfer — move money from one account to another atomically
router.post("/accounts/transfer", async (req, res): Promise<void> => {
  if (!requireFinancialWrite(req, res)) return;
  const { fromAccountId, toAccountId, amount, notes } = req.body ?? {};
  if (!Number.isInteger(fromAccountId) || fromAccountId <= 0 ||
      !Number.isInteger(toAccountId)   || toAccountId <= 0 ||
      typeof amount !== "number" || amount < 0.01) {
    res.status(400).json({ error: "Invalid transfer parameters" });
    return;
  }
  if (fromAccountId === toAccountId) {
    res.status(400).json({ error: "Source and destination accounts must be different" });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Lock both accounts in consistent order to avoid deadlock
    const [minId, maxId] = fromAccountId < toAccountId
      ? [fromAccountId, toAccountId]
      : [toAccountId, fromAccountId];

    const acctRes = await client.query(
      `SELECT id, name, type, current_balance FROM accounts
       WHERE company_id = $1 AND id IN ($2, $3) AND is_active = true
       ORDER BY id FOR UPDATE`,
      [companyId, minId, maxId],
    );
    if (acctRes.rows.length !== 2) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "One or both accounts not found or inactive" });
      return;
    }
    const fromAcct = acctRes.rows.find((r: any) => r.id === fromAccountId);
    const toAcct   = acctRes.rows.find((r: any) => r.id === toAccountId);
    if (!fromAcct || !toAcct) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Account lookup error" });
      return;
    }
    if (Number(fromAcct.current_balance) < amount - 0.001) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: `Insufficient balance in "${fromAcct.name}" (₹${Number(fromAcct.current_balance).toFixed(2)})` });
      return;
    }

    const memo = notes?.trim() || `Transfer to ${toAcct.name}`;
    const memoTo = `Transfer from ${fromAcct.name}`;
    const byId   = session?.userId ?? null;
    const byName = session?.name ?? session?.username ?? null;
    const byRole = session?.role ?? null;

    // Debit from source
    const outRes = await client.query(
      `INSERT INTO account_transactions
        (company_id, account_id, direction, amount, mode, party_name, notes, created_by_id, created_by_name, created_by_role)
       VALUES ($1,$2,'out',$3,'bank_transfer',$4,$5,$6,$7,$8) RETURNING id, created_at`,
      [companyId, fromAccountId, amount, toAcct.name, memo, byId, byName, byRole],
    );
    const outTxn = outRes.rows[0];
    const outReceiptNo = `TRF-OUT-${outTxn.id}`;
    await client.query(`UPDATE account_transactions SET receipt_no=$1 WHERE id=$2`, [outReceiptNo, outTxn.id]);

    // Credit to destination
    const inRes = await client.query(
      `INSERT INTO account_transactions
        (company_id, account_id, direction, amount, mode, party_name, notes, created_by_id, created_by_name, created_by_role)
       VALUES ($1,$2,'in',$3,'bank_transfer',$4,$5,$6,$7,$8) RETURNING id, created_at`,
      [companyId, toAccountId, amount, fromAcct.name, memoTo, byId, byName, byRole],
    );
    const inTxn = inRes.rows[0];
    const inReceiptNo = `TRF-IN-${inTxn.id}`;
    await client.query(`UPDATE account_transactions SET receipt_no=$1 WHERE id=$2`, [inReceiptNo, inTxn.id]);

    // Update balances
    const updFrom = await client.query(
      `UPDATE accounts SET current_balance = current_balance - $1 WHERE company_id=$2 AND id=$3 RETURNING current_balance`,
      [amount, companyId, fromAccountId],
    );
    const updTo = await client.query(
      `UPDATE accounts SET current_balance = current_balance + $1 WHERE company_id=$2 AND id=$3 RETURNING current_balance`,
      [amount, companyId, toAccountId],
    );

    await client.query("COMMIT");
    res.status(201).json({
      amount,
      fromAccountId,
      fromAccountName: fromAcct.name,
      fromBalanceAfter: Number(updFrom.rows[0].current_balance),
      toAccountId,
      toAccountName: toAcct.name,
      toBalanceAfter: Number(updTo.rows[0].current_balance),
      outReceiptNo,
      inReceiptNo,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to transfer between accounts");
    res.status(500).json({ error: "Transfer failed" });
  } finally {
    client.release();
  }
});

export default router;
