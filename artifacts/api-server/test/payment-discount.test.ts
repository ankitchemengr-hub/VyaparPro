// Discount while taking a payment: cash + discount settle the bill, only the
// cash reaches the account, and the discount lands in Expenses under
// "Discount". Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "payment-discount-test-secret";
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
async function ok(who: string, method: string, p: string, body?: unknown) {
  const r = await call(who, method, p, body);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Discount Test ${RUN}`]);
  for (const role of ["admin", "salesman"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-disc-${RUN}`, role, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.rows[0].id, username: `${role}-disc-${RUN}`, role, name: role, entityId: null, companyId: A });
  }
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 100) RETURNING id`,
    [A, `OIL-D-${RUN}`],
  )).rows[0].id;
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Disc Cust', '91') RETURNING id`, [A])).rows[0].id;
  ids.account = (await ok("admin", "POST", "/accounts", { name: "Cash", type: "cash", openingBalance: 0 })).id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("cash + discount clears the bill, only cash reaches the account, discount goes to Expenses", async () => {
  const inv = await ok("admin", "POST", "/invoices", {
    invoiceType: "non_gst", invoiceDate: "2026-11-01", customerId: ids.customer, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 10, unit: "QTY", rate: 100, mrp: 100 }],
  });
  const total = Number(inv.grandTotal);

  const pay = await ok("admin", "POST", "/payments", {
    customerId: ids.customer, invoiceId: inv.id, amount: total - 50, discount: 50, mode: "cash", accountId: ids.account,
  });
  assert.equal(pay.allocations.length, 1);
  assert.equal(pay.allocations[0].status, "paid");

  const invAfter = (await pool.query(`SELECT balance_due, status FROM invoices WHERE id = $1`, [inv.id])).rows[0];
  assert.equal(Number(invAfter.balance_due), 0);
  const cust = (await pool.query(`SELECT outstanding_balance FROM entities WHERE id = $1`, [ids.customer])).rows[0];
  assert.equal(Number(cust.outstanding_balance), 0);
  const acct = (await pool.query(`SELECT current_balance FROM accounts WHERE id = $1`, [ids.account])).rows[0];
  assert.equal(Number(acct.current_balance), total - 50, "account gets the cash only");

  const exp = (await pool.query(
    `SELECT amount, category_name, account_id, invoice_id, paid_to, notes FROM expenses WHERE company_id = $1`, [A],
  )).rows;
  assert.equal(exp.length, 1);
  assert.equal(Number(exp[0].amount), 50);
  assert.equal(exp[0].category_name, "Discount");
  assert.equal(exp[0].account_id, null);
  assert.equal(exp[0].invoice_id, null, "must not collide with the invoice's own bill-discount expense");
  assert.equal(exp[0].paid_to, "Disc Cust");
  assert.match(exp[0].notes, new RegExp(pay.receiptId));
  assert.match(exp[0].notes, new RegExp(inv.invoiceNo));

  const listed = await ok("admin", "GET", "/expenses");
  const rows = Array.isArray(listed) ? listed : listed.expenses ?? listed.items ?? [];
  assert.ok(rows.some((e: any) => Number(e.amount) === 50), "shows in the Expenses list");
});

test("a discount alone (no cash) still settles the leftover", async () => {
  const inv = await ok("admin", "POST", "/invoices", {
    invoiceType: "non_gst", invoiceDate: "2026-11-02", customerId: ids.customer, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 1, unit: "QTY", rate: 100, mrp: 100 }],
  });
  const before = (await pool.query(`SELECT current_balance FROM accounts WHERE id = $1`, [ids.account])).rows[0];
  await ok("admin", "POST", "/payments", {
    customerId: ids.customer, invoiceId: inv.id, amount: 0, discount: Number(inv.grandTotal), mode: "cash", accountId: ids.account,
  });
  const invAfter = (await pool.query(`SELECT balance_due FROM invoices WHERE id = $1`, [inv.id])).rows[0];
  assert.equal(Number(invAfter.balance_due), 0);
  const after = (await pool.query(`SELECT current_balance FROM accounts WHERE id = $1`, [ids.account])).rows[0];
  assert.equal(Number(after.current_balance), Number(before.current_balance));
});

test("supplier discount on Payment Out clears their dues, leaves the account alone, and adds to profit", async () => {
  const vendor = (await pool.query(
    `INSERT INTO entities (company_id, type, name, mobile, outstanding_balance) VALUES ($1, 'vendor', 'Disc Supplier', '81', 1000) RETURNING id`, [A],
  )).rows[0].id;
  const plBefore = await ok("admin", "GET", "/reports/profit-loss");
  const acctBefore = Number((await pool.query(`SELECT current_balance FROM accounts WHERE id = $1`, [ids.account])).rows[0].current_balance);

  await ok("admin", "POST", "/account-transactions", {
    accountId: ids.account, direction: "out", amount: 900, discount: 100, mode: "cash", partyEntityId: vendor, allowNegative: true,
  });

  const v = (await pool.query(`SELECT outstanding_balance FROM entities WHERE id = $1`, [vendor])).rows[0];
  assert.equal(Number(v.outstanding_balance), 0, "cash + discount cleared the ₹1000 due");
  const acctAfter = Number((await pool.query(`SELECT current_balance FROM accounts WHERE id = $1`, [ids.account])).rows[0].current_balance);
  assert.equal(acctAfter, acctBefore - 900, "only the cash left the account");

  const plAfter = await ok("admin", "GET", "/reports/profit-loss");
  assert.equal(plAfter.otherIncome - (plBefore.otherIncome ?? 0), 100);
  assert.equal(Math.round((plAfter.netProfit - plBefore.netProfit) * 100) / 100, 100, "net profit up by the discount");

  // A discount needs a supplier on a Payment Out.
  assert.equal((await call("admin", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: 10, discount: 5, mode: "cash", partyEntityId: ids.customer,
  })).status, 400);
  assert.equal((await call("admin", "POST", "/account-transactions", {
    accountId: ids.account, direction: "out", amount: 10, discount: 5, mode: "cash", partyEntityId: ids.customer, allowNegative: true,
  })).status, 400);
  const plLast = await ok("admin", "GET", "/reports/profit-loss");
  assert.equal(plLast.otherIncome, plAfter.otherIncome, "refused entries left no trace");
});

test("salesman cannot give a discount; zero amount and zero discount is refused", async () => {
  const r = await call("salesman", "POST", "/payments", { customerId: ids.customer, amount: 100, discount: 10, mode: "cash" });
  assert.equal(r.status, 403);
  const z = await call("admin", "POST", "/payments", { customerId: ids.customer, amount: 0, mode: "cash" });
  assert.equal(z.status, 400);
  // A plain salesman payment still works.
  const s = await call("salesman", "POST", "/payments", { customerId: ids.customer, amount: 100, mode: "cash" });
  assert.equal(s.status, 201);
});
