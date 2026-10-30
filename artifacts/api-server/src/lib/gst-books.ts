// The GST share of Cash Book money, for Books & Audit (which is kept on GST
// bills only — see lib/books.ts). Only money that belongs to a GST bill is
// counted:
//
//   - a customer receipt: the part allocated to GST invoices
//     (payment_allocations, by receipt number);
//   - a supplier payment: payments aren't tied to a bill, so they clear the
//     supplier's oldest bill first (FIFO) — the part that lands on GST bills;
//   - expense payments and contra transfers between accounts, in full;
//   - anything else (non-GST receipts, other payments): nothing.
//
// Cash / bank balances and supplier dues are then built from these shares,
// so nothing of the non-GST business shows through them.
import { pool } from "@workspace/db";

const IST = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface GstCash {
  // account_transactions.id → GST share (always ≥ 0, ≤ the entry's amount).
  share: Map<number, number>;
  // Cash Book accounts: GST balance as on the date.
  accounts: { id: number; name: string; type: string; opening: number; balance: number }[];
  // vendor entity id → still due on that supplier's GST bills.
  vendorDue: Map<number, number>;
}

interface Event { at: number; kind: "bill" | "pay"; gst: boolean; amount: number; txnId?: number }

// Supplier payments against the supplier's bills, oldest first. A payment
// beyond what is due waits as an advance for the next bill.
function fifo(events: Event[], share: Map<number, number>): number {
  // Same moment: the bill first. Otherwise the order given (stable sort).
  events.sort((a, b) => (a.at === b.at ? (a.kind === b.kind ? 0 : a.kind === "bill" ? -1 : 1) : a.at < b.at ? -1 : 1));
  const bills: { gst: boolean; left: number }[] = [];
  const credits: { txnId: number; left: number }[] = [];
  for (const e of events) {
    let left = e.amount;
    if (e.kind === "bill") {
      while (left > 0.005 && credits.length) {
        const c = credits[0];
        const take = Math.min(left, c.left);
        if (e.gst) share.set(c.txnId, (share.get(c.txnId) ?? 0) + take);
        c.left -= take;
        left -= take;
        if (c.left <= 0.005) credits.shift();
      }
      if (left > 0.005) bills.push({ gst: e.gst, left });
    } else {
      while (left > 0.005 && bills.length) {
        const b = bills[0];
        const take = Math.min(left, b.left);
        if (b.gst) share.set(e.txnId!, (share.get(e.txnId!) ?? 0) + take);
        b.left -= take;
        left -= take;
        if (b.left <= 0.005) bills.shift();
      }
      if (left > 0.005) credits.push({ txnId: e.txnId!, left });
    }
  }
  return bills.filter((b) => b.gst).reduce((s, b) => s + b.left, 0);
}

// Everything as on `to` (an IST day, inclusive).
export async function gstCash(companyId: number, to: string): Promise<GstCash> {
  const [txns, accounts, bills, vendors] = await Promise.all([
    pool.query(
      `SELECT t.id, t.account_id, t.direction, t.amount, t.receipt_no, t.notes, t.party_entity_id, t.created_at,
              e.type AS party_type,
              COALESCE((
                SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
                JOIN invoices i ON i.id = pa.invoice_id AND i.company_id = pa.company_id
                WHERE pa.company_id = t.company_id AND pa.receipt_no = t.receipt_no
                  AND i.invoice_type = 'gst' AND i.status = 'saved'
              ), 0) AS gst_allocated
       FROM account_transactions t
       LEFT JOIN entities e ON e.id = t.party_entity_id AND e.company_id = t.company_id
       WHERE t.company_id = $1 AND ${IST("t.created_at")} <= $2::date
       ORDER BY t.created_at, t.id`,
      [companyId, to],
    ),
    // Opening = today's balance minus every entry ever made.
    pool.query(
      `SELECT a.id, a.name, a.type,
              a.current_balance - COALESCE((
                SELECT SUM(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END)
                FROM account_transactions t WHERE t.company_id = a.company_id AND t.account_id = a.id
              ), 0) AS opening
       FROM accounts a WHERE a.company_id = $1 ORDER BY a.name`,
      [companyId],
    ),
    // Each bill net of the debit notes against it.
    pool.query(
      `SELECT p.vendor_id, p.bill_date, p.bill_type,
              p.grand_total - COALESCE((
                SELECT SUM(pr.grand_total) FROM purchase_returns pr
                WHERE pr.company_id = p.company_id AND pr.purchase_id = p.id AND pr.status = 'saved' AND ${IST("pr.return_date")} <= $2::date
              ), 0) AS amount
       FROM purchases p
       WHERE p.company_id = $1 AND p.status = 'saved' AND p.deleted_at IS NULL AND p.vendor_id IS NOT NULL
         AND ${IST("p.bill_date")} <= $2::date
       ORDER BY p.bill_date, p.id`,
      [companyId, to],
    ),
    // A supplier's dues from before the ERP (opening) come first and are not GST bills.
    pool.query(
      `SELECT e.id, e.outstanding_balance - COALESCE((
                SELECT SUM(le.debit - le.credit) FROM ledger_entries le WHERE le.company_id = e.company_id AND le.entity_id = e.id
              ), 0) AS opening
       FROM entities e WHERE e.company_id = $1 AND e.type = 'vendor'`,
      [companyId],
    ),
  ]);

  const share = new Map<number, number>();
  const byVendor = new Map<number, Event[]>();
  const eventsOf = (id: number) => {
    let list = byVendor.get(id);
    if (!list) byVendor.set(id, (list = []));
    return list;
  };
  for (const v of vendors.rows) if (n(v.opening) > 0.005) eventsOf(v.id).push({ at: -Infinity, kind: "bill", gst: false, amount: n(v.opening) });
  for (const b of bills.rows) {
    if (n(b.amount) > 0.005) eventsOf(b.vendor_id).push({ at: new Date(b.bill_date).getTime(), kind: "bill", gst: b.bill_type === "gst", amount: n(b.amount) });
  }

  for (const t of txns.rows) {
    const amount = n(t.amount);
    const notes = String(t.notes ?? "");
    if (String(t.receipt_no ?? "").startsWith("TRF-")) share.set(t.id, amount);
    else if (t.direction === "out" && notes.startsWith("Expense: ")) share.set(t.id, amount);
    else if (t.direction === "in" && n(t.gst_allocated) > 0) share.set(t.id, Math.min(amount, n(t.gst_allocated)));
    else if (t.direction === "out" && t.party_type === "vendor" && t.party_entity_id) {
      eventsOf(t.party_entity_id).push({ at: new Date(t.created_at).getTime(), kind: "pay", gst: false, amount, txnId: t.id });
    }
  }
  const vendorDue = new Map<number, number>();
  for (const [id, events] of byVendor) {
    const due = fifo(events, share);
    if (due > 0.005) vendorDue.set(id, r2(due));
  }
  for (const [id, v] of share) share.set(id, r2(v));

  const movement = new Map<number, number>();
  for (const t of txns.rows) {
    const s = share.get(t.id) ?? 0;
    if (s) movement.set(t.account_id, (movement.get(t.account_id) ?? 0) + (t.direction === "in" ? s : -s));
  }
  return {
    share,
    vendorDue,
    accounts: accounts.rows.map((a: any) => ({
      id: a.id, name: a.name, type: a.type, opening: r2(n(a.opening)), balance: r2(n(a.opening) + (movement.get(a.id) ?? 0)),
    })),
  };
}

// What each customer still owes on GST invoices as on `to`: each GST
// invoice's balance due plus whatever was set against it after `to`.
export async function gstCustomerDues(companyId: number, to: string): Promise<Map<number, number>> {
  const r = await pool.query(
    `SELECT i.customer_id, SUM(i.balance_due + COALESCE((
       SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
       WHERE pa.company_id = i.company_id AND pa.invoice_id = i.id AND ${IST("pa.created_at")} > $2::date
     ), 0)) AS due
     FROM invoices i
     WHERE i.company_id = $1 AND i.status = 'saved' AND i.invoice_type = 'gst' AND i.customer_id IS NOT NULL
       AND ${IST("i.invoice_date")} <= $2::date
     GROUP BY i.customer_id`,
    [companyId, to],
  );
  return new Map(r.rows.filter((x: any) => Math.abs(n(x.due)) > 0.005).map((x: any) => [x.customer_id, r2(n(x.due))]));
}
