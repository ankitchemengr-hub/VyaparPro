import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  paymentsTable,
  entitiesTable,
  ledgerEntriesTable,
} from "@workspace/db";
import {
  ListPaymentsQueryParams,
  LogPaymentBody,
  ApprovePaymentParams,
  RejectPaymentParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// GET /payments
router.get("/payments", async (req, res): Promise<void> => {
  const params = ListPaymentsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const conditions: any[] = [eq(paymentsTable.companyId, companyId)];
  if (params.data.customerId) conditions.push(eq(paymentsTable.customerId, params.data.customerId));
  if (params.data.status) conditions.push(eq(paymentsTable.status, params.data.status));

  const payments = await db
    .select()
    .from(paymentsTable)
    .where(and(...conditions))
    .orderBy(sql`${paymentsTable.createdAt} DESC`);

  res.json(payments.map(formatPayment));
});

// POST /payments
router.post("/payments", async (req, res): Promise<void> => {
  const parsed = LogPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const isAdmin = session?.role === "admin";
  const status = isAdmin ? "approved" : "pending";

  // Resolve customer — explicit id, or find-or-create the shared "Walk-in Customer" entity for cash sales.
  // A session-level advisory lock serializes concurrent walk-in inserts so we never end up with duplicates
  // (the entities table has no UNIQUE constraint on name/type).
  const WALKIN_LOCK_KEY = 7421953; // arbitrary constant — any int32 unique to this purpose works
  let customer;
  let customerId: number;
  if (parsed.data.customerId) {
    [customer] = await db
      .select()
      .from(entitiesTable)
      .where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, parsed.data.customerId)));
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    customerId = customer.id;
  } else {
    const lockClient = await pool.connect();
    try {
      await lockClient.query("SELECT pg_advisory_lock($1, $2)", [WALKIN_LOCK_KEY, companyId]);
      [customer] = await db
        .select()
        .from(entitiesTable)
        .where(and(
          eq(entitiesTable.companyId, companyId),
          eq(entitiesTable.type, "customer"),
          eq(entitiesTable.name, "Walk-in Customer"),
        ));
      if (!customer) {
        [customer] = await db
          .insert(entitiesTable)
          .values({ companyId, type: "customer", name: "Walk-in Customer", mobile: "0000000000" })
          .returning();
      }
      customerId = customer.id;
    } finally {
      try { await lockClient.query("SELECT pg_advisory_unlock($1, $2)", [WALKIN_LOCK_KEY, companyId]); } catch {}
      lockClient.release();
    }
  }

  const receiptId = `RCP-${Date.now()}`;

  if (isAdmin) {
    // Direct commit with SERIALIZABLE transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

      const [payment] = await db.insert(paymentsTable).values({
        companyId,
        receiptId,
        customerId,
        customerName: customer.name,
        salesmanId: null,
        salesmanName: null,
        amount: String(parsed.data.amount),
        mode: parsed.data.mode,
        status: "approved",
        notes: parsed.data.notes ?? null,
        approvedById: session.userId,
        approvedAt: new Date(),
        accountId: parsed.data.accountId ?? null,
        collectedAt: parsed.data.accountId ? new Date() : null,
        collectedById: parsed.data.accountId ? session.userId : null,
      }).returning();

      // If deposited directly to an account, verify it exists & is active, then bump its balance
      if (parsed.data.accountId) {
        const upd = await client.query(
          `UPDATE accounts SET current_balance = current_balance + $1
           WHERE id = $2 AND is_active = true AND company_id = $3
           RETURNING id`,
          [parsed.data.amount, parsed.data.accountId, companyId]
        );
        if (upd.rowCount === 0) {
          throw new Error(`Account ${parsed.data.accountId} not found or inactive`);
        }
      }

      // Deduct from outstanding
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE id = $2 AND company_id = $3`,
        [parsed.data.amount, customerId, companyId]
      );

      const balResult = await client.query(
        `SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`,
        [customerId, companyId]
      );
      const newBal = balResult.rows[0].outstanding_balance;

      await client.query(
        `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
         VALUES ($1, $2, NOW(), $3, 0, $4, $5, 'payment', $6, $7)`,
        [companyId, customerId, `Payment received (${parsed.data.mode})`, parsed.data.amount, newBal, payment.id, receiptId]
      );

      await client.query("COMMIT");
      res.status(201).json(formatPayment(payment));
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err }, "Failed to process payment");
      res.status(500).json({ error: "Failed to process payment" });
    } finally {
      client.release();
    }
  } else {
    // Salesman entry - goes to escrow (pending)
    const [payment] = await db.insert(paymentsTable).values({
      companyId,
      receiptId,
      customerId,
      customerName: customer.name,
      salesmanId: session?.userId ?? null,
      salesmanName: session?.name ?? null,
      amount: String(parsed.data.amount),
      mode: parsed.data.mode,
      status: "pending",
      notes: parsed.data.notes ?? null,
    }).returning();

    res.status(201).json(formatPayment(payment));
  }
});

// POST /payments/:id/approve
router.post("/payments/:id/approve", async (req, res): Promise<void> => {
  const params = ApprovePaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(and(eq(paymentsTable.companyId, companyId), eq(paymentsTable.id, params.data.id)));

  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  if (payment.status !== "pending") {
    res.status(400).json({ error: "Payment is not pending" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const [updated] = await db.update(paymentsTable)
      .set({ status: "approved", approvedById: session?.userId, approvedAt: new Date() })
      .where(and(eq(paymentsTable.companyId, companyId), eq(paymentsTable.id, params.data.id)))
      .returning();

    // Deduct from outstanding
    await client.query(
      `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE id = $2 AND company_id = $3`,
      [payment.amount, payment.customerId, companyId]
    );

    const balResult = await client.query(
      `SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`,
      [payment.customerId, companyId]
    );
    const newBal = balResult.rows[0].outstanding_balance;

    await client.query(
      `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
       VALUES ($1, $2, NOW(), $3, 0, $4, $5, 'payment', $6, $7)`,
      [companyId, payment.customerId, `Payment received - Approved (${payment.mode})`, payment.amount, newBal, payment.id, payment.receiptId]
    );

    await client.query("COMMIT");
    res.json(formatPayment(updated));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to approve payment");
    res.status(500).json({ error: "Failed to approve payment" });
  } finally {
    client.release();
  }
});

// POST /payments/:id/reject
router.post("/payments/:id/reject", async (req, res): Promise<void> => {
  const params = RejectPaymentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [updated] = await db.update(paymentsTable)
    .set({ status: "rejected" })
    .where(and(eq(paymentsTable.companyId, companyId), eq(paymentsTable.id, params.data.id)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  res.json(formatPayment(updated));
});

function formatPayment(p: any) {
  return {
    id: p.id,
    receiptId: p.receiptId,
    customerId: p.customerId,
    customerName: p.customerName ?? null,
    salesmanId: p.salesmanId ?? null,
    salesmanName: p.salesmanName ?? null,
    amount: Number(p.amount),
    mode: p.mode,
    status: p.status,
    notes: p.notes ?? null,
    createdAt: p.createdAt?.toISOString(),
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    accountId: p.accountId ?? null,
    accountName: p.accountName ?? null,
    collectedAt: p.collectedAt ? p.collectedAt.toISOString() : null,
  };
}

export default router;
