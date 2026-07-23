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
  GetPaymentReceiptParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";
import { generateSeriesNumber } from "../lib/number-series";
import { applyEntityPayment } from "../lib/entity-payment";

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

// GET /payment-receipts/:receiptNo — resolves a receipt number against
// whichever table actually minted it: the payments table (customer/salesman
// payment) or account_transactions (Cash Book). Both draw from the same
// shared payment_receipt number series, so a receipt number is unique across
// the two regardless of which path created it — join key is receiptNo, not
// the row id, since payments.id and account_transactions.id are separate
// auto-increment sequences that can collide.
router.get("/payment-receipts/:receiptNo", async (req, res): Promise<void> => {
  const params = GetPaymentReceiptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const { receiptNo } = params.data;

  const paymentRes = await pool.query(
    `SELECT p.receipt_id, p.created_at, p.customer_name, p.mode, p.amount, p.status, i.invoice_no
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
     WHERE p.receipt_id = $1 AND p.company_id = $2`,
    [receiptNo, companyId],
  );
  if (paymentRes.rows[0]) {
    const r = paymentRes.rows[0];
    res.json({
      receiptNo: r.receipt_id,
      date: r.created_at?.toISOString?.() ?? r.created_at,
      partyName: r.customer_name ?? null,
      mode: r.mode,
      amount: Number(r.amount),
      direction: "in",
      status: r.status,
      invoiceNo: r.invoice_no ?? null,
      source: "payment",
    });
    return;
  }

  const txnRes = await pool.query(
    `SELECT receipt_no, created_at, party_name, mode, amount, direction
     FROM account_transactions WHERE receipt_no = $1 AND company_id = $2`,
    [receiptNo, companyId],
  );
  if (txnRes.rows[0]) {
    const r = txnRes.rows[0];
    res.json({
      receiptNo: r.receipt_no,
      date: r.created_at?.toISOString?.() ?? r.created_at,
      partyName: r.party_name ?? null,
      mode: r.mode,
      amount: Number(r.amount),
      direction: r.direction,
      status: "completed",
      invoiceNo: null,
      source: "cashbook",
    });
    return;
  }

  res.status(404).json({ error: "Receipt not found" });
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

  // Resolve customer
  const WALKIN_LOCK_KEY = 7421953;
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

  if (isAdmin) {
    // Direct commit with SERIALIZABLE transaction — receipt ID generated inside for safety
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

      const receiptId = await generateSeriesNumber(client, "payment_receipt", companyId);

      const [payment] = await db.insert(paymentsTable).values({
        companyId,
        receiptId,
        customerId,
        customerName: customer.name,
        invoiceId: parsed.data.invoiceId ?? null,
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

      // If payment is tied to a specific invoice, validate it before applying —
      // the actual balance_due/amount_paid reduction happens inside
      // applyEntityPayment below, alongside the entity/ledger update.
      if (parsed.data.invoiceId) {
        const invCheck = await client.query(
          `SELECT id, balance_due FROM invoices WHERE id = $1 AND company_id = $2 AND status != 'cancelled'`,
          [parsed.data.invoiceId, companyId]
        );
        if (invCheck.rowCount === 0) {
          throw new Error("Invoice not found or cancelled");
        }
        if (Number(invCheck.rows[0].balance_due) <= 0) {
          throw new Error("Invoice is already fully paid");
        }
      }

      await applyEntityPayment(client, {
        companyId,
        entityId: customerId,
        amount: parsed.data.amount,
        mode: parsed.data.mode,
        receiptNo: receiptId,
        referenceId: payment.id,
        invoiceId: parsed.data.invoiceId ?? null,
      });

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
    // Salesman — pending escrow. Generate receipt ID in its own short transaction.
    let receiptId: string;
    const seqClient = await pool.connect();
    try {
      await seqClient.query("BEGIN");
      receiptId = await generateSeriesNumber(seqClient, "payment_receipt", companyId);
      await seqClient.query("COMMIT");
    } catch {
      await seqClient.query("ROLLBACK").catch(() => {});
      receiptId = `REC-${Date.now()}`;
    } finally {
      seqClient.release();
    }

    const [payment] = await db.insert(paymentsTable).values({
      companyId,
      receiptId,
      customerId,
      customerName: customer.name,
      invoiceId: parsed.data.invoiceId ?? null,
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
    res.status(400).json({ error: `Payment is already ${payment.status}` });
    return;
  }

  const body = (req.body ?? {}) as { accountId?: number };

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    if (body.accountId) {
      const upd = await client.query(
        `UPDATE accounts SET current_balance = current_balance + $1
         WHERE id = $2 AND is_active = true AND company_id = $3 RETURNING id`,
        [payment.amount, body.accountId, companyId]
      );
      if (upd.rowCount === 0) throw new Error(`Account ${body.accountId} not found or inactive`);
    }

    await applyEntityPayment(client, {
      companyId,
      entityId: payment.customerId,
      amount: Number(payment.amount),
      mode: payment.mode,
      receiptNo: payment.receiptId,
      referenceId: payment.id,
      invoiceId: payment.invoiceId ?? null,
    });

    const [updated] = await db
      .update(paymentsTable)
      .set({
        status: "approved",
        approvedById: session?.userId ?? null,
        approvedAt: new Date(),
        accountId: body.accountId ?? null,
        collectedAt: body.accountId ? new Date() : null,
        collectedById: body.accountId ? session?.userId : null,
      })
      .where(and(eq(paymentsTable.companyId, companyId), eq(paymentsTable.id, params.data.id)))
      .returning();

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
  const [updated] = await db
    .update(paymentsTable)
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
    invoiceId: p.invoiceId ?? null,
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
