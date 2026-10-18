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
import { isGstAccountant } from "../lib/gst-access";
import { generateSeriesNumber } from "../lib/number-series";
import { applyEntityPayment, settleExcessInvoiceDues, NO_PAY_INVOICE_TYPES } from "../lib/entity-payment";

// Thrown for a bad request caught mid-transaction (needs the ROLLBACK the
// surrounding try/catch already does) — kept distinct from a genuine
// server/DB failure so the response is a real 400 with the actual reason
// instead of a generic 500 that just says "failed", which is not
// self-diagnosing when it happens again for a different edge case later.
class PaymentValidationError extends Error {}

// Approving/rejecting a pending payment moves money and the customer ledger —
// restrict it to the admin (or a platform super_admin acting inside a company).
// The SPA already hides these buttons from other roles; this closes the API.
function requirePaymentApprover(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (role !== "admin" && role !== "super_admin") {
    res.status(403).json({ error: "Forbidden — admin only" });
    return false;
  }
  return true;
}

// Raw-SQL row → the same camelCase shape Drizzle would return, for the two
// spots that write the payments row through the manually-managed `client`
// transaction (see the comment on those call sites for why: `db.insert`/
// `db.update` run on a separate, auto-committing connection from `client`,
// so a later failure in the same request would roll back everything else
// but leave that write permanently committed — an orphaned row that then
// blocks every future receipt number from ever being reused again).
function mapPaymentRow(r: any) {
  return {
    id: r.id,
    companyId: r.company_id,
    receiptId: r.receipt_id,
    customerId: r.customer_id,
    customerName: r.customer_name,
    invoiceId: r.invoice_id,
    salesmanId: r.salesman_id,
    salesmanName: r.salesman_name,
    amount: r.amount,
    mode: r.mode,
    status: r.status,
    notes: r.notes,
    approvedById: r.approved_by_id,
    approvedAt: r.approved_at,
    createdByRole: r.created_by_role,
    accountId: r.account_id,
    collectedAt: r.collected_at,
    collectedById: r.collected_by_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Shared by the receipt-lookup endpoint for both sources (payments and
// account_transactions can each mint a receipt): the invoice-wise breakdown
// this payment was allocated against, persisted at the time it was
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

// GST-accountant view of a receipt: keep only the allocations against GST
// invoices and report just that portion as the amount. The customer's running
// balance (which mixes in non-GST bills) is withheld. Returns null when the
// receipt touches no GST invoice at all, so the caller 404s.
async function gstOnlyReceipt(
  companyId: number,
  receipt: { amount: number; invoiceNo: string | null; allocations: any[]; customerBalanceBefore: number | null; customerBalanceAfter: number | null },
  directInvoiceId: number | null,
) {
  const ids = [...new Set([
    ...receipt.allocations.map((a) => a.invoiceId),
    ...(directInvoiceId != null ? [directInvoiceId] : []),
  ].filter((v): v is number => v != null))];
  const gst = ids.length === 0 ? [] : (await pool.query(
    `SELECT id, invoice_no FROM invoices WHERE company_id = $1 AND id = ANY($2) AND invoice_type = 'gst'`,
    [companyId, ids],
  )).rows;
  const gstIds = new Set(gst.map((r: any) => r.id));
  const allocations = receipt.allocations.filter((a) => gstIds.has(a.invoiceId));
  if (allocations.length > 0) {
    return {
      ...receipt,
      amount: allocations.reduce((sum, a) => sum + a.allocatedAmount, 0),
      invoiceNo: allocations[0].invoiceNo ?? null,
      allocations,
      customerBalanceBefore: null,
      customerBalanceAfter: null,
    };
  }
  // Older payments recorded against a single invoice, before allocations existed.
  if (receipt.allocations.length === 0 && directInvoiceId != null && gstIds.has(directInvoiceId)) {
    return {
      ...receipt,
      invoiceNo: gst.find((r: any) => r.id === directInvoiceId)?.invoice_no ?? null,
      customerBalanceBefore: null,
      customerBalanceAfter: null,
    };
  }
  return null;
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
  const session = (req as any).session;
  if (session?.role === "customer") {
    // Customer portal login: only their own payments, whatever is asked for.
    if (!session.entityId) {
      res.json([]);
      return;
    }
    conditions.push(eq(paymentsTable.customerId, session.entityId));
  } else if (params.data.customerId) conditions.push(eq(paymentsTable.customerId, params.data.customerId));
  if (params.data.status) conditions.push(eq(paymentsTable.status, params.data.status));
  if (isGstAccountant(req)) {
    // Only payments settled purely against GST invoices. A receipt that also
    // covers non-GST bills is left out here (its GST share still shows under
    // each GST invoice's payment-receipts), so no non-GST amount leaks.
    const linkedInvoices = (invoiceTypeCheck: ReturnType<typeof sql>) => sql`EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.company_id = ${paymentsTable.companyId}
        AND (i.id = ${paymentsTable.invoiceId} OR i.id IN (
          SELECT pa.invoice_id FROM payment_allocations pa
          WHERE pa.company_id = ${paymentsTable.companyId} AND pa.receipt_no = ${paymentsTable.receiptId}
        ))
        AND ${invoiceTypeCheck}
    )`;
    conditions.push(linkedInvoices(sql`i.invoice_type = 'gst'`));
    conditions.push(sql`NOT ${linkedInvoices(sql`i.invoice_type <> 'gst'`)}`);
  }

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
    `SELECT p.receipt_id, p.created_at, p.customer_id, p.customer_name, p.mode, p.amount, p.status, p.invoice_id, i.invoice_no
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
     WHERE p.receipt_id = $1 AND p.company_id = $2`,
    [receiptNo, companyId],
  );
  if (paymentRes.rows[0]) {
    const r = paymentRes.rows[0];
    const { allocations, customerBalanceBefore, customerBalanceAfter } =
      await loadAllocationsAndBalance(pool, companyId, receiptNo, r.customer_id ?? null);
    const body = {
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
    };
    if (isGstAccountant(req)) {
      const view = await gstOnlyReceipt(companyId, body, r.invoice_id ?? null);
      if (!view) { res.status(404).json({ error: "Receipt not found" }); return; }
      res.json(view);
      return;
    }
    res.json(body);
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
    const body = {
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
    };
    if (isGstAccountant(req)) {
      const view = await gstOnlyReceipt(companyId, body, null);
      if (!view) { res.status(404).json({ error: "Receipt not found" }); return; }
      res.json(view);
      return;
    }
    res.json(body);
    return;
  }

  // Not a money receipt, but bills were still settled under this number: an
  // advance/credit applied to a bill (ADV-…), a balance sync (SYNC-…), or a
  // sales return credit (the return number). Shown from its allocations.
  const { allocations } = await loadAllocationsAndBalance(pool, companyId, receiptNo, null);
  if (allocations.length > 0) {
    const metaRes = await pool.query(
      `SELECT MIN(pa.created_at) AS created_at, MIN(i.customer_name) AS party_name
       FROM payment_allocations pa
       LEFT JOIN invoices i ON i.id = pa.invoice_id AND i.company_id = pa.company_id
       WHERE pa.company_id = $1 AND pa.receipt_no = $2`,
      [companyId, receiptNo],
    );
    const meta = metaRes.rows[0] ?? {};
    const body = {
      receiptNo,
      date: meta.created_at?.toISOString?.() ?? meta.created_at,
      partyName: meta.party_name ?? null,
      mode: /^(ADV|SYNC)-/.test(receiptNo) ? "adjustment" : "sales_return",
      amount: allocations.reduce((sum: number, a: { allocatedAmount: number }) => sum + a.allocatedAmount, 0),
      direction: "in",
      status: "completed",
      invoiceNo: allocations[0]?.invoiceNo ?? null,
      source: "adjustment",
      allocations,
      customerBalanceBefore: null,
      customerBalanceAfter: null,
    };
    if (isGstAccountant(req)) {
      const view = await gstOnlyReceipt(companyId, body, null);
      if (!view) { res.status(404).json({ error: "Receipt not found" }); return; }
      res.json(view);
      return;
    }
    res.json(body);
    return;
  }

  res.status(404).json({ error: "Receipt not found" });
});

// ── Bill status ↔ party balance sync (admin) ──
// One-off clean-up for bills whose paid status drifted from the party
// balance (advances paid before the bill, receipts from before allocation
// existed, old sales returns). For every customer whose open bills show more
// due than they owe, the gap is settled oldest-bill-first via
// settleExcessInvoiceDues. Preview runs the exact same writes inside a
// transaction and rolls back, so what it shows is what Apply will do.
async function runPaymentSync(companyId: number, apply: boolean, session: any) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const custRes = await client.query(
      `SELECT DISTINCT i.customer_id, e.name
       FROM invoices i
       JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
       WHERE i.company_id = $1 AND i.customer_id IS NOT NULL
         AND i.status != 'cancelled' AND i.balance_due > 0
         AND i.invoice_type NOT IN (${NO_PAY_INVOICE_TYPES.map((t) => `'${t}'`).join(", ")})
       ORDER BY e.name`,
      [companyId],
    );
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const parties: any[] = [];
    for (const c of custRes.rows) {
      const r = await settleExcessInvoiceDues(client, {
        companyId, customerId: c.customer_id, receiptNo: `SYNC-${stamp}-${c.customer_id}`,
      });
      if (r.allocations.length === 0) continue;
      parties.push({
        customerId: c.customer_id,
        name: c.name,
        balance: r.balance,
        openDueBefore: r.openDueBefore,
        settled: r.excess,
        openDueAfter: Math.round((r.openDueBefore - r.excess) * 100) / 100,
        invoices: r.allocations.map((a) => ({
          invoiceId: a.invoiceId,
          invoiceNo: a.invoiceNo,
          invoiceAmount: a.invoiceAmount,
          dueBefore: Math.round((a.allocatedAmount + a.balanceAfter) * 100) / 100,
          settled: a.allocatedAmount,
          dueAfter: a.balanceAfter,
          status: a.status,
        })),
      });
    }
    const summary = {
      partyCount: parties.length,
      invoiceCount: parties.reduce((n, p) => n + p.invoices.length, 0),
      totalSettled: Math.round(parties.reduce((s, p) => s + p.settled, 0) * 100) / 100,
    };
    if (apply && parties.length > 0) {
      await client.query(
        `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
         VALUES ($1, 'payment_sync', $2, $3, $4, $5)`,
        [
          companyId,
          `Bill status synced with party balance: ${summary.invoiceCount} bills of ${summary.partyCount} parties, ₹${summary.totalSettled}`,
          session?.userId ?? 1,
          session?.name ?? "Unknown",
          JSON.stringify({ ...summary, parties: parties.map((p) => ({ customerId: p.customerId, settled: p.settled, invoices: p.invoices.map((i: any) => [i.invoiceNo, i.settled]) })) }),
        ],
      );
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { applied: apply, ...summary, parties };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

router.get("/payment-sync/preview", async (req, res): Promise<void> => {
  if (!requirePaymentApprover(req, res)) return;
  try {
    res.json(await runPaymentSync(getCompanyId(req), false, (req as any).session));
  } catch (err) {
    logger.error({ err }, "Payment sync preview failed");
    res.status(500).json({ error: "Could not check bills against party balances" });
  }
});

router.post("/payment-sync/apply", async (req, res): Promise<void> => {
  if (!requirePaymentApprover(req, res)) return;
  try {
    res.json(await runPaymentSync(getCompanyId(req), true, (req as any).session));
  } catch (err) {
    logger.error({ err }, "Payment sync apply failed");
    res.status(500).json({ error: "Could not sync bills with party balances" });
  }
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

      // Raw SQL through `client`, not db.insert() — this write MUST be part
      // of this same transaction. db.insert() runs on a separate,
      // auto-committing connection: if anything below this point throws, the
      // ROLLBACK undoes the receipt-number bump but not a Drizzle-inserted
      // row, leaving an orphaned "approved" payment with a receipt number
      // that then collides on every retry, forever (this actually happened —
      // see payments row id 323, receipt REC/08/244, cleaned up manually).
      const insertRes = await client.query(
        `INSERT INTO payments
           (company_id, receipt_id, customer_id, customer_name, invoice_id, salesman_id, salesman_name,
            amount, mode, status, notes, approved_by_id, approved_at, account_id, collected_at, collected_by_id, created_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          companyId, receiptId, customerId, customer.name, parsed.data.invoiceId ?? null, null, null,
          parsed.data.amount, parsed.data.mode, "approved", parsed.data.notes ?? null,
          session.userId, new Date(), parsed.data.accountId ?? null,
          parsed.data.accountId ? new Date() : null, parsed.data.accountId ? session.userId : null,
          session.role ?? null,
        ],
      );
      const payment = mapPaymentRow(insertRes.rows[0]);

      if (parsed.data.accountId) {
        const upd = await client.query(
          `UPDATE accounts SET current_balance = current_balance + $1
           WHERE id = $2 AND is_active = true AND company_id = $3
           RETURNING id`,
          [parsed.data.amount, parsed.data.accountId, companyId]
        );
        if (upd.rowCount === 0) {
          throw new PaymentValidationError(`Account ${parsed.data.accountId} not found or inactive`);
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

      // If the payment names the invoice it was started from, make sure it's
      // a real, still-open bill for THIS customer. Note it gets no special
      // priority — the allocator below settles the customer's oldest bill
      // first and works forward through newer ones (FIFO), so this invoice
      // is paid only when its date comes up in that order.
      if (parsed.data.invoiceId) {
        // customer_id IS NULL is a walk-in invoice (no specific customer
        // entity selected when it was billed) — this payment always
        // resolves to a real customerId (the shared Walk-in Customer entity
        // when none was passed), so a strict equality check here would wrongly
        // reject linking a walk-in payment to its own walk-in invoice.
        const invCheck = await client.query(
          `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND (customer_id = $3 OR customer_id IS NULL) AND status != 'cancelled' AND deleted_at IS NULL`,
          [parsed.data.invoiceId, companyId, customerId]
        );
        if (invCheck.rowCount === 0) {
          throw new PaymentValidationError("Invoice not found, cancelled, or does not belong to this customer");
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
      if (err instanceof PaymentValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
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
      createdByRole: session?.role ?? null,
    }).returning();

    res.status(201).json(formatPayment(payment));
  }
});

// POST /payments/:id/approve
router.post("/payments/:id/approve", async (req, res): Promise<void> => {
  if (!requirePaymentApprover(req, res)) return;
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

    // Raw SQL through `client` — same reason as the POST /payments insert:
    // db.update() would run outside this transaction, so a later failure
    // (there isn't one after this today, but that's exactly the kind of
    // assumption that stops holding the next time this function changes)
    // couldn't roll it back.
    const updRes = await client.query(
      `UPDATE payments
       SET status = 'approved', approved_by_id = $1, approved_at = $2,
           account_id = $3, collected_at = $4, collected_by_id = $5
       WHERE company_id = $6 AND id = $7
       RETURNING *`,
      [
        session?.userId ?? null, new Date(), body.accountId ?? null,
        body.accountId ? new Date() : null, body.accountId ? session?.userId ?? null : null,
        companyId, params.data.id,
      ],
    );
    const updated = mapPaymentRow(updRes.rows[0]);

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
  if (!requirePaymentApprover(req, res)) return;
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
    createdByRole: p.createdByRole ?? null,
    createdAt: p.createdAt?.toISOString(),
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    accountId: p.accountId ?? null,
    accountName: p.accountName ?? null,
    collectedAt: p.collectedAt ? p.collectedAt.toISOString() : null,
  };
}

export default router;
