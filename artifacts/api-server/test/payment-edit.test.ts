// Edit / delete / view a received payment (Payments page): bills, customer
// balance and ledger, Cash Book + account, and the discount expense all follow
// the change. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "payment-edit-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 700000 + RUN;
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
async function ok(who: string, method: string, p: string, body?: unknown) {
  const r = await call(who, method, p, body);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const one = async (sql: string, params: any[]) => (await pool.query(sql, params)).rows[0];
const custBal = async () => Number((await one(`SELECT outstanding_balance FROM entities WHERE id = $1`, [ids.customer])).outstanding_balance);
const acctBal = async (id = ids.account) => Number((await one(`SELECT current_balance FROM accounts WHERE id = $1`, [id])).current_balance);
const due = async (invId: number) => Number((await one(`SELECT balance_due FROM invoices WHERE id = $1`, [invId])).balance_due);

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Pay Edit ${RUN}`]);
  for (const role of ["admin", "salesman"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-pe-${RUN}`, role, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.rows[0].id, username: `${role}-pe-${RUN}`, role, name: role, entityId: null, companyId: A });
  }
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 100) RETURNING id`,
    [A, `OIL-PE-${RUN}`],
  )).rows[0].id;
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Edit Cust', '91') RETURNING id`, [A])).rows[0].id;
  ids.account = (await ok("admin", "POST", "/accounts", { name: "Cash", type: "cash", openingBalance: 0 })).id;
  ids.bank = (await ok("admin", "POST", "/accounts", { name: "Bank", type: "bank", openingBalance: 0 })).id;
  for (const [k, d] of [["inv1", "2026-11-01"], ["inv2", "2026-11-02"]] as const) {
    ids[k] = (await ok("admin", "POST", "/invoices", {
      invoiceType: "non_gst", invoiceDate: d, customerId: ids.customer, placeOfSupply: "Maharashtra",
      items: [{ productId: ids.product, qty: 10, unit: "QTY", rate: 100, mrp: 100 }],
    })).id;
  }
});

after(async () => {
  server?.close();
  await pool?.end();
});

let payId = 0;
let receipt = "";

test("editing a received payment down moves bills, balance, ledger and the account", async () => {
  // Two ₹1000 bills; ₹1500 received into Cash → bill 1 paid, bill 2 half paid.
  const pay = await ok("admin", "POST", "/payments", { customerId: ids.customer, amount: 1500, mode: "cash", accountId: ids.account });
  payId = pay.id; receipt = pay.receiptId;
  assert.equal(await custBal(), 500);
  assert.equal(await due(ids.inv2), 500);
  assert.equal(await acctBal(), 1500);

  // The customer actually gave ₹1200.
  const e = await ok("admin", "PUT", `/payments/${payId}`, { amount: 1200, mode: "cash", accountId: ids.account, notes: "short by 300" });
  assert.equal(e.amount, 1200);
  assert.equal(e.receiptId, receipt, "same receipt number");
  assert.equal(await custBal(), 800);
  assert.equal(await due(ids.inv1), 0);
  assert.equal(await due(ids.inv2), 800);
  assert.equal(await acctBal(), 1200);
  const txns = (await pool.query(`SELECT amount FROM account_transactions WHERE company_id = $1 AND receipt_no = $2`, [A, receipt])).rows;
  assert.equal(txns.length, 1);
  assert.equal(Number(txns[0].amount), 1200);
  const led = await one(`SELECT credit, balance FROM ledger_entries WHERE company_id = $1 AND reference_no = $2 AND type = 'payment'`, [A, receipt]);
  assert.equal(Number(led.credit), 1200);
  assert.equal(Number(led.balance), 800);
  const allocs = (await pool.query(`SELECT SUM(allocated_amount)::float AS s FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2`, [A, receipt])).rows[0].s;
  assert.equal(allocs, 1200);
});

test("move it to another account with a discount, then View shows how it was paid", async () => {
  await ok("admin", "PUT", `/payments/${payId}`, { amount: 1000, discount: 200, mode: "upi", accountId: ids.bank });
  assert.equal(await acctBal(ids.account), 0, "cash account back to zero");
  assert.equal(await acctBal(ids.bank), 1000);
  assert.equal(await custBal(), 800, "₹1000 cash + ₹200 discount settled");
  const exp = (await pool.query(`SELECT amount FROM expenses WHERE company_id = $1 AND category_name = 'Discount'`, [A])).rows;
  assert.equal(exp.length, 1);
  assert.equal(Number(exp[0].amount), 200);

  const v = await ok("admin", "GET", `/payments/${payId}/details`);
  assert.equal(v.amount, 1000);
  assert.equal(v.discount, 200);
  assert.equal(v.mode, "upi");
  assert.equal(v.accountName, "Bank");
  assert.equal(v.allocations.reduce((s: number, a: any) => s + a.allocated, 0), 1200);
  assert.equal(v.balanceBefore, 2000);
  assert.equal(v.balanceAfter, 800);

  // Discount off, no account (cash in hand).
  await ok("admin", "PUT", `/payments/${payId}`, { amount: 1000, discount: 0, mode: "cash", accountId: null });
  assert.equal(await acctBal(ids.bank), 0);
  assert.equal((await pool.query(`SELECT 1 FROM account_transactions WHERE company_id = $1 AND receipt_no = $2`, [A, receipt])).rows.length, 0);
  assert.equal((await pool.query(`SELECT 1 FROM expenses WHERE company_id = $1 AND category_name = 'Discount'`, [A])).rows.length, 0);
  assert.equal(await custBal(), 1000);
});

test("a later payment's running balance follows the edit; delete undoes everything", async () => {
  const later = await ok("admin", "POST", "/payments", { customerId: ids.customer, amount: 100, mode: "cash", accountId: ids.account });
  let row = await one(`SELECT balance FROM ledger_entries WHERE company_id = $1 AND reference_no = $2`, [A, later.receiptId]);
  assert.equal(Number(row.balance), 900);
  await ok("admin", "PUT", `/payments/${payId}`, { amount: 900, mode: "cash", accountId: null });
  row = await one(`SELECT balance FROM ledger_entries WHERE company_id = $1 AND reference_no = $2`, [A, later.receiptId]);
  assert.equal(Number(row.balance), 1000, "later row shifted by the ₹100 difference");
  assert.equal(await custBal(), 1000);

  await ok("admin", "DELETE", `/payments/${payId}`);
  assert.equal(await custBal(), 1900);
  row = await one(`SELECT balance FROM ledger_entries WHERE company_id = $1 AND reference_no = $2`, [A, later.receiptId]);
  assert.equal(Number(row.balance), 1900);
  assert.equal((await pool.query(`SELECT 1 FROM ledger_entries WHERE company_id = $1 AND reference_no = $2`, [A, receipt])).rows.length, 0);
  assert.equal((await pool.query(`SELECT 1 FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2`, [A, receipt])).rows.length, 0);
  assert.equal((await pool.query(`SELECT 1 FROM payments WHERE id = $1`, [payId])).rows.length, 0);
  // Bills: the later ₹100 payment stays where it was put (bill 2, since bill
  // 1 was paid then); this payment's part comes off bill 1.
  assert.equal(await due(ids.inv1), 1000);
  assert.equal(await due(ids.inv2), 900);
  const log = await one(`SELECT description FROM audit_log WHERE company_id = $1 AND action = 'payment_delete'`, [A]);
  assert.match(log.description, new RegExp(receipt.replace(/[/\\-]/g, ".")));
});

test("pending payments: admin edits / deletes the row only; salesman can't edit", async () => {
  const p = await ok("salesman", "POST", "/payments", { customerId: ids.customer, amount: 300, mode: "cash" });
  assert.equal((await call("salesman", "PUT", `/payments/${p.id}`, { amount: 1, mode: "cash" })).status, 403);
  assert.equal((await call("salesman", "DELETE", `/payments/${p.id}`)).status, 403);
  const bal = await custBal();
  const e = await ok("admin", "PUT", `/payments/${p.id}`, { amount: 250, mode: "upi" });
  assert.equal(e.amount, 250);
  assert.equal(e.status, "pending");
  assert.equal(await custBal(), bal, "pending never moved money");
  assert.equal((await call("admin", "PUT", `/payments/${p.id}`, { amount: 250, discount: 10, mode: "upi" })).status, 400);
  await ok("admin", "DELETE", `/payments/${p.id}`);
  assert.equal(await custBal(), bal);
  assert.equal((await call("admin", "PUT", `/payments/${p.id}`, { amount: 1, mode: "cash" })).status, 404);
  assert.equal((await call("admin", "PUT", `/payments/${payId}`, { amount: 0, mode: "cash" })).status, 404);
});
