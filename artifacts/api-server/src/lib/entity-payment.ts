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

export interface ApplyEntityPaymentParams {
  companyId: number;
  entityId: number;
  amount: number;
  mode: string;
  receiptNo: string;
  referenceId: number;
  invoiceId?: number | null;
  /** Defaults to "Payment received (<mode>)". Pass e.g. "Payment made (<mode>)" for a vendor payout. */
  description?: string;
}

export async function applyEntityPayment(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  { companyId, entityId, amount, mode, receiptNo, referenceId, invoiceId, description }: ApplyEntityPaymentParams,
): Promise<{ newBalance: number }> {
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

  if (invoiceId != null) {
    await client.query(
      `UPDATE invoices
       SET amount_paid = amount_paid + LEAST($1, balance_due),
           balance_due = GREATEST(0, balance_due - $1)
       WHERE id = $2 AND company_id = $3`,
      [amount, invoiceId, companyId],
    );
  }

  return { newBalance };
}
