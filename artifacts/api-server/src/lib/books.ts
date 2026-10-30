// Books & Audit — Trial Balance, Profit & Loss and Balance Sheet built from
// the data the ERP already records (GST invoices and purchase bills and their
// returns, expenses, Cash Book accounts, supplier ledgers) plus the business's
// own ledgers and Journal vouchers (book_ledgers / journal_vouchers, see
// bootstrap.ts). Non-GST bills are left out — see GST_SALE below.
//
// The rest of the ERP is not double-entry: a cash bill with no customer, a
// Cash Book entry with no party, the owner's starting capital… have no other
// side. So, like Tally's "Difference in opening balances", each statement
// shows whatever is left over as one "Difference" line instead of hiding it.
// Posting a Journal (e.g. Capital Account) shrinks it.
//
// Amounts are signed: positive = Debit, negative = Credit. Dates are IST
// calendar days ("YYYY-MM-DD").
import { pool } from "@workspace/db";
import { gstCash } from "./gst-books";

export const LEDGER_GROUPS = {
  capital: { label: "Capital Account", nature: "cr", statement: "bs" },
  loans: { label: "Loans (Liability)", nature: "cr", statement: "bs" },
  current_liabilities: { label: "Current Liabilities", nature: "cr", statement: "bs" },
  fixed_assets: { label: "Fixed Assets", nature: "dr", statement: "bs" },
  investments: { label: "Investments", nature: "dr", statement: "bs" },
  current_assets: { label: "Current Assets", nature: "dr", statement: "bs" },
  indirect_income: { label: "Indirect Income", nature: "cr", statement: "pl" },
  indirect_expense: { label: "Indirect Expenses", nature: "dr", statement: "pl" },
} as const;
export type LedgerGroup = keyof typeof LEDGER_GROUPS;
export const isLedgerGroup = (g: unknown): g is LedgerGroup => typeof g === "string" && g in LEDGER_GROUPS;

// Opening balances only make sense for Balance Sheet ledgers; it is entered
// as a plain amount on the group's natural side.
export function signedOpening(group: LedgerGroup, amount: number): number {
  const g = LEDGER_GROUPS[group];
  if (g.statement !== "bs") return 0;
  return g.nature === "dr" ? amount : -amount;
}

const BEGINNING = "1900-01-01";
const IST = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
// The books are kept on GST bills only: GST sale invoices and GST purchase
// bills, and the returns made against them. Non-GST bills (and the discount
// expenses booked for them) stay out. Cash / bank, supplier dues and stock
// are built from the GST side only too (lib/gst-books.ts); expenses count in
// full.
const GST_SALE = `invoice_type = 'gst'`;
const GST_PURCHASE = `bill_type = 'gst'`;
// Expenses, minus the bill-discount expenses of non-GST invoices.
const GST_EXPENSES = `(e.invoice_id IS NULL OR EXISTS (SELECT 1 FROM invoices gi WHERE gi.id = e.invoice_id AND gi.${GST_SALE}))`;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;

export function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
// Indian financial year (1 April) that contains `date`.
export function fyStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}
function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── Period figures (income & expense side) ────────────────────────────

interface PeriodFigures {
  salesNet: number;        // invoice value excl. GST, before bill discount
  salesTax: number;
  returnsNet: number;
  returnsTax: number;
  purchasesNet: number;
  purchasesTax: number;
  purchaseReturnsNet: number;
  purchaseReturnsTax: number;
  expenses: { name: string; amount: number }[];
  expensesTotal: number;
}

async function periodFigures(companyId: number, from: string, to: string): Promise<PeriodFigures> {
  const ps = [companyId, from, to];
  const [sales, disc, ret, pur, exp, pret] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(grand_total - total_tax), 0) AS net, COALESCE(SUM(total_tax), 0) AS tax
       FROM invoices WHERE company_id = $1 AND status = 'saved' AND ${GST_SALE}
         AND ${IST("invoice_date")} BETWEEN $2::date AND $3::date`, ps),
    // A bill discount is taken off grand_total and also booked as a
    // "Discount" expense (see POST /invoices) — add it back to sales so it
    // isn't counted twice.
    pool.query(
      `SELECT COALESCE(SUM(e.amount), 0) AS total FROM expenses e
       WHERE e.company_id = $1 AND e.invoice_id IS NOT NULL AND ${GST_EXPENSES} AND e.date BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT COALESCE(SUM(sr.grand_total - sr.total_tax), 0) AS net, COALESCE(SUM(sr.total_tax), 0) AS tax
       FROM sales_returns sr JOIN invoices i ON i.id = sr.invoice_id AND i.${GST_SALE}
       WHERE sr.company_id = $1 AND sr.status = 'saved'
         AND ${IST("sr.return_date")} BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT COALESCE(SUM(grand_total - total_tax), 0) AS net, COALESCE(SUM(total_tax), 0) AS tax
       FROM purchases WHERE company_id = $1 AND status = 'saved' AND ${GST_PURCHASE}
         AND ${IST("bill_date")} BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT e.category_name AS name, COALESCE(SUM(e.amount), 0) AS amount FROM expenses e
       WHERE e.company_id = $1 AND ${GST_EXPENSES} AND e.date BETWEEN $2::date AND $3::date
       GROUP BY e.category_name ORDER BY SUM(e.amount) DESC`, ps),
    pool.query(
      `SELECT COALESCE(SUM(pr.grand_total - pr.total_tax), 0) AS net, COALESCE(SUM(pr.total_tax), 0) AS tax
       FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id AND p.${GST_PURCHASE}
       WHERE pr.company_id = $1 AND pr.status = 'saved'
         AND ${IST("pr.return_date")} BETWEEN $2::date AND $3::date`, ps),
  ]);
  const expenses = exp.rows.map((r: any) => ({ name: r.name, amount: n(r.amount) }));
  return {
    salesNet: n(sales.rows[0].net) + n(disc.rows[0].total),
    salesTax: n(sales.rows[0].tax),
    returnsNet: n(ret.rows[0].net),
    returnsTax: n(ret.rows[0].tax),
    purchasesNet: n(pur.rows[0].net),
    purchasesTax: n(pur.rows[0].tax),
    purchaseReturnsNet: n(pret.rows[0].net),
    purchaseReturnsTax: n(pret.rows[0].tax),
    expenses,
    expensesTotal: expenses.reduce((s, e) => s + e.amount, 0),
  };
}

// Cost of what was sold on GST bills in the period, net of goods returned —
// the cost snapshotted at sale, as in GET /reports/profit-loss (on a GST
// bill the purchase GST is input credit, not cost).
async function costOfGoodsSold(companyId: number, from: string, to: string): Promise<number> {
  const ps = [companyId, from, to];
  const costExpr = `COALESCE(ii.cost_price, prod.purchase_price, 0)`;
  const [sold, returned] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(ii.qty * ${costExpr}), 0) AS cost
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN products prod ON prod.id = ii.product_id
       WHERE i.company_id = $1 AND i.status = 'saved' AND i.${GST_SALE}
         AND ${IST("i.invoice_date")} BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT COALESCE(SUM(sri.qty * ${costExpr}), 0) AS cost
       FROM sales_return_items sri
       JOIN sales_returns sr ON sr.id = sri.return_id
       JOIN invoice_items ii ON ii.id = sri.invoice_item_id
       JOIN invoices i ON i.id = ii.invoice_id AND i.${GST_SALE}
       JOIN products prod ON prod.id = sri.product_id
       WHERE sr.company_id = $1 AND sr.status = 'saved'
         AND ${IST("sr.return_date")} BETWEEN $2::date AND $3::date`, ps),
  ]);
  return n(sold.rows[0].cost) - n(returned.rows[0].cost);
}

// ── Balances as on a date (asset & liability side) ────────────────────

interface LedgerBalance { id: number; name: string; group: LedgerGroup; balance: number }

// The business's own ledgers: opening + Journal movement in [from, to].
// `from` = BEGINNING gives the balance as on `to`.
async function bookLedgerBalances(companyId: number, from: string, to: string): Promise<LedgerBalance[]> {
  const r = await pool.query(
    `SELECT l.id, l.name, l.group_code, l.opening_balance,
            COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE jv.id IS NOT NULL), 0) AS movement
     FROM book_ledgers l
     LEFT JOIN journal_voucher_lines jl ON jl.ledger_id = l.id AND jl.company_id = l.company_id
     LEFT JOIN journal_vouchers jv ON jv.id = jl.voucher_id AND jv.status = 'saved'
       AND jv.voucher_date BETWEEN $2::date AND $3::date
     WHERE l.company_id = $1
     GROUP BY l.id ORDER BY l.name`,
    [companyId, from, to],
  );
  return r.rows
    .filter((row: any) => isLedgerGroup(row.group_code))
    .map((row: any) => {
      const group = row.group_code as LedgerGroup;
      const opening = from === BEGINNING ? signedOpening(group, n(row.opening_balance)) : 0;
      return { id: row.id, name: row.name, group, balance: r2(opening + n(row.movement)) };
    });
}

// Cash Book accounts as on `to`, from their GST share only (lib/gst-books.ts):
// opening + GST receipts − GST supplier payments − expenses ± contra.
async function cashBalances(companyId: number, to: string) {
  return (await gstCash(companyId, to)).accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, balance: a.balance }));
}

// Customer / supplier balances as on `to`.
//
// Customers: what is still due on GST invoices only — each GST invoice's
// balance due, plus whatever was set against it (payments, returns) after
// `to`. A customer's running balance mixes in non-GST bills, so it isn't used.
//
// Suppliers: still due on GST purchase bills, with payments set against the
// supplier's oldest bills first (lib/gst-books.ts). An advance isn't
// attributable to a GST bill until one arrives.
async function partyBalances(companyId: number, to: string) {
  const [cust, vend] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(i.balance_due + COALESCE((
         SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
         WHERE pa.company_id = i.company_id AND pa.invoice_id = i.id AND ${IST("pa.created_at")} > $2::date
       ), 0)), 0) AS due
       FROM invoices i
       WHERE i.company_id = $1 AND i.status = 'saved' AND i.${GST_SALE} AND ${IST("i.invoice_date")} <= $2::date`,
      [companyId, to],
    ),
    gstCash(companyId, to),
  ]);
  return {
    debtors: r2(n(cust.rows[0]?.due)),      // customers owe us on GST invoices
    customerAdvances: 0,                    // not attributable to GST bills
    creditors: r2([...vend.vendorDue.values()].reduce((a, b) => a + b, 0)),   // we owe suppliers on GST bills
    supplierAdvances: 0,                    // not attributable to GST bills
  };
}

// Stock as on `to` from GST bills only: GST purchases less debit notes, less
// the cost of what was sold on GST bills. (Today's quantity would include
// stock bought on non-GST bills.)
async function stockValue(companyId: number, to: string): Promise<number> {
  const [p, cogs] = await Promise.all([periodFigures(companyId, BEGINNING, to), costOfGoodsSold(companyId, BEGINNING, to)]);
  return r2(p.purchasesNet - p.purchaseReturnsNet - cogs);
}

// ── Statements ────────────────────────────────────────────────────────

export interface Line { name: string; amount: number; note?: string }

function plFromPeriod(p: PeriodFigures, cogs: number, journal: LedgerBalance[]) {
  const sales = r2(p.salesNet - p.returnsNet);
  const grossProfit = r2(sales - cogs);
  const otherIncome: Line[] = journal.filter((l) => l.group === "indirect_income" && l.balance !== 0)
    .map((l) => ({ name: l.name, amount: r2(-l.balance) }));
  const expenses: Line[] = [
    ...p.expenses.map((e) => ({ name: e.name, amount: r2(e.amount) })),
    ...journal.filter((l) => l.group === "indirect_expense" && l.balance !== 0).map((l) => ({ name: l.name, amount: l.balance })),
  ];
  const otherIncomeTotal = r2(otherIncome.reduce((s, l) => s + l.amount, 0));
  const expensesTotal = r2(expenses.reduce((s, l) => s + l.amount, 0));
  return {
    salesGross: r2(p.salesNet),
    salesReturns: r2(p.returnsNet),
    sales,
    costOfGoodsSold: r2(cogs),
    grossProfit,
    otherIncome,
    otherIncomeTotal,
    expenses,
    expensesTotal,
    netProfit: r2(grossProfit + otherIncomeTotal - expensesTotal),
  };
}

export async function profitAndLoss(companyId: number, from: string, to: string) {
  const [p, cogs, journal] = await Promise.all([
    periodFigures(companyId, from, to),
    costOfGoodsSold(companyId, from, to),
    bookLedgerBalances(companyId, from, to),
  ]);
  return { from, to, ...plFromPeriod(p, cogs, journal) };
}

export async function balanceSheet(companyId: number, to: string, from = fyStart(to)) {
  const [cash, parties, stock, ledgers, current, earlier, upToTo] = await Promise.all([
    cashBalances(companyId, to),
    partyBalances(companyId, to),
    stockValue(companyId, to),
    bookLedgerBalances(companyId, BEGINNING, to),
    profitAndLoss(companyId, from, to),
    from > BEGINNING ? profitAndLoss(companyId, BEGINNING, dayBefore(from)) : Promise.resolve(null),
    periodFigures(companyId, BEGINNING, to),
  ]);
  const gstPayable = r2(upToTo.salesTax - upToTo.returnsTax - upToTo.purchasesTax + upToTo.purchaseReturnsTax);

  const byGroup = (g: LedgerGroup, sign: 1 | -1): Line[] =>
    ledgers.filter((l) => l.group === g && l.balance !== 0).map((l) => ({ name: l.name, amount: r2(sign * l.balance) }));

  const cashAndBank = cash.filter((a) => a.balance !== 0);
  const overdrafts = cashAndBank.filter((a) => a.balance < 0).map((a) => ({ name: `${a.name} (overdrawn)`, amount: r2(-a.balance) }));

  const liabilities = [
    { group: "Capital Account", lines: byGroup("capital", -1) },
    { group: "Loans (Liability)", lines: [...byGroup("loans", -1), ...overdrafts] },
    {
      group: "Current Liabilities",
      lines: [
        { name: "Sundry Creditors (suppliers)", amount: parties.creditors },
        { name: "Advance from customers", amount: parties.customerAdvances },
        ...(gstPayable > 0 ? [{ name: "GST payable", amount: gstPayable }] : []),
        ...byGroup("current_liabilities", -1),
      ].filter((l) => l.amount !== 0),
    },
  ];
  const assets = [
    { group: "Fixed Assets", lines: byGroup("fixed_assets", 1) },
    { group: "Investments", lines: byGroup("investments", 1) },
    {
      group: "Current Assets",
      lines: [
        { name: "Stock in hand", amount: stock, note: "GST purchases − cost of GST sales" },
        { name: "Sundry Debtors (GST invoices)", amount: parties.debtors },
        { name: "Advance to suppliers", amount: parties.supplierAdvances },
        ...(gstPayable < 0 ? [{ name: "GST input credit", amount: -gstPayable }] : []),
        ...cashAndBank.filter((a) => a.balance > 0).map((a) => ({ name: a.name, amount: a.balance })),
        ...byGroup("current_assets", 1),
      ].filter((l) => l.amount !== 0),
    },
  ];

  const sum = (gs: { lines: Line[] }[]) => r2(gs.reduce((s, g) => s + g.lines.reduce((t, l) => t + l.amount, 0), 0));
  const profit = { earlier: earlier ? earlier.netProfit : 0, current: current.netProfit };
  const profitTotal = r2(profit.earlier + profit.current);
  const liabilitiesTotal = r2(sum(liabilities) + profitTotal);
  const assetsTotal = sum(assets);
  const difference = r2(assetsTotal - liabilitiesTotal);   // > 0 → shown on the liabilities side

  return {
    from, to,
    liabilities: liabilities.filter((g) => g.lines.length),
    assets: assets.filter((g) => g.lines.length),
    profit: { ...profit, total: profitTotal },
    difference,
    total: r2(Math.max(assetsTotal, liabilitiesTotal)),
  };
}

export interface TbRow { name: string; group: string; debit: number; credit: number }

// Trial Balance for [from, to]: Balance Sheet ledgers as on `to`, income and
// expense ledgers for the period only, and the profit before `from` as one
// "Profit & Loss A/c" line — the same layout as Tally.
export async function trialBalance(companyId: number, to: string, from = fyStart(to)) {
  const [cash, parties, ledgersAsOn, ledgersPeriod, ledgersBefore, period, upToTo, before] = await Promise.all([
    cashBalances(companyId, to),
    partyBalances(companyId, to),
    bookLedgerBalances(companyId, BEGINNING, to),
    bookLedgerBalances(companyId, from, to),
    from > BEGINNING ? bookLedgerBalances(companyId, BEGINNING, dayBefore(from)) : Promise.resolve([] as LedgerBalance[]),
    periodFigures(companyId, from, to),
    periodFigures(companyId, BEGINNING, to),
    from > BEGINNING ? periodFigures(companyId, BEGINNING, dayBefore(from)) : Promise.resolve(null),
  ]);

  const rows: TbRow[] = [];
  const add = (name: string, group: string, signed: number) => {
    const v = r2(signed);
    if (v === 0) return;
    rows.push({ name, group, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 });
  };

  for (const l of ledgersAsOn) if (LEDGER_GROUPS[l.group].statement === "bs") add(l.name, LEDGER_GROUPS[l.group].label, l.balance);
  for (const a of cash) add(a.name, "Cash & Bank", a.balance);
  add("Sundry Debtors (GST invoices)", "Current Assets", parties.debtors - parties.customerAdvances);
  add("Sundry Creditors (suppliers)", "Current Liabilities", parties.supplierAdvances - parties.creditors);
  add("Output GST", "Duties & Taxes", -(upToTo.salesTax - upToTo.returnsTax));
  add("Input GST", "Duties & Taxes", upToTo.purchasesTax - upToTo.purchaseReturnsTax);

  // Profit of earlier periods in the same (non-COGS) terms as this report.
  if (before) {
    const journalBefore = ledgersBefore.reduce((s, l) => s + (LEDGER_GROUPS[l.group].statement === "pl" ? l.balance : 0), 0);
    const earlierProfit = before.salesNet - before.returnsNet - before.purchasesNet + before.purchaseReturnsNet - before.expensesTotal - journalBefore;
    add("Profit & Loss A/c (earlier years)", "Capital Account", -earlierProfit);
  }

  add("Sales (GST)", "Sales Accounts", -period.salesNet);
  add("Sales Returns (GST)", "Sales Accounts", period.returnsNet);
  add("Purchases (GST)", "Purchase Accounts", period.purchasesNet);
  add("Purchase Returns (GST)", "Purchase Accounts", -period.purchaseReturnsNet);
  for (const e of period.expenses) add(e.name, "Expenses", e.amount);
  for (const l of ledgersPeriod) if (LEDGER_GROUPS[l.group].statement === "pl") add(l.name, LEDGER_GROUPS[l.group].label, l.balance);

  const debit = r2(rows.reduce((s, x) => s + x.debit, 0));
  const credit = r2(rows.reduce((s, x) => s + x.credit, 0));
  const difference = r2(debit - credit);   // > 0 → a credit line balances it
  return { from, to, rows, difference, totals: { debit: r2(Math.max(debit, credit)), credit: r2(Math.max(debit, credit)) } };
}

// Balance of every book ledger as on today, for the Ledgers list.
export async function ledgerList(companyId: number) {
  const r = await pool.query(
    `SELECT l.id, l.name, l.group_code, l.opening_balance, l.is_active,
            COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE jv.id IS NOT NULL), 0) AS movement
     FROM book_ledgers l
     LEFT JOIN journal_voucher_lines jl ON jl.ledger_id = l.id AND jl.company_id = l.company_id
     LEFT JOIN journal_vouchers jv ON jv.id = jl.voucher_id AND jv.status = 'saved'
     WHERE l.company_id = $1
     GROUP BY l.id ORDER BY l.name`,
    [companyId],
  );
  return r.rows.filter((row: any) => isLedgerGroup(row.group_code)).map((row: any) => ({
    id: row.id,
    name: row.name,
    group: row.group_code as LedgerGroup,
    openingBalance: n(row.opening_balance),
    isActive: row.is_active,
    balance: r2(signedOpening(row.group_code, n(row.opening_balance)) + n(row.movement)),
  }));
}

// Day Book — every voucher in [from, to], oldest first: GST sales and
// purchases and the credit / debit notes against them, Cash Book receipts /
// payments, contra transfers between accounts, and Journals.
// Transfers write an out and an in row; only the out row is listed.
export async function dayBook(companyId: number, from: string, to: string) {
  const r = await pool.query(
    `SELECT * FROM (
       SELECT ${IST("invoice_date")} AS day, created_at, 'sale' AS kind, id, invoice_no AS no, customer_name AS party, grand_total AS amount, NULL::text AS detail
       FROM invoices WHERE company_id = $1 AND status = 'saved' AND deleted_at IS NULL AND ${GST_SALE}
       UNION ALL
       SELECT ${IST("bill_date")}, created_at, 'purchase', id, bill_no, vendor_name, grand_total, vendor_bill_no
       FROM purchases WHERE company_id = $1 AND status = 'saved' AND deleted_at IS NULL AND ${GST_PURCHASE}
       UNION ALL
       SELECT ${IST("sr.return_date")}, sr.created_at, 'credit_note', sr.id, sr.return_no, sr.customer_name, sr.grand_total, 'Inv ' || sr.invoice_no
       FROM sales_returns sr JOIN invoices i ON i.id = sr.invoice_id AND i.${GST_SALE}
       WHERE sr.company_id = $1 AND sr.status = 'saved'
       UNION ALL
       SELECT ${IST("pr.return_date")}, pr.created_at, 'debit_note', pr.id, pr.return_no, pr.vendor_name, pr.grand_total, 'Bill ' || pr.bill_no
       FROM purchase_returns pr JOIN purchases p ON p.id = pr.purchase_id AND p.${GST_PURCHASE}
       WHERE pr.company_id = $1 AND pr.status = 'saved'
       UNION ALL
       SELECT ${IST("t.created_at")}, t.created_at,
              CASE WHEN t.receipt_no LIKE 'TRF-OUT-%' THEN 'contra' WHEN t.direction = 'in' THEN 'receipt' ELSE 'payment' END,
              t.id, t.receipt_no,
              CASE WHEN t.receipt_no LIKE 'TRF-OUT-%' THEN a.name || ' → ' || COALESCE(t.party_name, '') ELSE t.party_name END,
              t.amount, CASE WHEN t.receipt_no LIKE 'TRF-OUT-%' THEN t.notes ELSE a.name END
       FROM account_transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.company_id = $1 AND COALESCE(t.receipt_no, '') NOT LIKE 'TRF-IN-%'
       UNION ALL
       SELECT voucher_date, created_at, 'journal', id, voucher_no, NULL, total, narration
       FROM journal_vouchers WHERE company_id = $1 AND status = 'saved'
     ) v
     WHERE day BETWEEN $2::date AND $3::date
     ORDER BY day, created_at, id
     LIMIT 3000`,
    [companyId, from, to],
  );
  // Receipts / payments show only their GST share (lib/gst-books.ts); an
  // entry with none is left out.
  const { share } = await gstCash(companyId, to);
  const cashKinds = new Set(["receipt", "payment", "contra"]);
  return r.rows
    .map((row: any) => ({
      date: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
      kind: row.kind as string, id: row.id, no: row.no, party: row.party,
      amount: cashKinds.has(row.kind) ? share.get(row.id) ?? 0 : r2(n(row.amount)), detail: row.detail,
    }))
    .filter((row: any) => !cashKinds.has(row.kind) || row.amount > 0);
}
