// Tally XML in and out for Books & Audit.
//
// Export: the GST books of a period (GST sales and purchases and the credit /
// debit notes against them, the GST share of Cash Book receipts / payments,
// contra, Journals — see lib/books.ts and lib/gst-books.ts) as balanced Tally
// vouchers, plus the ledger masters they use with opening balances as on the
// first day — one file the CA imports with Tally's "Import Data". Nothing of
// the non-GST bills goes in.
//
// Import: from a Tally export, the ledgers the ERP doesn't keep elsewhere
// (capital, loans, fixed assets, indirect income / expenses…) and the
// Journal vouchers between them. Parties, Cash / Bank, Sales, Purchase and
// GST ledgers are skipped — the ERP builds those from its own bills.
//
// Tally signs amounts negative for Debit, positive for Credit.
import { pool } from "@workspace/db";
import { LEDGER_GROUPS, type LedgerGroup } from "./books";
import { gstCash, gstCustomerDues } from "./gst-books";

const IST = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
// As text: node-postgres turns a date into local midnight, which shifts a day
// on a server that isn't on UTC.
const DAY = (col: string) => `${IST(col)}::text`;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

// ── Export ────────────────────────────────────────────────────────────

const TALLY_GROUP: Record<LedgerGroup, string> = {
  capital: "Capital Account",
  loans: "Loans (Liability)",
  current_liabilities: "Current Liabilities",
  fixed_assets: "Fixed Assets",
  investments: "Investments",
  current_assets: "Current Assets",
  indirect_income: "Indirect Incomes",
  indirect_expense: "Indirect Expenses",
};

const CASH_CUSTOMER = "Cash Customer";
const SUSPENSE = "Suspense";

interface Entry { ledger: string; amount: number }   // signed: + Dr, − Cr
interface TallyVoucher { type: string; date: string; no: string | null; party: string | null; narration: string | null; entries: Entry[] }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tallyDate = (d: string) => d.replace(/-/g, "");
const tallyAmount = (signed: number) => (-signed).toFixed(2);   // Tally: Dr negative
const dayOf = (v: unknown) => String(v).slice(0, 10);

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// GST split into Tally's usual CGST / SGST / IGST ledgers; whatever the
// split doesn't cover (returns keep only the total) goes to one GST ledger.
function taxEntries(side: "Output" | "Input", sign: 1 | -1, row: { cgst?: unknown; sgst?: unknown; igst?: unknown; total_tax: unknown }): Entry[] {
  const parts = [["CGST", n(row.cgst)], ["SGST", n(row.sgst)], ["IGST", n(row.igst)]] as const;
  const out: Entry[] = parts.filter(([, v]) => v !== 0).map(([k, v]) => ({ ledger: `${side} ${k}`, amount: r2(sign * v) }));
  const rest = r2(n(row.total_tax) - parts.reduce((s, [, v]) => s + v, 0));
  if (Math.abs(rest) >= 0.005) out.push({ ledger: `${side} GST`, amount: r2(sign * rest) });
  return out;
}

export async function tallyExport(companyId: number, from: string, to: string): Promise<{ xml: string; vouchers: number; ledgers: number }> {
  const ps = [companyId, from, to];
  const before = dayBefore(from);
  const [company, sales, purchases, cnotes, dnotes, txns, journals, parties, bookLedgers, cashNow, cashBefore, custBefore] = await Promise.all([
    pool.query(`SELECT name FROM companies WHERE id = $1`, [companyId]),
    pool.query(
      `SELECT ${DAY("i.invoice_date")} AS day, i.invoice_no, COALESCE(NULLIF(i.customer_name, ''), e.name) AS customer_name,
              i.grand_total, i.total_tax, i.cgst, i.sgst, i.igst
       FROM invoices i LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
       WHERE i.company_id = $1 AND i.status = 'saved' AND i.deleted_at IS NULL AND i.invoice_type = 'gst'
         AND ${IST("i.invoice_date")} BETWEEN $2::date AND $3::date ORDER BY i.invoice_date, i.id`, ps),
    pool.query(
      `SELECT ${DAY("p.bill_date")} AS day, p.bill_no, p.vendor_bill_no, COALESCE(NULLIF(p.vendor_name, ''), e.name) AS vendor_name,
              p.grand_total, p.total_tax, p.cgst, p.sgst, p.igst
       FROM purchases p LEFT JOIN entities e ON e.id = p.vendor_id AND e.company_id = p.company_id
       WHERE p.company_id = $1 AND p.status = 'saved' AND p.deleted_at IS NULL AND p.bill_type = 'gst'
         AND ${IST("p.bill_date")} BETWEEN $2::date AND $3::date ORDER BY p.bill_date, p.id`, ps),
    pool.query(
      `SELECT ${DAY("r.return_date")} AS day, r.return_no, r.invoice_no, COALESCE(NULLIF(r.customer_name, ''), e.name) AS customer_name,
              r.grand_total, r.total_tax, r.reason
       FROM sales_returns r
       JOIN invoices gi ON gi.id = r.invoice_id AND gi.invoice_type = 'gst'
       LEFT JOIN entities e ON e.id = r.customer_id AND e.company_id = r.company_id
       WHERE r.company_id = $1 AND r.status = 'saved'
         AND ${IST("r.return_date")} BETWEEN $2::date AND $3::date ORDER BY r.return_date, r.id`, ps),
    pool.query(
      `SELECT ${DAY("r.return_date")} AS day, r.return_no, r.bill_no, COALESCE(NULLIF(r.vendor_name, ''), e.name) AS vendor_name,
              r.grand_total, r.total_tax, r.reason
       FROM purchase_returns r
       JOIN purchases gp ON gp.id = r.purchase_id AND gp.bill_type = 'gst'
       LEFT JOIN entities e ON e.id = r.vendor_id AND e.company_id = r.company_id
       WHERE r.company_id = $1 AND r.status = 'saved'
         AND ${IST("r.return_date")} BETWEEN $2::date AND $3::date ORDER BY r.return_date, r.id`, ps),
    // Transfers write an out and an in row; the out row carries both sides.
    pool.query(
      `SELECT t.id, ${DAY("t.created_at")} AS day, t.receipt_no, t.direction, t.amount, t.notes, t.party_name, a.name AS account,
              e.name AS entity_name, e.type AS entity_type
       FROM account_transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN entities e ON e.id = t.party_entity_id AND e.company_id = t.company_id
       WHERE t.company_id = $1 AND COALESCE(t.receipt_no, '') NOT LIKE 'TRF-IN-%'
         AND ${IST("t.created_at")} BETWEEN $2::date AND $3::date ORDER BY t.created_at, t.id`, ps),
    pool.query(
      `SELECT jv.voucher_date::text AS day, jv.voucher_no, jv.narration,
              json_agg(json_build_object('ledger', l.name, 'debit', jl.debit, 'credit', jl.credit) ORDER BY jl.id) AS lines
       FROM journal_vouchers jv
       JOIN journal_voucher_lines jl ON jl.voucher_id = jv.id
       JOIN book_ledgers l ON l.id = jl.ledger_id
       WHERE jv.company_id = $1 AND jv.status = 'saved' AND jv.voucher_date BETWEEN $2::date AND $3::date
       GROUP BY jv.id ORDER BY jv.voucher_date, jv.id`, ps),
    pool.query(`SELECT id, name, type FROM entities WHERE company_id = $1 AND type IN ('customer', 'vendor')`, [companyId]),
    pool.query(
      `SELECT l.name, l.group_code, l.opening_balance,
              COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE jv.id IS NOT NULL), 0) AS movement
       FROM book_ledgers l
       LEFT JOIN journal_voucher_lines jl ON jl.ledger_id = l.id AND jl.company_id = l.company_id
       LEFT JOIN journal_vouchers jv ON jv.id = jl.voucher_id AND jv.status = 'saved' AND jv.voucher_date <= $2::date
       WHERE l.company_id = $1 GROUP BY l.id`, [companyId, before]),
    // GST share of each Cash Book entry, and GST balances / dues as on the day before `from`.
    gstCash(companyId, to),
    gstCash(companyId, before),
    gstCustomerDues(companyId, before),
  ]);

  // Ledger masters: name → { parent, signed opening }. The first type that
  // claims a name keeps it.
  const masters = new Map<string, { parent: string; opening: number }>();
  const master = (name: string, parent: string, opening = 0) => {
    if (!masters.has(name)) masters.set(name, { parent, opening: r2(opening) });
  };
  for (const l of bookLedgers.rows) {
    const g = l.group_code as LedgerGroup;
    if (!(g in LEDGER_GROUPS)) continue;
    const opening = LEDGER_GROUPS[g].statement === "bs"
      ? (LEDGER_GROUPS[g].nature === "dr" ? n(l.opening_balance) : -n(l.opening_balance)) + n(l.movement)
      : 0;
    master(l.name, TALLY_GROUP[g], opening);
  }
  for (const a of cashBefore.accounts) master(a.name, a.type === "cash" ? "Cash-in-Hand" : "Bank Accounts", a.balance);
  // Only parties with GST dues or GST vouchers are listed: a customer's dues
  // are a Debit, a supplier's a Credit.
  for (const p of parties.rows) {
    const opening = p.type === "customer" ? custBefore.get(p.id) ?? 0 : -(cashBefore.vendorDue.get(p.id) ?? 0);
    if (opening) master(p.name, p.type === "customer" ? "Sundry Debtors" : "Sundry Creditors", opening);
  }

  master(SUSPENSE, "Suspense A/c");
  const vouchers: TallyVoucher[] = [];
  const party =(name: unknown, fallback: string, parent: string) => {
    const s = String(name ?? "").trim() || fallback;
    master(s, parent);
    return s;
  };

  for (const s of sales.rows) {
    const p = party(s.customer_name, CASH_CUSTOMER, "Sundry Debtors");
    vouchers.push({
      type: "Sales", date: dayOf(s.day), no: s.invoice_no, party: p, narration: null,
      entries: [{ ledger: p, amount: n(s.grand_total) }, { ledger: "Sales", amount: -r2(n(s.grand_total) - n(s.total_tax)) }, ...taxEntries("Output", -1, s)],
    });
  }
  for (const b of purchases.rows) {
    const p = party(b.vendor_name, SUSPENSE, "Sundry Creditors");
    vouchers.push({
      type: "Purchase", date: dayOf(b.day), no: b.vendor_bill_no || b.bill_no, party: p, narration: b.vendor_bill_no ? `ERP bill ${b.bill_no}` : null,
      entries: [{ ledger: "Purchase", amount: r2(n(b.grand_total) - n(b.total_tax)) }, ...taxEntries("Input", 1, b), { ledger: p, amount: -n(b.grand_total) }],
    });
  }
  for (const c of cnotes.rows) {
    const p = party(c.customer_name, CASH_CUSTOMER, "Sundry Debtors");
    vouchers.push({
      type: "Credit Note", date: dayOf(c.day), no: c.return_no, party: p, narration: [`Against invoice ${c.invoice_no}`, c.reason].filter(Boolean).join(" · "),
      entries: [{ ledger: "Sales", amount: r2(n(c.grand_total) - n(c.total_tax)) }, ...taxEntries("Output", 1, c), { ledger: p, amount: -n(c.grand_total) }],
    });
  }
  for (const d of dnotes.rows) {
    const p = party(d.vendor_name, SUSPENSE, "Sundry Creditors");
    vouchers.push({
      type: "Debit Note", date: dayOf(d.day), no: d.return_no, party: p, narration: [`Against bill ${d.bill_no}`, d.reason].filter(Boolean).join(" · "),
      entries: [{ ledger: p, amount: n(d.grand_total) }, { ledger: "Purchase", amount: -r2(n(d.grand_total) - n(d.total_tax)) }, ...taxEntries("Input", -1, d)],
    });
  }
  for (const t of txns.rows) {
    const amount = cashNow.share.get(t.id) ?? 0;
    if (amount <= 0) continue;
    const notes = String(t.notes ?? "");
    if (String(t.receipt_no ?? "").startsWith("TRF-OUT-")) {
      // party_name on a transfer is the other account.
      const toAccount = party(t.party_name, SUSPENSE, "Bank Accounts");
      vouchers.push({ type: "Contra", date: dayOf(t.day), no: t.receipt_no, party: null, narration: notes || null,
        entries: [{ ledger: toAccount, amount }, { ledger: t.account, amount: -amount }] });
      continue;
    }
    // Expenses write "Expense: <category>" into the Cash Book entry.
    const expense = t.direction === "out" && notes.startsWith("Expense: ") ? notes.slice(9).trim() : "";
    const isIn = t.direction === "in";
    const other: string = expense ? party(expense, SUSPENSE, "Indirect Expenses")
      : t.entity_name ? party(t.entity_name, SUSPENSE, t.entity_type === "vendor" ? "Sundry Creditors" : "Sundry Debtors")
      : party(t.party_name, SUSPENSE, isIn ? "Sundry Debtors" : "Sundry Creditors");
    vouchers.push({
      type: isIn ? "Receipt" : "Payment", date: dayOf(t.day), no: t.receipt_no, party: other,
      narration: [t.party_name && t.party_name !== other ? t.party_name : null, notes || null].filter(Boolean).join(" · ") || null,
      entries: isIn
        ? [{ ledger: t.account, amount }, { ledger: other, amount: -amount }]
        : [{ ledger: other, amount }, { ledger: t.account, amount: -amount }],
    });
  }
  for (const j of journals.rows) {
    vouchers.push({ type: "Journal", date: dayOf(j.day), no: j.voucher_no, party: null, narration: j.narration,
      entries: j.lines.map((l: any) => ({ ledger: l.ledger, amount: r2(n(l.debit) - n(l.credit)) })) });
  }
  vouchers.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  master("Sales", "Sales Accounts");
  master("Purchase", "Purchase Accounts");
  for (const v of vouchers) for (const e of v.entries) {
    if (/^(Output|Input) (CGST|SGST|IGST|GST)$/.test(e.ledger)) master(e.ledger, "Duties & Taxes");
    else master(e.ledger, "Sundry Debtors");
  }

  const msgs: string[] = [];
  for (const [name, m] of [...masters].sort(([a], [b]) => a.localeCompare(b))) {
    msgs.push(
      `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create">` +
      `<NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(m.parent)}</PARENT>` +
      (m.parent === "Sundry Debtors" || m.parent === "Sundry Creditors" ? `<ISBILLWISEON>No</ISBILLWISEON>` : "") +
      `<OPENINGBALANCE>${tallyAmount(m.opening)}</OPENINGBALANCE></LEDGER></TALLYMESSAGE>`,
    );
  }
  for (const v of vouchers) {
    const entries = v.entries.filter((e) => Math.abs(e.amount) >= 0.005).map((e) =>
      `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(e.ledger)}</LEDGERNAME>` +
      `<ISDEEMEDPOSITIVE>${e.amount > 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE>` +
      `<ISPARTYLEDGER>${e.ledger === v.party ? "Yes" : "No"}</ISPARTYLEDGER>` +
      `<AMOUNT>${tallyAmount(e.amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join("");
    msgs.push(
      `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(v.type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
      `<DATE>${tallyDate(v.date)}</DATE><EFFECTIVEDATE>${tallyDate(v.date)}</EFFECTIVEDATE>` +
      `<VOUCHERTYPENAME>${esc(v.type)}</VOUCHERTYPENAME>` +
      (v.no ? `<VOUCHERNUMBER>${esc(v.no)}</VOUCHERNUMBER><REFERENCE>${esc(v.no)}</REFERENCE>` : "") +
      (v.party ? `<PARTYLEDGERNAME>${esc(v.party)}</PARTYLEDGERNAME>` : "") +
      (v.narration ? `<NARRATION>${esc(v.narration)}</NARRATION>` : "") +
      `<PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${entries}</VOUCHER></TALLYMESSAGE>`,
    );
  }

  const companyName = company.rows[0]?.name ?? "";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>` +
    `<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>` +
    `<REQUESTDATA>\n${msgs.join("\n")}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
  return { xml, vouchers: vouchers.length, ledgers: masters.size };
}

// ── Import ────────────────────────────────────────────────────────────

// Tally's primary groups → the Books ledger group, or why it is skipped.
const PRIMARY: Record<string, LedgerGroup | { skip: string }> = {
  "capital account": "capital",
  "reserves & surplus": "capital",
  "loans (liability)": "loans",
  "secured loans": "loans",
  "unsecured loans": "loans",
  "bank od a/c": "loans",
  "current liabilities": "current_liabilities",
  "provisions": "current_liabilities",
  "fixed assets": "fixed_assets",
  "investments": "investments",
  "current assets": "current_assets",
  "loans & advances (asset)": "current_assets",
  "deposits (asset)": "current_assets",
  "indirect incomes": "indirect_income",
  "direct incomes": "indirect_income",
  "indirect expenses": "indirect_expense",
  "direct expenses": "indirect_expense",
  "sundry debtors": { skip: "Customer — kept in Customers" },
  "sundry creditors": { skip: "Supplier — kept in Suppliers" },
  "cash-in-hand": { skip: "Cash — add it in Accounts" },
  "bank accounts": { skip: "Bank — add it in Accounts" },
  "sales accounts": { skip: "Sales come from invoices" },
  "purchase accounts": { skip: "Purchases come from purchase bills" },
  "duties & taxes": { skip: "GST is worked out from bills" },
  "stock-in-hand": { skip: "Stock comes from Inventory" },
  "suspense a/c": { skip: "Suspense ledger" },
  "branch / divisions": { skip: "Branch ledger" },
  "misc. expenses (asset)": { skip: "Not used in Books" },
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unescape(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, k) => ENTITIES[k])
    // Tally writes control characters such as &#4; before "Primary".
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
}
const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name.replace(/\./g, "\\.")}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(/\./g, "\\.")}>`, "i"));
  return m ? unescape(m[1]) : "";
};
const attr = (open: string, name: string) => {
  const m = open.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return m ? unescape(m[1]) : "";
};
function blocks(xml: string, name: string): { open: string; body: string }[] {
  const re = new RegExp(`(<${name.replace(/\./g, "\\.")}(?:\\s[^>]*)?>)([\\s\\S]*?)</${name.replace(/\./g, "\\.")}>`, "gi");
  return [...xml.matchAll(re)].map((m) => ({ open: m[1], body: m[2] }));
}
// "1,234.50", "-5000", "₹ 50.00 Dr" → signed number with Tally's sign (Dr negative).
function amountOf(s: string): number {
  const dr = /\bDr\b/i.test(s), cr = /\bCr\b/i.test(s);
  const v = Number(s.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(v)) return 0;
  return dr ? -Math.abs(v) : cr ? Math.abs(v) : v;
}

export interface ImportLedger { name: string; group: LedgerGroup; openingBalance: number; warning?: string }
export interface ImportJournal { date: string; no: string; narration: string; lines: { ledger: string; debit: number; credit: number }[] }
export interface ParsedTally {
  ledgers: ImportLedger[];
  skippedLedgers: { name: string; reason: string }[];
  journals: ImportJournal[];
  skippedVouchers: { type: string; count: number }[];
}

export function parseTally(xml: string): ParsedTally {
  const groupParent = new Map<string, string>();
  for (const g of blocks(xml, "GROUP")) {
    const name = attr(g.open, "NAME") || tag(g.body, "NAME");
    if (name) groupParent.set(name.toLowerCase(), tag(g.body, "PARENT").toLowerCase());
  }
  // Walk a user-made sub-group up to Tally's primary group.
  const primaryOf = (parent: string): string => {
    let cur = parent.toLowerCase();
    for (let i = 0; i < 25 && !(cur in PRIMARY) && groupParent.get(cur); i++) cur = groupParent.get(cur)!;
    return cur;
  };

  const ledgers: ImportLedger[] = [];
  const skippedLedgers: { name: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const l of blocks(xml, "LEDGER")) {
    const name = (attr(l.open, "NAME") || tag(l.body, "NAME")).slice(0, 100);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const parent = tag(l.body, "PARENT");
    const map = PRIMARY[primaryOf(parent)];
    if (!map) { skippedLedgers.push({ name, reason: parent ? `Group "${parent}" not known` : "No group" }); continue; }
    if (typeof map === "object") { skippedLedgers.push({ name, reason: map.skip }); continue; }
    const g = LEDGER_GROUPS[map];
    const signed = -amountOf(tag(l.body, "OPENINGBALANCE"));   // + Dr
    let openingBalance = 0;
    let warning: string | undefined;
    if (g.statement === "bs" && Math.abs(signed) >= 0.005) {
      if ((signed > 0) === (g.nature === "dr")) openingBalance = r2(Math.abs(signed));
      else warning = `Opening ₹${r2(Math.abs(signed))} ${signed > 0 ? "Dr" : "Cr"} is on the other side — post a Journal for it`;
    }
    ledgers.push({ name, group: map, openingBalance, ...(warning ? { warning } : {}) });
  }

  const journals: ImportJournal[] = [];
  const skipped = new Map<string, number>();
  for (const v of blocks(xml, "VOUCHER")) {
    const type = tag(v.body, "VOUCHERTYPENAME") || attr(v.open, "VCHTYPE") || "Voucher";
    if (attr(v.open, "ACTION").toLowerCase() === "delete" || tag(v.body, "ISCANCELLED").toLowerCase() === "yes" || !/journal/i.test(type)) {
      skipped.set(type, (skipped.get(type) ?? 0) + 1);
      continue;
    }
    const d = tag(v.body, "DATE");
    const date = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
    const lines = [...blocks(v.body, "ALLLEDGERENTRIES.LIST"), ...blocks(v.body, "LEDGERENTRIES.LIST")]
      .map((e) => ({ ledger: tag(e.body, "LEDGERNAME"), signed: -amountOf(tag(e.body, "AMOUNT")) }))
      .filter((e) => e.ledger && Math.abs(e.signed) >= 0.005)
      .map((e) => ({ ledger: e.ledger, debit: e.signed > 0 ? r2(e.signed) : 0, credit: e.signed < 0 ? r2(-e.signed) : 0 }));
    journals.push({ date, no: tag(v.body, "VOUCHERNUMBER"), narration: tag(v.body, "NARRATION").slice(0, 400), lines });
  }
  return { ledgers, skippedLedgers, journals, skippedVouchers: [...skipped].map(([type, count]) => ({ type, count })) };
}

// Imported Journals carry this tag so importing the same file twice doesn't
// post them twice.
export const tallyTag = (j: ImportJournal) => `[Tally ${j.no ? `#${j.no}` : "import"}]`;
