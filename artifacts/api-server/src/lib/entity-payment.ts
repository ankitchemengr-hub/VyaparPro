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
  /** Optional invoice to apply first (e.g. a manually-picked one) — any
   *  remainder still spills FIFO into the customer's other oldest
   *  outstanding invoices, same as if none had been picked. */
  startInvoiceId?: number | null;
  receiptNo: string;
}

// FIFO-allocates `amount` across a customer's outstanding invoices (oldest
// invoice_date first, cancelled/quotation-like types excluded), optionally
// starting with one pinned invoice. Persists one payment_allocations row per
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
  { companyId, customerId, amount, startInvoiceId, receiptNo }: AllocatePaymentParams,
): Promise<PaymentAllocation[]> {
  const candidates = await client.query(
    `SELECT id, invoice_no, grand_total, amount_paid, balance_due
     FROM invoices
     WHERE company_id = $1 AND customer_id = $2 AND status != 'cancelled'
       AND invoice_type NOT IN ('quotation', 'proforma_invoice', 'sale_order', 'delivery_challan')
       AND balance_due > 0
     ORDER BY (id = $3) DESC, invoice_date ASC, id ASC
     FOR UPDATE`,
    [companyId, customerId, startInvoiceId ?? 0],
  );

  let remaining = amount;
  const allocations: PaymentAllocation[] = [];
  for (const inv of candidates.rows) {
    if (remaining <= 0.001) break;
    const balanceDue = Number(inv.balance_due);
    const allocated = Math.min(remaining, balanceDue);
    if (allocated <= 0) continue;
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

  return allocations;
}

export interface ApplyEntityPaymentParams {
  companyId: number;
  entityId: number;
  amount: number;
  mode: string;
  receiptNo: string;
  referenceId: number;
  /** True for a customer receipt — triggers FIFO invoice allocation (see
   *  allocatePaymentAcrossInvoices). False/omitted for a vendor payout or an
   *  unlinked payment, which never touch invoices. */
  isCustomerReceipt?: boolean;
  /** Optional invoice to apply first when isCustomerReceipt — ignored otherwise. */
  startInvoiceId?: number | null;
  /** Defaults to "Payment received (<mode>)". Pass e.g. "Payment made (<mode>)" for a vendor payout. */
  description?: string;
}

export async function applyEntityPayment(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  { companyId, entityId, amount, mode, receiptNo, referenceId, isCustomerReceipt, startInvoiceId, description }: ApplyEntityPaymentParams,
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
      companyId, customerId: entityId, amount, startInvoiceId, receiptNo,
    });
  }

  return { newBalance, allocations };
}
