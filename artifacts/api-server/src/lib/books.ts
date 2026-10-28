// Books & Audit — Trial Balance, Profit & Loss and Balance Sheet built from
// the data the ERP already records (invoices, purchases, sales returns,
// expenses, Cash Book accounts, party ledgers) plus the business's own
// ledgers and Journal vouchers (book_ledgers / journal_vouchers, see
// bootstrap.ts).
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
// Real sales only — same rule as dashboard.ts.
const SALE_TYPES = `invoice_type NOT IN ('quotation', 'proforma_invoice', 'sale_order', 'delivery_challan')`;
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
  expenses: { name: string; amount: number }[];
  expensesTotal: number;
}

async function periodFigures(companyId: number, from: string, to: string): Promise<PeriodFigures> {
  const ps = [companyId, from, to];
  const [sales, disc, ret, pur, exp] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(grand_total - total_tax), 0) AS net, COALESCE(SUM(total_tax), 0) AS tax
       FROM invoices WHERE company_id = $1 AND status = 'saved' AND ${SALE_TYPES}
         AND ${IST("invoice_date")} BETWEEN $2::date AND $3::date`, ps),
    // A bill discount is taken off grand_total and also booked as a
    // "Discount" expense (see POST /invoices) — add it back to sales so it
    // isn't counted twice.
    pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE company_id = $1 AND invoice_id IS NOT NULL AND date BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT COALESCE(SUM(grand_total - total_tax), 0) AS net, COALESCE(SUM(total_tax), 0) AS tax
       FROM sales_returns WHERE company_id = $1 AND status = 'saved'
         AND ${IST("return_date")} BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT COALESCE(SUM(grand_total - total_tax), 0) AS net, COALESCE(SUM(total_tax), 0) AS tax
       FROM purchases WHERE company_id = $1 AND status = 'saved'
         AND ${IST("bill_date")} BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT category_name AS name, COALESCE(SUM(amount), 0) AS amount FROM expenses
       WHERE company_id = $1 AND date BETWEEN $2::date AND $3::date
       GROUP BY category_name ORDER BY SUM(amount) DESC`, ps),
  ]);
  const expenses = exp.rows.map((r: any) => ({ name: r.name, amount: n(r.amount) }));
  return {
    salesNet: n(sales.rows[0].net) + n(disc.rows[0].total),
    salesTax: n(sales.rows[0].tax),
    returnsNet: n(ret.rows[0].net),
    returnsTax: n(ret.rows[0].tax),
    purchasesNet: n(pur.rows[0].net),
    purchasesTax: n(pur.rows[0].tax),
    expenses,
    expensesTotal: expenses.reduce((s, e) => s + e.amount, 0),
  };
}

// Cost of what was sold in the period, net of goods returned — the same cost
// rule as GET /reports/profit-loss (cost snapshotted at sale; GST on cost
// counts as cost on a non-GST bill).
async function costOfGoodsSold(companyId: number, from: string, to: string): Promise<number> {
  const ps = [companyId, from, to];
  const costExpr = `COALESCE(ii.cost_price, prod.purchase_price, 0) * (CASE WHEN i.invoice_type = 'gst' THEN 1 ELSE 1 + COALESCE(ii.cost_gst_pct, prod.purchase_gst_pct, 0) / 100 END)`;
  const [sold, returned] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(ii.qty * ${costExpr}), 0) AS cost
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN products prod ON prod.id = ii.product_id
       WHERE i.company_id = $1 AND i.status = 'saved' AND i.${SALE_TYPES}
         AND ${IST("i.invoice_date")} BETWEEN $2::date AND $3::date`, ps),
    pool.query(
      `SELECT COALESCE(SUM(sri.qty * ${costExpr}), 0) AS cost
       FROM sales_return_items sri
       JOIN sales_returns sr ON sr.id = sri.return_id
       JOIN invoice_items ii ON ii.id = sri.invoice_item_id
       JOIN invoices i ON i.id = ii.invoice_id
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

// Cash Book accounts as on `to`: today's balance minus everything after it.
async function cashBalances(companyId: number, to: string) {
  const r = await pool.query(
    `SELECT a.id, a.name, a.type,
            a.current_balance - COALESCE((
              SELECT SUM(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END)
              FROM account_transactions t
              WHERE t.company_id = a.company_id AND t.account_id = a.id AND ${IST("t.created_at")} > $2::date
            ), 0) AS balance
     FROM accounts a WHERE a.company_id = $1 ORDER BY a.name`,
    [companyId, to],
  );
  return r.rows.map((row: any) => ({ id: row.id, name: row.name, type: row.type, balance: r2(n(row.balance)) }));
}

// Customer / supplier balances as on `to`, split by sign: a customer in
// credit is an advance received, a supplier in debit is an advance paid.
// Party ledgers keep debit − credit = change in outstanding for both types.
async function partyBalances(companyId: number, to: string) {
  const r = await pool.query(
    `SELECT e.type,
            COALESCE(SUM(GREATEST(b.bal, 0)), 0) AS positive,
            COALESCE(SUM(LEAST(b.bal, 0)), 0) AS negative
     FROM entities e
     CROSS JOIN LATERAL (
       SELECT e.outstanding_balance - COALESCE((
         SELECT SUM(le.debit - le.credit) FROM ledger_entries le
         WHERE le.company_id = e.company_id AND le.entity_id = e.id AND ${IST("le.date")} > $2::date
       ), 0) AS bal
     ) b
     WHERE e.company_id = $1 AND e.type IN ('customer', 'vendor')
     GROUP BY e.type`,
    [companyId, to],
  );
  const get = (type: string) => r.rows.find((row: any) => row.type === type) ?? { positive: 0, negative: 0 };
  const c = get("customer"), v = get("vendor");
  return {
    debtors: r2(n(c.positive)),             // customers owe us
    customerAdvances: r2(-n(c.negative)),   // we owe customers
    creditors: r2(n(v.positive)),           // we owe suppliers
    supplierAdvances: r2(-n(v.negative)),   // suppliers owe us
  };
}

// Stock is valued at today's quantity × purchase price — the ERP keeps no
// stock history to value it on a past date.
async function stockValue(companyId: number): Promise<number> {
  const r = await pool.query(
    `SELECT COALESCE(SUM(GREATEST(current_stock, 0) * purchase_price), 0) AS value FROM products WHERE company_id = $1`,
    [companyId],
  );
  return r2(n(r.rows[0].value));
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
    stockValue(companyId),
    bookLedgerBalances(companyId, BEGINNING, to),
    profitAndLoss(companyId, from, to),
    from > BEGINNING ? profitAndLoss(companyId, BEGINNING, dayBefore(from)) : Promise.resolve(null),
    periodFigures(companyId, BEGINNING, to),
  ]);
  const gstPayable = r2(upToTo.salesTax - upToTo.returnsTax - upToTo.purchasesTax);

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
        { name: "Stock in hand", amount: stock, note: "Today's stock × purchase price" },
        { name: "Sundry Debtors (customers)", amount: parties.debtors },
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
  add("Sundry Debtors (customers)", "Current Assets", parties.debtors - parties.customerAdvances);
  add("Sundry Creditors (suppliers)", "Current Liabilities", parties.supplierAdvances - parties.creditors);
  add("Output GST", "Duties & Taxes", -(upToTo.salesTax - upToTo.returnsTax));
  add("Input GST", "Duties & Taxes", upToTo.purchasesTax);

  // Profit of earlier periods in the same (non-COGS) terms as this report.
  if (before) {
    const journalBefore = ledgersBefore.reduce((s, l) => s + (LEDGER_GROUPS[l.group].statement === "pl" ? l.balance : 0), 0);
    const earlierProfit = before.salesNet - before.returnsNet - before.purchasesNet - before.expensesTotal - journalBefore;
    add("Profit & Loss A/c (earlier years)", "Capital Account", -earlierProfit);
  }

  add("Sales", "Sales Accounts", -period.salesNet);
  add("Sales Returns", "Sales Accounts", period.returnsNet);
  add("Purchases", "Purchase Accounts", period.purchasesNet);
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
