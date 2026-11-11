// Bank Reconciliation (lib/bank-recon.ts): statement lines are stored once,
// matched to Cash Book entries already there, or booked from the statement
// (customer receipt against a bill, supplier payment, expense, transfer,
// other) — and an undo puts everything back. Needs TEST_DATABASE_URL.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database");
process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET = "bank-recon-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 800000 + RUN;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(who: string, method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { cookie: cookies[who], ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const one = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows[0];

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Recon Test ${RUN}`]);
  for (const role of ["admin", "accountant"]) {
    const u = await one(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-rec-${RUN}`, `${role} rec`, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.id, username: `${role}-rec-${RUN}`, role, name: `${role} rec`, entityId: null, companyId: A });
  }
  ids.bank = (await one(`INSERT INTO accounts (company_id, name, type, current_balance) VALUES ($1, 'HDFC Current', 'bank', 10000) RETURNING id`, [A])).id;
  ids.cash = (await one(`INSERT INTO accounts (company_id, name, type, current_balance) VALUES ($1, 'Cash', 'cash', 0) RETURNING id`, [A])).id;
  ids.ramesh = (await one(`INSERT INTO entities (company_id, type, name, mobile, outstanding_balance) VALUES ($1, 'customer', 'Ramesh Kumar', '9876543210', 6200) RETURNING id`, [A])).id;
  ids.gupta = (await one(`INSERT INTO entities (company_id, type, name, mobile, outstanding_balance) VALUES ($1, 'vendor', 'Gupta Mills', '9000000011', 3000) RETURNING id`, [A])).id;
  // Ramesh owes two bills; the newer one is exactly the statement amount.
  ids.inv1 = (await one(
    `INSERT INTO invoices (company_id, invoice_no, invoice_type, customer_id, customer_name, invoice_date, grand_total, amount_paid, balance_due, status)
     VALUES ($1, 'T-INV-1', 'non_gst', $2, 'Ramesh Kumar', '2026-09-01', 1200, 0, 1200, 'saved') RETURNING id`, [A, ids.ramesh])).id;
  ids.inv2 = (await one(
    `INSERT INTO invoices (company_id, invoice_no, invoice_type, customer_id, customer_name, invoice_date, grand_total, amount_paid, balance_due, status)
     VALUES ($1, 'T-INV-2', 'non_gst', $2, 'Ramesh Kumar', '2026-09-20', 5000, 0, 5000, 'saved') RETURNING id`, [A, ids.ramesh])).id;
  await pool.query(
    `INSERT INTO purchases (company_id, bill_no, vendor_id, vendor_name, bill_date, grand_total, status) VALUES ($1, 'T-PUR-1', $2, 'Gupta Mills', '2026-09-15', 3000, 'saved')`,
    [A, ids.gupta],
  );
  // Already entered in the Cash Book by hand.
  ids.existing = (await one(
    `INSERT INTO account_transactions (company_id, account_id, direction, amount, mode, party_name, receipt_no, created_at)
     VALUES ($1, $2, 'in', 750, 'bank_transfer', 'Walk-in', $3, '2026-10-05 11:00+05:30') RETURNING id`,
    [A, ids.bank, `T-EX-${RUN}`],
  )).id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

const ROWS = [
  { date: "2026-10-03", description: "UPI/CR/3301/RAMESH KUM/9876543210@ybl/Payment", credit: 5000, balance: 15000 },
  { date: "2026-10-06", description: "NEFT CR ABC LTD", credit: "750.00", balance: 15750 },
  { date: "2026-10-07", description: "IMPS/P2A/GUPTA MILLS/HDFC", debit: "3,000.00", balance: 12750 },
  { date: "2026-10-08", description: "SMS CHARGES FOR QTR", debit: 59, balance: 12691 },
  { date: "2026-10-09", description: "ATM WDL CASH 1234", debit: 2000, balance: 10691 },
  { date: "2026-10-10", description: "NEFT CR UNKNOWN PARTY XYZ", credit: 1111, balance: 11802 },
  { date: "2026-13-40", description: "bad date", credit: 5 },
  { date: "2026-10-11", description: "both", credit: 5, debit: 5 },
];

test("only admin imports; preview saves nothing; a second upload adds nothing", async () => {
  assert.equal((await call("accountant", "POST", "/bank-recon/import", { accountId: ids.bank, rows: ROWS, dryRun: false })).status, 403);
  const pre = await call("admin", "POST", "/bank-recon/import", { accountId: ids.bank, rows: ROWS });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.equal(pre.body.added, 6);
  assert.deepEqual(pre.body.errors.map((e: any) => e.index), [6, 7]);
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM bank_statement_lines WHERE company_id = $1`, [A])).n, 0);

  const done = await call("admin", "POST", "/bank-recon/import", { accountId: ids.bank, rows: ROWS, dryRun: false, fileName: "oct.pdf" });
  assert.equal(done.body.added, 6);
  const again = await call("admin", "POST", "/bank-recon/import", { accountId: ids.bank, rows: ROWS, dryRun: false });
  assert.equal(again.body.added, 0);
  assert.equal(again.body.duplicates, 6);
});

let lines: any[] = [];
const lineFor = (desc: string) => lines.find((l) => l.description.startsWith(desc));

test("suggestions: existing entry, party by mobile + bill, supplier by name, charges, cash, suspense", async () => {
  const r = await call("accountant", "GET", `/bank-recon/lines?accountId=${ids.bank}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  lines = r.body.lines;
  assert.equal(lines.length, 6);
  const s = (d: string) => lineFor(d).suggestion;
  assert.equal(s("UPI/CR").kind, "party");
  assert.equal(s("UPI/CR").entityId, ids.ramesh);
  assert.equal(s("UPI/CR").invoiceId, ids.inv2);
  assert.equal(s("NEFT CR ABC").kind, "existing");
  assert.equal(s("NEFT CR ABC").accountTxnId, ids.existing);
  assert.equal(s("IMPS").entityId, ids.gupta);
  assert.equal(s("SMS").kind, "expense");
  assert.equal(s("ATM").kind, "transfer");
  assert.equal(s("ATM").otherAccountId, ids.cash);
  assert.equal(s("NEFT CR UNKNOWN"), null);
  assert.equal(r.body.summary.statementBalance, 11802);
});

test("confirming books each kind; undo puts the customer receipt back", async () => {
  const pick = (d: string) => ({ lineId: lineFor(d).id, action: lineFor(d).suggestion });
  const many = await call("admin", "POST", "/bank-recon/confirm-many", {
    items: [pick("UPI/CR"), pick("NEFT CR ABC"), pick("IMPS"), pick("SMS"), pick("ATM")],
  });
  assert.equal(many.status, 200, JSON.stringify(many.body));
  assert.equal(many.body.done, 5, JSON.stringify(many.body.results));
  const other = await call("admin", "POST", `/bank-recon/lines/${lineFor("NEFT CR UNKNOWN").id}/confirm`, { action: { kind: "other", partyName: "Owner capital", note: "Capital introduced" } });
  assert.equal(other.status, 200, JSON.stringify(other.body));

  // Customer: the pinned bill is paid, the balance and ledger moved, dated on the statement.
  assert.deepEqual(await one(`SELECT balance_due::float AS due, amount_paid::float AS paid FROM invoices WHERE id = $1`, [ids.inv2]), { due: 0, paid: 5000 });
  assert.equal((await one(`SELECT outstanding_balance::float AS b FROM entities WHERE id = $1`, [ids.ramesh])).b, 1200);
  assert.equal((await one(`SELECT (date AT TIME ZONE 'Asia/Kolkata')::date::text AS d FROM ledger_entries WHERE entity_id = $1 AND type = 'payment'`, [ids.ramesh])).d, "2026-10-03");
  // Supplier paid, expense made, transfer pair made.
  assert.equal((await one(`SELECT outstanding_balance::float AS b FROM entities WHERE id = $1`, [ids.gupta])).b, 0);
  assert.deepEqual(await one(`SELECT category_name, amount::float AS amount, date::text AS date FROM expenses WHERE company_id = $1`, [A]), { category_name: "Bank Charges", amount: 59, date: "2026-10-08" });
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.cash])).b, 2000);
  // Bank: 10000 + 5000 (receipt) − 3000 − 59 − 2000 + 1111; the 750 was already in.
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.bank])).b, 11052);
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM bank_statement_lines WHERE company_id = $1 AND status = 'matched'`, [A])).n, 6);

  // The same Cash Book entry can't be matched twice, and a done line can't be confirmed again.
  const dup = await call("admin", "POST", `/bank-recon/lines/${lineFor("NEFT CR ABC").id}/confirm`, { action: { kind: "existing", accountTxnId: ids.existing } });
  assert.equal(dup.status, 400);

  const undo = await call("admin", "POST", `/bank-recon/lines/${lineFor("UPI/CR").id}/undo`);
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.deepEqual(await one(`SELECT balance_due::float AS due, amount_paid::float AS paid FROM invoices WHERE id = $1`, [ids.inv2]), { due: 5000, paid: 0 });
  assert.equal((await one(`SELECT outstanding_balance::float AS b FROM entities WHERE id = $1`, [ids.ramesh])).b, 6200);
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.bank])).b, 6052);
  assert.equal((await one(`SELECT status FROM bank_statement_lines WHERE id = $1`, [lineFor("UPI/CR").id])).status, "pending");

  // Undo the transfer and expense too: both accounts back, expense gone.
  await call("admin", "POST", `/bank-recon/lines/${lineFor("ATM").id}/undo`);
  await call("admin", "POST", `/bank-recon/lines/${lineFor("SMS").id}/undo`);
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.cash])).b, 0);
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.bank])).b, 8111);
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM expenses WHERE company_id = $1`, [A])).n, 0);

  // Re-linking the receipt to the customer without a bill clears the oldest bill first.
  const relink = await call("admin", "POST", `/bank-recon/lines/${lineFor("UPI/CR").id}/confirm`, { action: { kind: "party", entityId: ids.ramesh } });
  assert.equal(relink.status, 200, JSON.stringify(relink.body));
  assert.equal((await one(`SELECT balance_due::float AS due FROM invoices WHERE id = $1`, [ids.inv1])).due, 0);
  assert.equal((await one(`SELECT balance_due::float AS due FROM invoices WHERE id = $1`, [ids.inv2])).due, 1200);
});
