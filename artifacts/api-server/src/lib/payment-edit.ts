// Edit / delete a customer payment (Payments page) after it was received.
//
// An approved payment touched several places when it was taken (see
// POST /payments in routes/payments.ts):
//   - the customer's balance and one 'payment' ledger_entries row (credit =
//     cash + discount),
//   - payment_allocations rows marking bills paid (keyed by the receipt no),
//   - a Cash Book entry (account_transactions, same receipt no) and the
//     account's balance, when it was deposited to an account,
//   - a 'Discount' expense, when a discount was given.
// Editing undoes those and books the corrected figures under the SAME
// receipt number; the ledger row is corrected in place (later rows' running
// balances shift by the difference) so the customer's statement keeps its
// date and order. Deleting undoes all of it. A pending (not yet approved)
// payment never moved money, so only its row changes.

import { allocatePaymentAcrossInvoices, NO_PAY_INVOICE_TYPES, type PaymentAllocation } from "./entity-payment";

type Q = { query: (text: string, params?: any[]) => Promise<any> };

export class PaymentEditError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const NO_PAY_TYPES_SQL = NO_PAY_INVOICE_TYPES.map((t) => `'${t}'`).join(", ");
export const PAYMENT_MODES = ["cash", "upi", "bank_transfer", "cheque", "other"] as const;

export interface PaymentChange {
  amount: number;
  discount: number;
  mode: string;
  accountId: number | null;
  notes: string | null;
}

interface Booked {
  ledger: { id: number; credit: number; created_at: Date } | null;
  txn: { id: number; account_id: number; amount: number } | null;
  discountExpense: { id: number; amount: number } | null;
}

async function lockPayment(client: Q, companyId: number, id: number) {
  const p = (await client.query(`SELECT * FROM payments WHERE company_id = $1 AND id = $2 FOR UPDATE`, [companyId, id])).rows[0];
  if (!p) throw new PaymentEditError("Payment not found", 404);
  return p;
}

// What the approved payment booked, found by its receipt number.
async function findBooked(client: Q, companyId: number, p: any): Promise<Booked> {
  const ledger = (await client.query(
    `SELECT id, credit::float AS credit, created_at FROM ledger_entries
     WHERE company_id = $1 AND entity_id = $2 AND type = 'payment' AND reference_no = $3
     ORDER BY (reference_id = $4) DESC, id ASC LIMIT 1`,
    [companyId, p.customer_id, p.receipt_id, p.id],
  )).rows[0] ?? null;
  const txn = (await client.query(
    `SELECT id, account_id, amount::float AS amount FROM account_transactions
     WHERE company_id = $1 AND receipt_no = $2 AND direction = 'in'
     ORDER BY id ASC LIMIT 1`,
    [companyId, p.receipt_id],
  )).rows[0] ?? null;
  if (txn) {
    const linked = (await client.query(
      `SELECT 1 FROM bank_statement_lines WHERE company_id = $1 AND (account_txn_id = $2 OR other_txn_id = $2) LIMIT 1`,
      [companyId, txn.id],
    ).catch(() => ({ rows: [] }))).rows.length > 0;
    if (linked) {
      throw new PaymentEditError("This payment is matched in Bank Reconciliation. Undo that match first (Books & Audit → Bank Reconciliation), then edit or delete it.", 409);
    }
  }
  const discountExpense = (await client.query(
    `SELECT id, amount::float AS amount FROM expenses
     WHERE company_id = $1 AND category_name = 'Discount' AND notes LIKE $2
     ORDER BY id ASC LIMIT 1`,
    [companyId, `Discount on payment ${p.receipt_id}%`],
  )).rows[0] ?? null;
  return { ledger, txn, discountExpense };
}

// Takes the bills' paid amounts back to before this receipt.
async function undoAllocations(client: Q, companyId: number, receiptNo: string): Promise<void> {
  const rows = (await client.query(
    `DELETE FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2
     RETURNING invoice_id, allocated_amount::float AS amt`,
    [companyId, receiptNo],
  )).rows;
  for (const a of rows) {
    if (a.invoice_id == null) continue;
    await client.query(
      `UPDATE invoices SET amount_paid = GREATEST(0, amount_paid - $1), balance_due = LEAST(grand_total, balance_due + $1)
       WHERE id = $2 AND company_id = $3`,
      [a.amt, a.invoice_id, companyId],
    );
  }
}

async function removeTxn(client: Q, companyId: number, txn: Booked["txn"]): Promise<void> {
  if (!txn) return;
  await client.query(`DELETE FROM account_transactions WHERE company_id = $1 AND id = $2`, [companyId, txn.id]);
  await client.query(
    `UPDATE accounts SET current_balance = current_balance - $1 WHERE company_id = $2 AND id = $3`,
    [txn.amount, companyId, txn.account_id],
  );
}

async function audit(client: Q, companyId: number, session: any, action: string, description: string, metadata: object) {
  await client.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [companyId, action, description, session?.userId ?? 1, session?.name ?? session?.username ?? "Unknown", JSON.stringify(metadata)],
  );
}

export async function editPayment(
  client: Q, companyId: number, session: any, id: number, ch: PaymentChange,
): Promise<{ payment: any; allocations: PaymentAllocation[] }> {
  const p = await lockPayment(client, companyId, id);
  const amount = round2(ch.amount);
  const discount = round2(ch.discount);
  if (!(amount >= 0) || !(discount >= 0) || amount + discount <= 0) {
    throw new PaymentEditError("Amount and discount must be zero or more, and not both zero");
  }
  if (!(PAYMENT_MODES as readonly string[]).includes(ch.mode)) throw new PaymentEditError("Choose a payment mode");
  const before = { amount: Number(p.amount), mode: p.mode, accountId: p.account_id, notes: p.notes };

  if (p.status !== "approved") {
    // Not approved yet: no money has moved — only the row changes.
    if (discount > 0) throw new PaymentEditError("A discount can be given only on an approved payment");
    const { rows: [u] } = await client.query(
      `UPDATE payments SET amount = $1, mode = $2, notes = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
      [amount, ch.mode, ch.notes, id],
    );
    await audit(client, companyId, session, "payment_edit", `Payment ${p.receipt_id} (${p.customer_name}) edited: ₹${before.amount} → ₹${amount}`, { paymentId: id, before, after: ch });
    return { payment: u, allocations: [] };
  }

  const booked = await findBooked(client, companyId, p);
  const oldTotal = booked.ledger ? booked.ledger.credit : round2(Number(p.amount) + (booked.discountExpense?.amount ?? 0));
  const newTotal = round2(amount + discount);

  // 1. Bills and balance back to before this payment.
  await undoAllocations(client, companyId, p.receipt_id);
  await client.query(`SELECT id FROM entities WHERE id = $1 AND company_id = $2 FOR UPDATE`, [p.customer_id, companyId]);
  await client.query(
    `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3`,
    [oldTotal, p.customer_id, companyId],
  );

  // 2. Same rule as a new payment: old dues not on any open bill are paid
  //    first; the rest settles bills oldest-first (entity-payment.ts).
  let billAmount = newTotal;
  const walkIn = p.invoice_id != null && (await client.query(
    `SELECT 1 FROM invoices WHERE id = $1 AND company_id = $2 AND customer_id IS NULL`, [p.invoice_id, companyId],
  )).rows.length > 0;
  if (!walkIn) {
    const pre = (await client.query(
      `SELECT e.outstanding_balance::float AS bal,
              (SELECT COALESCE(SUM(i.balance_due), 0)::float FROM invoices i
                WHERE i.company_id = e.company_id AND i.customer_id = e.id
                  AND i.status != 'cancelled' AND i.invoice_type NOT IN (${NO_PAY_TYPES_SQL}) AND i.balance_due > 0) AS open_due
       FROM entities e WHERE e.id = $1 AND e.company_id = $2`,
      [p.customer_id, companyId],
    )).rows[0];
    if (pre) billAmount = Math.max(0, round2(newTotal - Math.max(0, pre.bal - pre.open_due)));
  }
  await client.query(
    `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE id = $2 AND company_id = $3`,
    [newTotal, p.customer_id, companyId],
  );

  // 3. The ledger row, corrected in place; later running balances shift.
  const delta = round2(newTotal - oldTotal);
  if (booked.ledger) {
    const description = discount > 0
      ? `Payment received (${ch.mode}) ₹${amount} + discount ₹${discount}`
      : `Payment received (${ch.mode})`;
    await client.query(`UPDATE ledger_entries SET credit = $1, description = $2 WHERE id = $3`, [newTotal, description, booked.ledger.id]);
    if (delta !== 0) {
      await client.query(
        `UPDATE ledger_entries SET balance = balance - $1
         WHERE company_id = $2 AND entity_id = $3 AND (created_at, id) >= ($4, $5)`,
        [delta, companyId, p.customer_id, booked.ledger.created_at, booked.ledger.id],
      );
    }
  }

  const allocations = billAmount > 0.009
    ? await allocatePaymentAcrossInvoices(client, {
        companyId, customerId: p.customer_id, amount: billAmount, startInvoiceId: p.invoice_id ?? null, receiptNo: p.receipt_id,
      })
    : [];

  // 4. Cash Book entry / account balance.
  if (ch.accountId && amount > 0) {
    const acct = (await client.query(
      `SELECT id FROM accounts WHERE id = $1 AND company_id = $2 AND is_active = true`, [ch.accountId, companyId],
    )).rows[0];
    if (!acct) throw new PaymentEditError("Deposit account not found or inactive");
    if (booked.txn) {
      await client.query(
        `UPDATE accounts SET current_balance = current_balance - $1 WHERE company_id = $2 AND id = $3`,
        [booked.txn.amount, companyId, booked.txn.account_id],
      );
      await client.query(
        `UPDATE account_transactions SET account_id = $1, amount = $2, mode = $3 WHERE id = $4 AND company_id = $5`,
        [ch.accountId, amount, ch.mode, booked.txn.id, companyId],
      );
    } else {
      await client.query(
        `INSERT INTO account_transactions
          (company_id, account_id, direction, amount, mode, party_name, party_entity_id, notes, receipt_no, created_by_id, created_by_name, created_by_role)
         VALUES ($1,$2,'in',$3,$4,$5,$6,'Payment received',$7,$8,$9,$10)`,
        [companyId, ch.accountId, amount, ch.mode, p.customer_name, p.customer_id, p.receipt_id,
          session?.userId ?? null, session?.name ?? session?.username ?? null, session?.role ?? null],
      );
    }
    await client.query(
      `UPDATE accounts SET current_balance = current_balance + $1 WHERE company_id = $2 AND id = $3`,
      [amount, companyId, ch.accountId],
    );
  } else {
    await removeTxn(client, companyId, booked.txn);
  }

  // 5. Discount expense.
  if (booked.discountExpense) {
    if (discount > 0) {
      await client.query(`UPDATE expenses SET amount = $1 WHERE id = $2`, [String(discount), booked.discountExpense.id]);
    } else {
      await client.query(`DELETE FROM expenses WHERE id = $1`, [booked.discountExpense.id]);
    }
  } else if (discount > 0) {
    const cat = await client.query(
      `INSERT INTO expense_categories (company_id, name) VALUES ($1, 'Discount')
       ON CONFLICT (company_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [companyId],
    );
    await client.query(
      `INSERT INTO expenses (company_id, date, category_id, category_name, amount, payment_mode, account_id, paid_to, notes, created_by_user_id)
       VALUES ($1, (NOW() AT TIME ZONE 'Asia/Kolkata')::date, $2, 'Discount', $3, 'cash', NULL, $4, $5, $6)`,
      [companyId, cat.rows[0].id, String(discount), p.customer_name, `Discount on payment ${p.receipt_id}`, session?.userId ?? null],
    );
  }

  // 6. The payment row.
  const { rows: [u] } = await client.query(
    `UPDATE payments SET amount = $1, mode = $2, notes = $3, account_id = $4,
       collected_at = CASE WHEN $4::int IS NULL THEN NULL ELSE COALESCE(collected_at, NOW()) END,
       collected_by_id = CASE WHEN $4::int IS NULL THEN NULL ELSE COALESCE(collected_by_id, $5) END,
       updated_at = NOW()
     WHERE id = $6 RETURNING *`,
    [amount, ch.mode, ch.notes, ch.accountId && amount > 0 ? ch.accountId : null, session?.userId ?? null, id],
  );
  await audit(client, companyId, session, "payment_edit",
    `Payment ${p.receipt_id} (${p.customer_name}) edited: ₹${before.amount}${booked.discountExpense ? ` + ₹${booked.discountExpense.amount} discount` : ""} → ₹${amount}${discount > 0 ? ` + ₹${discount} discount` : ""}`,
    { paymentId: id, before: { ...before, discount: booked.discountExpense?.amount ?? 0 }, after: ch });
  return { payment: u, allocations };
}

export async function deletePayment(client: Q, companyId: number, session: any, id: number): Promise<void> {
  const p = await lockPayment(client, companyId, id);
  if (p.status === "approved") {
    const booked = await findBooked(client, companyId, p);
    const oldTotal = booked.ledger ? booked.ledger.credit : round2(Number(p.amount) + (booked.discountExpense?.amount ?? 0));
    await undoAllocations(client, companyId, p.receipt_id);
    await client.query(
      `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3`,
      [oldTotal, p.customer_id, companyId],
    );
    if (booked.ledger) {
      // Rows after it no longer have this credit in their running balance.
      await client.query(
        `UPDATE ledger_entries SET balance = balance + $1
         WHERE company_id = $2 AND entity_id = $3 AND (created_at, id) > ($4, $5)`,
        [oldTotal, companyId, p.customer_id, booked.ledger.created_at, booked.ledger.id],
      );
      await client.query(`DELETE FROM ledger_entries WHERE id = $1`, [booked.ledger.id]);
    }
    await removeTxn(client, companyId, booked.txn);
    if (booked.discountExpense) await client.query(`DELETE FROM expenses WHERE id = $1`, [booked.discountExpense.id]);
  }
  await client.query(`DELETE FROM payments WHERE id = $1 AND company_id = $2`, [id, companyId]);
  await audit(client, companyId, session, "payment_delete",
    `Payment ${p.receipt_id} (${p.customer_name}) of ₹${Number(p.amount)} deleted`,
    { paymentId: id, receiptNo: p.receipt_id, customerId: p.customer_id, amount: Number(p.amount), mode: p.mode, status: p.status });
}

// Everything the View dialog shows: how much, how, where it was deposited,
// who took / approved it, the discount and which bills it settled.
export async function paymentDetails(client: Q, companyId: number, id: number) {
  const p = (await client.query(
    `SELECT p.*, a.name AS account_name, i.invoice_no AS start_invoice_no,
            ap.name AS approved_by_name
     FROM payments p
     LEFT JOIN accounts a ON a.id = p.account_id AND a.company_id = p.company_id
     LEFT JOIN invoices i ON i.id = p.invoice_id AND i.company_id = p.company_id
     LEFT JOIN users ap ON ap.id = p.approved_by_id
     WHERE p.company_id = $1 AND p.id = $2`,
    [companyId, id],
  )).rows[0];
  if (!p) throw new PaymentEditError("Payment not found", 404);
  const discount = (await client.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS d FROM expenses
     WHERE company_id = $1 AND category_name = 'Discount' AND notes LIKE $2`,
    [companyId, `Discount on payment ${p.receipt_id}%`],
  )).rows[0].d;
  const allocations = (await client.query(
    `SELECT invoice_id, invoice_no, allocated_amount::float AS allocated, balance_after_allocation::float AS balance_after
     FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2 ORDER BY id`,
    [companyId, p.receipt_id],
  )).rows;
  const ledger = (await client.query(
    `SELECT credit::float AS credit, balance::float AS balance FROM ledger_entries
     WHERE company_id = $1 AND entity_id = $2 AND type = 'payment' AND reference_no = $3 ORDER BY id DESC LIMIT 1`,
    [companyId, p.customer_id, p.receipt_id],
  )).rows[0];
  return {
    id: p.id,
    receiptId: p.receipt_id,
    customerId: p.customer_id,
    customerName: p.customer_name,
    amount: Number(p.amount),
    discount,
    mode: p.mode,
    status: p.status,
    notes: p.notes ?? null,
    accountId: p.account_id ?? null,
    accountName: p.account_name ?? null,
    salesmanName: p.salesman_name ?? null,
    approvedByName: p.approved_by_name ?? null,
    startInvoiceNo: p.start_invoice_no ?? null,
    createdAt: new Date(p.created_at).toISOString(),
    approvedAt: p.approved_at ? new Date(p.approved_at).toISOString() : null,
    updatedAt: p.updated_at ? new Date(p.updated_at).toISOString() : null,
    allocations: allocations.map((a: any) => ({ invoiceId: a.invoice_id, invoiceNo: a.invoice_no, allocated: a.allocated, balanceAfter: a.balance_after })),
    balanceBefore: ledger ? round2(ledger.balance + ledger.credit) : null,
    balanceAfter: ledger ? ledger.balance : null,
  };
}
