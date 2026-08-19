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

// Shared by the receipt-lookup endpoint for both sources (payments and
// account_transactions can each mint a receipt): the invoice-wise breakdown
// this payment was FIFO-allocated against, persisted at the time it was
// applied — never recomputed against current invoice balances, so a reprint
// stays accurate even after later payments have moved those invoices on —
// plus the customer's outstanding balance immediately before/after, derived
// from the one ledger_entries row every payment already writes (its stored
// `balance` is the "after" figure; "before" is just balance + this credit).
async function loadAllocationsAndBalance(
  pool: { query: (text: string, params?: any[]) => Promise<any> },
  companyId: number,
  receiptNo: string,
  entityId: number | null,
) {
  const allocRes = await pool.query(
    `SELECT invoice_id, invoice_no, allocated_amount, invoice_amount_at_allocation,
            previous_paid_at_allocation, balance_after_allocation
     FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2 ORDER BY id ASC`,
    [companyId, receiptNo],
  );
  const allocations = allocRes.rows.map((a: any) => ({
    invoiceId: a.invoice_id,
    invoiceNo: a.invoice_no,
    invoiceAmount: Number(a.invoice_amount_at_allocation),
    previousPaid: Number(a.previous_paid_at_allocation),
    allocatedAmount: Number(a.allocated_amount),
    balanceAfter: Number(a.balance_after_allocation),
    status: Number(a.balance_after_allocation) <= 0.001 ? "paid" : "partially_paid",
  }));

  let customerBalanceBefore: number | null = null;
  let customerBalanceAfter: number | null = null;
  if (entityId != null) {
    const ledgerRes = await pool.query(
      `SELECT credit, balance FROM ledger_entries
       WHERE company_id = $1 AND entity_id = $2 AND reference_no = $3 AND type = 'payment'
       ORDER BY id DESC LIMIT 1`,
      [companyId, entityId, receiptNo],
    );
    if (ledgerRes.rows[0]) {
      customerBalanceAfter = Number(ledgerRes.rows[0].balance);
      customerBalanceBefore = customerBalanceAfter + Number(ledgerRes.rows[0].credit);
    }
  }

  return { allocations, customerBalanceBefore, customerBalanceAfter };
}

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
    `SELECT p.receipt_id, p.created_at, p.customer_id, p.customer_name, p.mode, p.amount, p.status, i.invoice_no
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
     WHERE p.receipt_id = $1 AND p.company_id = $2`,
    [receiptNo, companyId],
  );
  if (paymentRes.rows[0]) {
    const r = paymentRes.rows[0];
    const { allocations, customerBalanceBefore, customerBalanceAfter } =
      await loadAllocationsAndBalance(pool, companyId, receiptNo, r.customer_id ?? null);
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
      allocations,
      customerBalanceBefore,
      customerBalanceAfter,
    });
    return;
  }

  const txnRes = await pool.query(
    `SELECT receipt_no, created_at, party_name, party_entity_id, mode, amount, direction
     FROM account_transactions WHERE receipt_no = $1 AND company_id = $2`,
    [receiptNo, companyId],
  );
  if (txnRes.rows[0]) {
    const r = txnRes.rows[0];
    const { allocations, customerBalanceBefore, customerBalanceAfter } =
      await loadAllocationsAndBalance(pool, companyId, receiptNo, r.party_entity_id ?? null);
    res.json({
      receiptNo: r.receipt_no,
      date: r.created_at?.toISOString?.() ?? r.created_at,
      partyName: r.party_name ?? null,
      mode: r.mode,
      amount: Number(r.amount),
      direction: r.direction,
      status: "completed",
      invoiceNo: allocations[0]?.invoiceNo ?? null,
      source: "cashbook",
      allocations,
      customerBalanceBefore,
      customerBalanceAfter,
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
        // Mirrors the balance update above into Cash Book's own transaction
        // log — without this, the account's total is right but the payment
        // never shows up in Cash Book's Recent Entries list. Shares the same
        // receipt number as the payments row (see the comment on
        // GET /payment-receipts/:receiptNo for why that's safe).
        await client.query(
          `INSERT INTO account_transactions
            (company_id, account_id, direction, amount, mode, party_name, party_entity_id, notes, receipt_no, created_by_id, created_by_name, created_by_role)
           VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            companyId,
            parsed.data.accountId,
            parsed.data.amount,
            parsed.data.mode,
            customer.name,
            customerId,
            "Payment received",
            receiptId,
            session.userId,
            session.name ?? session.username ?? null,
            session.role ?? null,
          ],
        );
      }

      // If a specific invoice was pinned, make sure it's a real, still-open
      // bill for THIS customer — an already-fully-paid pinned invoice is not
      // an error here, it's simply skipped by the FIFO allocator below,
      // which spills the amount to the customer's next oldest outstanding
      // invoice instead.
      if (parsed.data.invoiceId) {
        const invCheck = await client.query(
          `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND customer_id = $3 AND status != 'cancelled'`,
          [parsed.data.invoiceId, companyId, customerId]
        );
        if (invCheck.rowCount === 0) {
          throw new Error("Invoice not found, cancelled, or does not belong to this customer");
        }
      }

      const { allocations } = await applyEntityPayment(client, {
        companyId,
        entityId: customerId,
        amount: parsed.data.amount,
        mode: parsed.data.mode,
        receiptNo: receiptId,
        referenceId: payment.id,
        isCustomerReceipt: true,
        startInvoiceId: parsed.data.invoiceId ?? null,
      });

      await client.query("COMMIT");
      res.status(201).json({ ...formatPayment(payment), allocations });
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
      // Same as the direct-admin POST /payments path — mirror into Cash
      // Book's transaction log, sharing the payment's own receipt number.
      await client.query(
        `INSERT INTO account_transactions
          (company_id, account_id, direction, amount, mode, party_name, party_entity_id, notes, receipt_no, created_by_id, created_by_name, created_by_role)
         VALUES ($1,$2,'in',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          companyId,
          body.accountId,
          payment.amount,
          payment.mode,
          payment.customerName,
          payment.customerId,
          "Payment received (approved)",
          payment.receiptId,
          session?.userId ?? null,
          session?.name ?? session?.username ?? null,
          session?.role ?? null,
        ],
      );
    }

    const { allocations } = await applyEntityPayment(client, {
      companyId,
      entityId: payment.customerId,
      amount: Number(payment.amount),
      mode: payment.mode,
      receiptNo: payment.receiptId,
      referenceId: payment.id,
      isCustomerReceipt: true,
      startInvoiceId: payment.invoiceId ?? null,
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
    res.json({ ...formatPayment(updated), allocations });
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
