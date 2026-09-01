// Shared write path for "a payment settled part of what's owed on an entity's
// account" — used by both the customer /payments flow and Cash Book's
// vendor/customer-linked account transactions, so there's exactly one place
// that adjusts entities.outstanding_balance and writes the matching
// ledger_entries row, instead of three near-duplicate inline copies.
//
// The math is the same regardless of entity type: a new invoice/purchase
// bill always INCREASES outstanding_balance (they owe more), so settling it
// always DECREASES it — this is allowed to go negative on purpose, since a
// negative balance is exactly how an advance/credit is represented (already
// surfaced correctly in Khatabook).

const NO_PAY_INVOICE_TYPES = ["quotation", "proforma_invoice", "sale_order", "delivery_challan"];

export interface PaymentAllocation {
  invoiceId: number;
  invoiceNo: string;
  invoiceAmount: number;
  previousPaid: number;
  allocatedAmount: number;
  balanceAfter: number;
  status: "paid" | "partially_paid";
}

export interface AllocatePaymentParams {
  companyId: number;
  customerId: number;
  amount: number;
  /** The invoice the payment was started from, if any. By default it does
   *  NOT jump the queue: the customer's bills are cleared newest-invoice
   *  first and this invoice is settled in its natural newest-first position
   *  along with the rest (this is what the ₹ "Record Payment" button wants —
   *  the latest bill is knocked down first, the remainder rolls back to
   *  older dues). A walk-in invoice (customer_id IS NULL) is always applied
   *  to directly regardless — it isn't part of any customer's allocation
   *  pool. */
  startInvoiceId?: number | null;
  /** Set true only when the caller explicitly asked to settle startInvoiceId
   *  ahead of the rest (Cash Book's "Start With Invoice" picker). Ignored
   *  when startInvoiceId is a walk-in invoice (always applied directly). */
  pinStartInvoice?: boolean;
  receiptNo: string;
}

const NO_PAY_TYPES_SQL = NO_PAY_INVOICE_TYPES.map((t) => `'${t}'`).join(", ");

// Allocates `amount` across a customer's outstanding invoices, newest
// invoice_date first (cancelled/quotation-like types excluded). A payment
// always settles the customer's most recent bill before older ones, so
// whatever they hand over lands on the latest invoice and only the
// remainder rolls back to earlier dues. The invoice the payment was started
// from (startInvoiceId) is NOT given priority by default — it just takes its
// place in newest-first order with the rest. Two exceptions apply
// startInvoiceId first: a walk-in invoice (customer_id IS NULL, never in any
// customer's allocation pool), and pinStartInvoice = true (the caller
// explicitly asked to — Cash Book's "Start With Invoice" picker).
// Persists one payment_allocations row per
// invoice touched — keyed by receiptNo, this codebase's existing cross-table
// join key for a payment event (see GET /payment-receipts/:receiptNo) —
// rather than a polymorphic source id, so a reprint or a later correction
// can always find exactly what this payment did without needing to know
// which table (payments vs account_transactions) originated it.
//
// Any amount left over once every outstanding invoice is exhausted is simply
// not allocated to one — it's already reflected in the caller's separate
// entities.outstanding_balance reduction (can go negative/credit, same as
// applyEntityPayment always allowed).
export async function allocatePaymentAcrossInvoices(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  { companyId, customerId, amount, startInvoiceId, pinStartInvoice, receiptNo }: AllocatePaymentParams,
): Promise<PaymentAllocation[]> {
  let remaining = amount;
  const allocations: PaymentAllocation[] = [];

  async function allocateTo(inv: any): Promise<void> {
    const balanceDue = Number(inv.balance_due);
    const allocated = Math.min(remaining, balanceDue);
    if (allocated <= 0) return;
    const previousPaid = Number(inv.amount_paid);
    const balanceAfter = Math.max(0, balanceDue - allocated);

    await client.query(
      `UPDATE invoices SET amount_paid = amount_paid + $1, balance_due = balance_due - $1
       WHERE id = $2 AND company_id = $3`,
      [allocated, inv.id, companyId],
    );
    await client.query(
      `INSERT INTO payment_allocations
        (company_id, receipt_no, invoice_id, invoice_no, allocated_amount,
         invoice_amount_at_allocation, previous_paid_at_allocation, balance_after_allocation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [companyId, receiptNo, inv.id, inv.invoice_no, allocated, Number(inv.grand_total), previousPaid, balanceAfter],
    );

    allocations.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoice_no,
      invoiceAmount: Number(inv.grand_total),
      previousPaid,
      allocatedAmount: allocated,
      balanceAfter,
      status: balanceAfter <= 0.001 ? "paid" : "partially_paid",
    });
    remaining -= allocated;
  }

  // startInvoiceId is settled before the newest-first pass in two cases:
  //  1. It's a walk-in invoice (customer_id IS NULL — billed with no specific
  //     customer). Walk-in bills aren't in any customer's allocation pool, so
  //     the caller named it explicitly and it's applied directly.
  //  2. pinStartInvoice is true — the caller (Cash Book's "Start With
  //     Invoice" picker) deliberately asked to knock this one down first.
  // Otherwise it stays in the pool and waits its turn in date order, i.e.
  // the customer's latest bill is settled first and this one only when its
  // date comes up.
  // The walk-in match must never leak into the pool: every walk-in
  // invoice shares customer_id NULL, so without the customer_id = $2 filter
  // there a customer's ordinary payment could spill into an unrelated
  // walk-in sale.
  let preAllocatedId: number | null = null;
  if (startInvoiceId != null && remaining > 0.001) {
    const pinnedRes = await client.query(
      `SELECT id, invoice_no, grand_total, amount_paid, balance_due
       FROM invoices
       WHERE id = $1 AND company_id = $2
         AND (customer_id IS NULL${pinStartInvoice ? " OR customer_id = $3" : ""})
         AND status != 'cancelled' AND invoice_type NOT IN (${NO_PAY_TYPES_SQL}) AND balance_due > 0
       FOR UPDATE`,
      pinStartInvoice ? [startInvoiceId, companyId, customerId] : [startInvoiceId, companyId],
    );
    if (pinnedRes.rows[0]) {
      preAllocatedId = pinnedRes.rows[0].id;
      await allocateTo(pinnedRes.rows[0]);
    }
  }

  if (remaining > 0.001) {
    const candidates = await client.query(
      `SELECT id, invoice_no, grand_total, amount_paid, balance_due
       FROM invoices
       WHERE company_id = $1 AND customer_id = $2
         AND ($3::int IS NULL OR id != $3)
         AND status != 'cancelled' AND invoice_type NOT IN (${NO_PAY_TYPES_SQL}) AND balance_due > 0
       ORDER BY invoice_date DESC, id DESC
       FOR UPDATE`,
      [companyId, customerId, preAllocatedId],
    );
    for (const inv of candidates.rows) {
      if (remaining <= 0.001) break;
      await allocateTo(inv);
    }
  }

  return allocations;
}

export interface ApplyEntityPaymentParams {
  companyId: number;
  entityId: number;
  amount: number;
  mode: string;
  receiptNo: string;
  referenceId: number;
  /** True for a customer receipt — triggers newest-first invoice allocation
   *  (see allocatePaymentAcrossInvoices). False/omitted for a vendor payout
   *  or an unlinked payment, which never touch invoices. */
  isCustomerReceipt?: boolean;
  /** The invoice the receipt was started from, when isCustomerReceipt —
   *  ignored otherwise. Does not get payment priority unless pinStartInvoice;
   *  latest bill first. See allocatePaymentAcrossInvoices. */
  startInvoiceId?: number | null;
  /** Settle startInvoiceId ahead of the rest (Cash Book "Start With
   *  Invoice"). Omit for the default newest-first behaviour. */
  pinStartInvoice?: boolean;
  /** Defaults to "Payment received (<mode>)". Pass e.g. "Payment made (<mode>)" for a vendor payout. */
  description?: string;
}

export async function applyEntityPayment(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  { companyId, entityId, amount, mode, receiptNo, referenceId, isCustomerReceipt, startInvoiceId, pinStartInvoice, description }: ApplyEntityPaymentParams,
): Promise<{ newBalance: number; allocations: PaymentAllocation[] }> {
  await client.query(
    `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE id = $2 AND company_id = $3`,
    [amount, entityId, companyId],
  );

  const balRes = await client.query(
    `SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`,
    [entityId, companyId],
  );
  const newBalance = Number(balRes.rows[0]?.outstanding_balance ?? 0);

  await client.query(
    `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
     VALUES ($1, $2, NOW(), $3, 0, $4, $5, 'payment', $6, $7)`,
    [companyId, entityId, description ?? `Payment received (${mode})`, amount, newBalance, referenceId, receiptNo],
  );

  let allocations: PaymentAllocation[] = [];
  if (isCustomerReceipt) {
    allocations = await allocatePaymentAcrossInvoices(client, {
      companyId, customerId: entityId, amount, startInvoiceId, pinStartInvoice, receiptNo,
    });
  }

  return { newBalance, allocations };
}
