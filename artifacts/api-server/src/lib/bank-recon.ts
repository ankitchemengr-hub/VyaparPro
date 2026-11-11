// Bank Reconciliation: lines from an uploaded bank statement (read in the
// browser from PDF / Excel / CSV) are stored per bank account, then each one
// is either matched to a Cash Book entry that already records it, or booked
// from the statement — a customer receipt (clears their bills, oldest first
// or the bill named), a supplier payment, an expense, a transfer between
// the business's own accounts, or a plain Cash Book entry. Lines nobody
// recognises stay "pending" (the Suspense list) until someone links them.
//
// Bookings mirror the Cash Book / Expenses / Transfer routes (same tables,
// same receipt series), dated on the statement's date, and can be undone.
import crypto from "node:crypto";
import { generateSeriesNumber } from "./number-series";
import { applyEntityPayment, NO_PAY_INVOICE_TYPES } from "./entity-payment";

type Q = { query: (text: string, params?: any[]) => Promise<any> };

export const MAX_LINES = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NO_PAY_SQL = NO_PAY_INVOICE_TYPES.map((t) => `'${t}'`).join(", ");

export class ReconError extends Error {}

export type ReconUser = { userId: number | null; name: string | null; role: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;

function toAmount(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? round2(Math.abs(v)) : 0;
  const s = String(v ?? "").replace(/[₹,\s]/g, "").replace(/(cr|dr)$/i, "");
  const n = Number(s);
  return Number.isFinite(n) ? round2(Math.abs(n)) : 0;
}

function toBalance(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? round2(v) : null;
  const raw = String(v).trim();
  const dr = /dr\.?$/i.test(raw);
  const n = Number(raw.replace(/[₹,\s]/g, "").replace(/(cr|dr)\.?$/i, ""));
  if (!Number.isFinite(n)) return null;
  return round2(dr ? -Math.abs(n) : n);
}

const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface StatementRowIn { date?: unknown; description?: unknown; ref?: unknown; debit?: unknown; credit?: unknown; balance?: unknown }

// Stores the statement's lines for one account. A line already stored (same
// date, amounts, balance, narration — e.g. from an overlapping statement) is
// skipped, so uploading the same file twice adds nothing.
export async function importStatement(
  client: Q,
  companyId: number,
  opts: { accountId: number; rows: StatementRowIn[]; fileName: string | null; dryRun: boolean; userName: string | null },
): Promise<{ added: number; duplicates: number; errors: Array<{ index: number; error: string }>; from: string | null; to: string | null }> {
  const acct = (await client.query(
    `SELECT id FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true`,
    [companyId, opts.accountId],
  )).rows[0];
  if (!acct) throw new ReconError("Bank account not found or inactive");

  const errors: Array<{ index: number; error: string }> = [];
  const seen = new Map<string, number>();
  let added = 0;
  let duplicates = 0;
  let from: string | null = null;
  let to: string | null = null;
  for (let i = 0; i < opts.rows.length; i++) {
    const r = opts.rows[i] ?? {};
    const date = String(r.date ?? "").trim();
    if (!validDate(date)) { errors.push({ index: i, error: "Date not readable" }); continue; }
    const debit = toAmount(r.debit);
    const credit = toAmount(r.credit);
    if ((debit > 0) === (credit > 0)) { errors.push({ index: i, error: "Needs either a withdrawal or a deposit amount" }); continue; }
    const description = cleanText(r.description, 500);
    const ref = cleanText(r.ref, 80) || null;
    const balance = toBalance(r.balance);
    const key = [date, debit.toFixed(2), credit.toFixed(2), balance == null ? "" : balance.toFixed(2), description.toUpperCase(), (ref ?? "").toUpperCase()].join("|");
    // Two identical lines in one statement (same day, same amount, no
    // balance column) are two real transactions — numbered, not merged.
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const hash = crypto.createHash("sha1").update(`${key}|#${occurrence}`).digest("hex");
    if (!from || date < from) from = date;
    if (!to || date > to) to = date;
    const ins = await client.query(
      `INSERT INTO bank_statement_lines (company_id, account_id, txn_date, description, ref_no, debit, credit, balance, line_hash, file_name, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (company_id, account_id, line_hash) DO NOTHING RETURNING id`,
      [companyId, opts.accountId, date, description, ref, debit, credit, balance, hash, opts.fileName, opts.userName],
    );
    if (ins.rows.length) added++; else duplicates++;
  }
  return { added, duplicates, errors, from, to };
}

// ---------------------------------------------------------------------------
// Suggestions

export type SuggestionKind = "existing" | "party" | "expense" | "transfer" | "other";
export interface Suggestion {
  kind: SuggestionKind;
  label: string;
  confidence: "high" | "medium";
  accountTxnId?: number;
  entityId?: number;
  entityName?: string;
  entityType?: string;
  invoiceId?: number;
  invoiceNo?: string;
  categoryName?: string;
  otherAccountId?: number;
  partyName?: string;
}

const STOP_WORDS = new Set([
  "THE", "AND", "MRS", "SHRI", "SRI", "SMT", "TRADERS", "TRADING", "TRADER", "ENTERPRISES", "ENTERPRISE", "STORES", "STORE",
  "AGENCY", "AGENCIES", "PVT", "LTD", "LIMITED", "PRIVATE", "COMPANY", "SONS", "INDUSTRIES", "CORPORATION", "CORP",
  "BROTHERS", "BROS", "GENERAL", "SHOP", "MART", "CENTRE", "CENTER", "HOUSE", "LLP", "INDIA", "AUTO", "AUTOMOBILES",
  "MOTORS", "SALES", "SERVICE", "SERVICES", "HARDWARE", "MEDICAL", "KIRANA", "NEW",
]);
const normText = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const nameTokens = (name: string) =>
  normText(name).split(" ").filter((t) => t.length >= 3 && !STOP_WORDS.has(t) && !/^\d+$/.test(t)).slice(0, 3);

// How strongly a party's name shows in a narration (0 = not at all). UPI
// narrations cut names short ("RAMESH KUM"), so after one whole word the
// rest may match as a prefix of at least 3 letters.
function nameScore(tokens: string[], words: string[]): number {
  if (!tokens.length) return 0;
  const whole = tokens.filter((t) => words.includes(t));
  if (!whole.length || Math.max(...whole.map((t) => t.length)) < 4) return 0;
  if (tokens.length === 1) return tokens[0].length >= 4 ? tokens[0].length : 0;
  const rest = tokens.filter((t) => !whole.includes(t));
  const restOk = rest.every((t) => words.some((w) => w.length >= 3 && t.startsWith(w)));
  return restOk ? tokens.join("").length : 0;
}

const CHARGES_RE = /\b(CHGS?|CHARGES?|CHRG|SMS ALERT|AMC|FEES?|GST ON|SERVICE CHARGE|MIN BAL|NON MAINT|PENALTY|ANNUAL FEE|DEBIT CARD)\b/;
const CASH_OUT_RE = /\b(ATM|CASH WDL|CASH WITHDRAWAL|CWDR|NFS|SELF)\b/;
const CASH_IN_RE = /\b(CASH DEP|CASH DEPOSIT|BY CASH|CDM|CASH)\b/;
const INTEREST_RE = /\b(INT PD|INT CR|INTEREST|INT PAID|SB INT)\b/;

type LineRow = { id: number; txn_date: string; description: string; debit: string; credit: string };

export async function suggestFor(client: Q, companyId: number, accountId: number, lines: LineRow[]): Promise<Map<number, Suggestion>> {
  const out = new Map<number, Suggestion>();
  if (!lines.length) return out;
  const dates = lines.map((l) => l.txn_date).sort();
  const [txns, entities, invoices, purchases, cash] = await Promise.all([
    client.query(
      `SELECT t.id, t.direction, t.amount::float AS amount, t.receipt_no, t.party_name,
              (t.created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS d
         FROM account_transactions t
        WHERE t.company_id = $1 AND t.account_id = $2
          AND t.created_at >= ($3::date - 7)::timestamptz AND t.created_at < ($4::date + 8)::timestamptz
          AND NOT EXISTS (SELECT 1 FROM bank_statement_lines b
                           WHERE b.company_id = t.company_id AND (b.account_txn_id = t.id OR b.other_txn_id = t.id))
        ORDER BY t.created_at, t.id`,
      [companyId, accountId, dates[0], dates[dates.length - 1]],
    ),
    client.query(
      `SELECT id, name, type, mobile FROM entities WHERE company_id = $1 AND type IN ('customer', 'vendor') AND is_active = true`,
      [companyId],
    ),
    client.query(
      `SELECT i.id, i.invoice_no, i.customer_id, i.balance_due::float AS due
         FROM invoices i
        WHERE i.company_id = $1 AND i.customer_id IS NOT NULL AND i.status <> 'cancelled' AND i.deleted_at IS NULL
          AND i.invoice_type NOT IN (${NO_PAY_SQL}) AND i.balance_due > 0
        ORDER BY i.invoice_date, i.id`,
      [companyId],
    ),
    client.query(
      `SELECT p.vendor_id, p.bill_no, p.grand_total::float AS total
         FROM purchases p JOIN entities e ON e.id = p.vendor_id AND e.company_id = p.company_id
        WHERE p.company_id = $1 AND p.status <> 'cancelled' AND e.outstanding_balance > 0
          AND p.bill_date >= ($2::date - 180)::timestamptz`,
      [companyId, dates[0]],
    ),
    client.query(
      `SELECT id, name FROM accounts WHERE company_id = $1 AND type = 'cash' AND is_active = true AND id <> $2 ORDER BY id LIMIT 1`,
      [companyId, accountId],
    ),
  ]);

  const ents = entities.rows.map((e: any) => ({ ...e, tokens: nameTokens(e.name), mob: String(e.mobile ?? "").replace(/\D/g, "").slice(-10) }));
  const byMobile = new Map<string, any[]>();
  for (const e of ents) if (e.mob.length === 10) byMobile.set(e.mob, [...(byMobile.get(e.mob) ?? []), e]);
  const entById = new Map<number, any>(ents.map((e: any) => [e.id, e]));
  const openByCustomer = new Map<number, any[]>();
  for (const inv of invoices.rows) openByCustomer.set(inv.customer_id, [...(openByCustomer.get(inv.customer_id) ?? []), inv]);
  const cashAcct = cash.rows[0] ?? null;
  const claimed = new Set<number>();
  const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

  const sorted = [...lines].sort((a, b) => (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.id - b.id));
  for (const l of sorted) {
    const credit = Number(l.credit) > 0;
    const amount = credit ? Number(l.credit) : Number(l.debit);
    const direction = credit ? "in" : "out";

    // 1. The Cash Book already has it: same account, direction and amount, within 5 days.
    let best: any = null;
    for (const t of txns.rows) {
      if (claimed.has(t.id) || t.direction !== direction || Math.abs(t.amount - amount) > 0.005) continue;
      const dd = dayDiff(t.d, l.txn_date);
      if (dd <= 5 && (!best || dd < best.dd)) best = { ...t, dd };
    }
    if (best) {
      claimed.add(best.id);
      out.set(l.id, {
        kind: "existing", confidence: "high", accountTxnId: best.id,
        label: `Already in Cash Book — ${best.receipt_no ?? `#${best.id}`}${best.party_name ? ` · ${best.party_name}` : ""} (${best.d})`,
      });
      continue;
    }

    // 2. A party named in the narration — by mobile number, else by name.
    const narr = normText(l.description);
    const words = narr.split(" ");
    let party: any = null;
    const mobiles = [...new Set((l.description.match(/(?<!\d)(?:91)?([6-9]\d{9})(?!\d)/g) ?? []).map((m) => m.slice(-10)))];
    const byMob = mobiles.flatMap((m) => byMobile.get(m) ?? []);
    const preferType = credit ? "customer" : "vendor";
    if (byMob.length) {
      const pref = byMob.filter((e) => e.type === preferType);
      const pool = pref.length ? pref : byMob;
      if (pool.length === 1) party = pool[0];
    }
    if (!party) {
      let top = 0;
      let tops: any[] = [];
      for (const e of ents) {
        const s = nameScore(e.tokens, words) + (e.type === preferType ? 0.5 : 0);
        if (s <= 0.5) continue;
        if (s > top) { top = s; tops = [e]; } else if (s === top) tops.push(e);
      }
      if (tops.length === 1) party = tops[0];
    }
    if (party) {
      const settles = (credit && party.type === "customer") || (!credit && party.type === "vendor");
      const base = { kind: "party" as const, entityId: party.id, entityName: party.name, entityType: party.type };
      if (credit && party.type === "customer") {
        const exact = (openByCustomer.get(party.id) ?? []).filter((i) => Math.abs(i.due - amount) <= 0.5);
        if (exact.length) {
          out.set(l.id, { ...base, confidence: "high", invoiceId: exact[0].id, invoiceNo: exact[0].invoice_no, label: `${party.name} — bill ${exact[0].invoice_no} (${money(exact[0].due)} due)` });
        } else {
          out.set(l.id, { ...base, confidence: "high", label: `${party.name} — payment received (clears oldest bills first)` });
        }
      } else {
        out.set(l.id, {
          ...base, confidence: settles ? "high" : "medium",
          label: settles ? `${party.name} — payment to supplier` : credit ? `${party.name} — refund from supplier` : `${party.name} — refund to customer`,
        });
      }
      continue;
    }

    // 3. Bank's own lines: charges, interest, cash in/out.
    if (!credit && CHARGES_RE.test(narr)) {
      out.set(l.id, { kind: "expense", confidence: "medium", categoryName: "Bank Charges", label: "Expense — Bank Charges" });
      continue;
    }
    if (credit && INTEREST_RE.test(narr)) {
      out.set(l.id, { kind: "other", confidence: "medium", partyName: "Bank interest", label: "Bank interest received" });
      continue;
    }
    if (cashAcct && ((!credit && CASH_OUT_RE.test(narr)) || (credit && CASH_IN_RE.test(narr)))) {
      out.set(l.id, {
        kind: "transfer", confidence: "medium", otherAccountId: cashAcct.id,
        label: credit ? `Cash deposited from ${cashAcct.name}` : `Cash withdrawn to ${cashAcct.name}`,
      });
      continue;
    }

    // 4. Only the amount: one open bill (or one supplier bill) of exactly this amount.
    if (credit) {
      const hits = invoices.rows.filter((i: any) => Math.abs(i.due - amount) <= 0.005);
      if (hits.length === 1 && entById.get(hits[0].customer_id)) {
        const c = entById.get(hits[0].customer_id);
        out.set(l.id, {
          kind: "party", confidence: "medium", entityId: c.id, entityName: c.name, entityType: c.type,
          invoiceId: hits[0].id, invoiceNo: hits[0].invoice_no,
          label: `Amount matches bill ${hits[0].invoice_no} of ${c.name} (${money(hits[0].due)} due)`,
        });
      }
    } else {
      const vendors = [...new Set(purchases.rows.filter((p: any) => Math.abs(p.total - amount) <= 0.005).map((p: any) => p.vendor_id))];
      if (vendors.length === 1 && entById.get(vendors[0] as number)) {
        const v = entById.get(vendors[0] as number);
        const bill = purchases.rows.find((p: any) => p.vendor_id === v.id && Math.abs(p.total - amount) <= 0.005);
        out.set(l.id, {
          kind: "party", confidence: "medium", entityId: v.id, entityName: v.name, entityType: v.type,
          label: `Amount matches purchase bill ${bill.bill_no} of ${v.name}`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Confirming a line

export type ReconAction =
  | { kind: "existing"; accountTxnId: number }
  | { kind: "party"; entityId: number; invoiceId?: number | null }
  | { kind: "expense"; categoryId?: number | null; categoryName?: string | null; paidTo?: string | null }
  | { kind: "transfer"; otherAccountId: number }
  | { kind: "other"; partyName?: string | null; note?: string | null };

const MODE_BY_ACCOUNT: Record<string, string> = { bank: "bank_transfer", upi: "upi", cash: "cash" };
const EXPENSE_MODE_BY_ACCOUNT: Record<string, string> = { bank: "bank", upi: "upi", cash: "cash" };

// Inserts one Cash Book entry dated on the statement's day (noon IST) and
// moves the account's balance with it.
export async function addTxn(client: Q, p: {
  companyId: number; accountId: number; direction: "in" | "out"; amount: number; mode: string; date: string;
  partyName?: string | null; partyEntityId?: number | null; invoiceId?: number | null; notes?: string | null;
  user: ReconUser; receiptNo?: string | null;
}): Promise<{ id: number; receiptNo: string }> {
  const receiptNo = p.receiptNo === undefined ? await generateSeriesNumber(client, "payment_receipt", p.companyId) : p.receiptNo;
  const ins = await client.query(
    `INSERT INTO account_transactions
      (company_id, account_id, direction, amount, mode, party_name, party_entity_id, invoice_id, notes, receipt_no,
       created_by_id, created_by_name, created_by_role, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, ($14::date + time '12:00') AT TIME ZONE 'Asia/Kolkata')
     RETURNING id`,
    [p.companyId, p.accountId, p.direction, p.amount, p.mode, p.partyName ?? null, p.partyEntityId ?? null, p.invoiceId ?? null,
     p.notes ?? null, receiptNo, p.user.userId, p.user.name, p.user.role, p.date],
  );
  const id = ins.rows[0].id as number;
  await client.query(
    `UPDATE accounts SET current_balance = current_balance + $1 WHERE company_id = $2 AND id = $3`,
    [p.direction === "in" ? p.amount : -p.amount, p.companyId, p.accountId],
  );
  return { id, receiptNo: receiptNo ?? "" };
}

// Money in from / out to a customer or supplier, booked in the Cash Book on
// `date`: a customer receipt clears their bills (the one named first, else
// oldest first), a supplier payment their dues; money the other way (a
// supplier's refund, a refund to a customer) raises what they owe / we owe.
// Shared by the statement lines here and the Cheque Register.
export async function bookPartyMoney(client: Q, p: {
  companyId: number; accountId: number; accountType: string; entityId: number; credit: boolean; amount: number; date: string;
  user: ReconUser; invoiceId?: number | null; notes?: string | null; via?: string; mode?: string;
}): Promise<{ txnId: number; receiptNo: string; entityId: number; invoiceId: number | null; label: string }> {
  const { companyId, credit, amount, date } = p;
  const via = p.via ?? "bank statement";
  const e = (await client.query(
    `SELECT id, name, type FROM entities WHERE company_id = $1 AND id = $2 AND type IN ('customer', 'vendor')`,
    [companyId, p.entityId],
  )).rows[0];
  if (!e) throw new ReconError("Pick a customer or supplier");
  const isCustomerReceipt = credit && e.type === "customer";
  const isVendorPayout = !credit && e.type === "vendor";
  let invoiceId: number | null = null;
  if (p.invoiceId != null) {
    if (!isCustomerReceipt) throw new ReconError("A bill can only be picked for money received from a customer");
    const inv = (await client.query(
      `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND customer_id = $3 AND status <> 'cancelled' AND deleted_at IS NULL`,
      [p.invoiceId, companyId, e.id],
    )).rows[0];
    if (!inv) throw new ReconError("That bill is not this customer's");
    invoiceId = inv.id;
  }
  const mode = p.mode ?? MODE_BY_ACCOUNT[p.accountType] ?? "other";
  const txn = await addTxn(client, {
    companyId, accountId: p.accountId, direction: credit ? "in" : "out", amount, mode, date, user: p.user,
    partyName: e.name, partyEntityId: e.id, invoiceId, notes: p.notes ?? null,
  });
  let label: string;
  if (isCustomerReceipt || isVendorPayout) {
    const r = await applyEntityPayment(client, {
      companyId, entityId: e.id, amount, mode, receiptNo: txn.receiptNo, referenceId: txn.id, date,
      isCustomerReceipt, startInvoiceId: invoiceId, pinStartInvoice: invoiceId != null,
      description: isVendorPayout ? `Payment made (${via})` : `Payment received (${via})`,
    });
    const bills = r.allocations.map((a) => a.invoiceNo).join(", ");
    label = isCustomerReceipt
      ? `Received from ${e.name}${bills ? ` — ${bills}` : ""} · ${txn.receiptNo}`
      : `Paid to ${e.name} · ${txn.receiptNo}`;
  } else {
    const bal = (await client.query(
      `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3 RETURNING outstanding_balance`,
      [amount, e.id, companyId],
    )).rows[0];
    await client.query(
      `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
       VALUES ($1, $2, $3::date::timestamptz, $4, $5, 0, $6, 'adjustment', $7, $8)`,
      [companyId, e.id, date, credit ? `Refund received (${via})` : `Refund paid (${via})`, amount, Number(bal.outstanding_balance), txn.id, txn.receiptNo],
    );
    label = credit ? `Refund from ${e.name} · ${txn.receiptNo}` : `Refund to ${e.name} · ${txn.receiptNo}`;
  }
  return { txnId: txn.id, receiptNo: txn.receiptNo, entityId: e.id, invoiceId, label };
}

// Takes back what bookPartyMoney did: the bill allocations, the Cash Book
// entry and the account balance, with a reversing line in the party's ledger
// so their account history stays complete.
export async function reversePartyMoney(client: Q, companyId: number, p: {
  entityId: number | null; credit: boolean; txnId: number | null; receiptNo: string | null; amount: number; what?: string;
}): Promise<void> {
  const e = p.entityId ? (await client.query(`SELECT id, type FROM entities WHERE company_id = $1 AND id = $2`, [companyId, p.entityId])).rows[0] : null;
  const t = p.txnId ? (await client.query(`SELECT amount::float AS amount FROM account_transactions WHERE company_id = $1 AND id = $2`, [companyId, p.txnId])).rows[0] : null;
  const amount = round2(t?.amount ?? p.amount);
  if (e) {
    const settled = (p.credit && e.type === "customer") || (!p.credit && e.type === "vendor");
    if (settled && p.receiptNo) {
      const allocs = (await client.query(
        `DELETE FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2 RETURNING invoice_id, allocated_amount::float AS amt`,
        [companyId, p.receiptNo],
      )).rows;
      for (const a of allocs) {
        await client.query(
          `UPDATE invoices SET amount_paid = amount_paid - $1, balance_due = balance_due + $1 WHERE company_id = $2 AND id = $3`,
          [a.amt, companyId, a.invoice_id],
        );
      }
    }
    const bal = (await client.query(
      `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3 RETURNING outstanding_balance`,
      [settled ? amount : -amount, e.id, companyId],
    )).rows[0];
    await client.query(
      `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, 'adjustment', $7, $8)`,
      [companyId, e.id, `${p.what ?? "Bank statement link undone"} (${p.receiptNo ?? ""})`, settled ? amount : 0, settled ? 0 : amount,
       Number(bal.outstanding_balance), p.txnId, p.receiptNo],
    );
  }
  await dropTxn(client, companyId, p.txnId);
}

async function lockPendingLine(client: Q, companyId: number, lineId: number) {
  const line = (await client.query(
    `SELECT l.*, l.txn_date::text AS day, a.name AS account_name, a.type AS account_type
       FROM bank_statement_lines l JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = $1 AND l.id = $2 FOR UPDATE OF l`,
    [companyId, lineId],
  )).rows[0];
  if (!line) throw new ReconError("Statement line not found");
  return line;
}

const narrationNote = (line: any) => `Bank statement ${line.day}: ${String(line.description || "").slice(0, 200)}`;

export async function confirmLine(client: Q, companyId: number, user: ReconUser, lineId: number, action: ReconAction): Promise<{ label: string }> {
  const line = await lockPendingLine(client, companyId, lineId);
  if (line.status !== "pending") throw new ReconError("This line is already done — refresh the page");
  const credit = Number(line.credit) > 0;
  const amount = round2(credit ? Number(line.credit) : Number(line.debit));
  const direction: "in" | "out" = credit ? "in" : "out";
  const mode = MODE_BY_ACCOUNT[line.account_type] ?? "other";
  const date = line.day as string;
  const done = async (fields: Record<string, any>, label: string) => {
    const cols = Object.keys(fields);
    await client.query(
      `UPDATE bank_statement_lines SET status = 'matched', matched_label = $3, matched_by_name = $4, matched_at = NOW(),
              ${cols.map((c, i) => `${c} = $${i + 5}`).join(", ")}
        WHERE company_id = $1 AND id = $2`,
      [companyId, lineId, label, user.name, ...cols.map((c) => fields[c])],
    );
    return { label };
  };

  switch (action?.kind) {
    case "existing": {
      const t = (await client.query(
        `SELECT t.id, t.direction, t.amount::float AS amount, t.receipt_no, t.party_name, t.party_entity_id, t.invoice_id
           FROM account_transactions t
          WHERE t.company_id = $1 AND t.id = $2 AND t.account_id = $3 FOR UPDATE`,
        [companyId, action.accountTxnId, line.account_id],
      )).rows[0];
      if (!t) throw new ReconError("That Cash Book entry is not on this account");
      if (t.direction !== direction || Math.abs(t.amount - amount) > 0.005) throw new ReconError("That Cash Book entry has a different amount or direction");
      const used = await client.query(
        `SELECT 1 FROM bank_statement_lines WHERE company_id = $1 AND (account_txn_id = $2 OR other_txn_id = $2) AND id <> $3`,
        [companyId, t.id, lineId],
      );
      if (used.rows.length) throw new ReconError("That Cash Book entry is already matched to another statement line");
      return done(
        { matched_kind: "existing", account_txn_id: t.id, receipt_no: t.receipt_no, entity_id: t.party_entity_id, invoice_id: t.invoice_id },
        `Matched with Cash Book ${t.receipt_no ?? `#${t.id}`}${t.party_name ? ` · ${t.party_name}` : ""}`,
      );
    }

    case "party": {
      const r = await bookPartyMoney(client, {
        companyId, accountId: line.account_id, accountType: line.account_type, entityId: action.entityId, credit, amount, date, user,
        invoiceId: action.invoiceId ?? null, notes: narrationNote(line),
      });
      return done({ matched_kind: "party", account_txn_id: r.txnId, receipt_no: r.receiptNo, entity_id: r.entityId, invoice_id: r.invoiceId }, r.label);
    }

    case "expense": {
      if (credit) throw new ReconError("Money received can't be an expense — link it to a customer or as other income");
      let cat: any = null;
      if (action.categoryId) {
        cat = (await client.query(`SELECT id, name FROM expense_categories WHERE company_id = $1 AND id = $2`, [companyId, action.categoryId])).rows[0];
      } else if (action.categoryName?.trim()) {
        const name = action.categoryName.trim().slice(0, 60);
        cat = (await client.query(`SELECT id, name FROM expense_categories WHERE company_id = $1 AND lower(name) = lower($2)`, [companyId, name])).rows[0]
          ?? (await client.query(`INSERT INTO expense_categories (company_id, name) VALUES ($1, $2) RETURNING id, name`, [companyId, name])).rows[0];
      }
      if (!cat) throw new ReconError("Pick an expense category");
      const paidTo = cleanText(action.paidTo, 120) || cleanText(line.description, 60) || null;
      const exp = (await client.query(
        `INSERT INTO expenses (company_id, date, category_id, category_name, amount, payment_mode, account_id, paid_to, notes, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [companyId, date, cat.id, cat.name, String(amount), EXPENSE_MODE_BY_ACCOUNT[line.account_type] ?? "bank", line.account_id, paidTo,
         narrationNote(line), user.userId],
      )).rows[0];
      const txn = await addTxn(client, {
        companyId, accountId: line.account_id, direction: "out", amount, mode, date, user, partyName: paidTo, notes: `Expense: ${cat.name}`,
      });
      return done({ matched_kind: "expense", account_txn_id: txn.id, receipt_no: txn.receiptNo, expense_id: exp.id }, `Expense — ${cat.name} · ${txn.receiptNo}`);
    }

    case "transfer": {
      const other = (await client.query(
        `SELECT id, name, type FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true`,
        [companyId, action.otherAccountId],
      )).rows[0];
      if (!other || other.id === line.account_id) throw new ReconError("Pick the other account of this transfer");
      // Same shape as POST /accounts/transfer: a TRF-OUT / TRF-IN pair.
      const fromId = credit ? other.id : line.account_id;
      const toId = credit ? line.account_id : other.id;
      const fromName = credit ? other.name : line.account_name;
      const toName = credit ? line.account_name : other.name;
      const outT = await addTxn(client, {
        companyId, accountId: fromId, direction: "out", amount, mode: "bank_transfer", date, user, receiptNo: null,
        partyName: toName, notes: `Transfer to ${toName} (bank statement)`,
      });
      await client.query(`UPDATE account_transactions SET receipt_no = $1 WHERE id = $2`, [`TRF-OUT-${outT.id}`, outT.id]);
      const inT = await addTxn(client, {
        companyId, accountId: toId, direction: "in", amount, mode: "bank_transfer", date, user, receiptNo: null,
        partyName: fromName, notes: `Transfer from ${fromName} (bank statement)`,
      });
      await client.query(`UPDATE account_transactions SET receipt_no = $1 WHERE id = $2`, [`TRF-IN-${inT.id}`, inT.id]);
      const mine = credit ? inT : outT;
      const theirs = credit ? outT : inT;
      return done(
        { matched_kind: "transfer", account_txn_id: mine.id, other_txn_id: theirs.id, receipt_no: credit ? `TRF-IN-${inT.id}` : `TRF-OUT-${outT.id}` },
        credit ? `Transfer from ${other.name}` : `Transfer to ${other.name}`,
      );
    }

    case "other": {
      const partyName = cleanText(action.partyName, 120) || null;
      const note = cleanText(action.note, 300);
      const txn = await addTxn(client, {
        companyId, accountId: line.account_id, direction, amount, mode, date, user, partyName,
        notes: note ? `${note} — ${narrationNote(line)}` : narrationNote(line),
      });
      return done(
        { matched_kind: "other", account_txn_id: txn.id, receipt_no: txn.receiptNo },
        `${credit ? "Received" : "Paid"}${partyName ? ` — ${partyName}` : ""}${note ? ` (${note})` : ""} · ${txn.receiptNo}`,
      );
    }

    default:
      throw new ReconError("Choose how to link this line");
  }
}

export async function ignoreLine(client: Q, companyId: number, user: ReconUser, lineId: number): Promise<void> {
  const line = await lockPendingLine(client, companyId, lineId);
  if (line.status !== "pending") throw new ReconError("Only an open line can be ignored");
  await client.query(
    `UPDATE bank_statement_lines SET status = 'ignored', matched_label = 'Ignored', matched_by_name = $3, matched_at = NOW()
      WHERE company_id = $1 AND id = $2`,
    [companyId, lineId, user.name],
  );
}

export async function dropTxn(client: Q, companyId: number, txnId: number | null): Promise<void> {
  if (!txnId) return;
  const t = (await client.query(
    `DELETE FROM account_transactions WHERE company_id = $1 AND id = $2 RETURNING account_id, direction, amount::float AS amount`,
    [companyId, txnId],
  )).rows[0];
  if (!t) return;
  await client.query(
    `UPDATE accounts SET current_balance = current_balance - $1 WHERE company_id = $2 AND id = $3`,
    [t.direction === "in" ? t.amount : -t.amount, companyId, t.account_id],
  );
}

// Puts a line back in the open list, removing what confirming it booked:
// the Cash Book entry (and the account balance it moved), the expense, the
// transfer pair, or — for a party — the bill allocations, with a reversing
// line in the party's ledger so their account history stays complete.
export async function undoLine(client: Q, companyId: number, user: ReconUser, lineId: number): Promise<void> {
  const line = await lockPendingLine(client, companyId, lineId);
  if (line.status === "pending") throw new ReconError("This line is still open");
  if (line.status === "matched") {
    const credit = Number(line.credit) > 0;
    switch (line.matched_kind) {
      case "existing":
        break;
      case "party":
        await reversePartyMoney(client, companyId, {
          entityId: line.entity_id, credit, txnId: line.account_txn_id, receiptNo: line.receipt_no,
          amount: credit ? Number(line.credit) : Number(line.debit),
        });
        break;
      case "expense":
        if (line.expense_id) await client.query(`DELETE FROM expenses WHERE company_id = $1 AND id = $2`, [companyId, line.expense_id]);
        await dropTxn(client, companyId, line.account_txn_id);
        break;
      case "transfer":
        await dropTxn(client, companyId, line.account_txn_id);
        await dropTxn(client, companyId, line.other_txn_id);
        break;
      default:
        await dropTxn(client, companyId, line.account_txn_id);
    }
  }
  await client.query(
    `UPDATE bank_statement_lines
        SET status = 'pending', matched_kind = NULL, account_txn_id = NULL, other_txn_id = NULL, entity_id = NULL,
            invoice_id = NULL, expense_id = NULL, receipt_no = NULL, matched_label = NULL, matched_by_name = $3, matched_at = NULL
      WHERE company_id = $1 AND id = $2`,
    [companyId, lineId, user.name],
  );
}
