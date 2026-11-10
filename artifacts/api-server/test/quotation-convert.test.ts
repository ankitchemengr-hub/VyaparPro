// Quotation → Convert to Invoice: a quotation never moves stock or counts as
// a sale (liters, reports, commission); editing its type is refused; converting
// makes a NEW invoice with its own number, and the quotation stays, marked
// converted, so it can't be converted twice. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "quotation-test-secret";
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
let cookie = "";
const ids: Record<string, number> = {};
const TODAY = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
async function ok(method: string, p: string, body?: unknown) {
  const r = await call(method, p, body);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const stock = async () =>
  Number((await pool.query(`SELECT current_stock FROM products WHERE id = $1`, [ids.product])).rows[0].current_stock);
const bill = (invoiceType: string, extra: object = {}) => ({
  invoiceType, invoiceDate: TODAY, placeOfSupply: "Maharashtra",
  customerId: ids.customer, customerName: "Cust", salesmanId: ids.salesman,
  items: [{ productId: ids.product, qty: 5, unit: "QTY", rate: 100, mrp: 120, taxPct: invoiceType === "gst" ? 18 : 0 }],
  ...extra,
});

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Quotation Test ${RUN}`]);
  const u = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'admin', 'admin', $2, true) RETURNING id`,
    [`admin-q-${RUN}`, A],
  );
  cookie = sessionCookie({ userId: u.rows[0].id, username: `admin-q-${RUN}`, role: "admin", name: "admin", entityId: null, companyId: A });
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price, current_stock, liters_per_box, commission_per_liter)
     VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 50, 50, 1, 2) RETURNING id`,
    [A, `OIL-Q-${RUN}`],
  )).rows[0].id;
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust', '91') RETURNING id`, [A])).rows[0].id;
  ids.salesman = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'salesman', 'Sales', '92') RETURNING id`, [A])).rows[0].id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("a quotation moves no stock and is no sale: liters, sales report, P&L, commission", async () => {
  const q = await ok("POST", "/invoices", bill("quotation"));
  ids.quotation = q.id;
  ids.quotationNo = q.invoiceNo;
  assert.match(q.invoiceNo, /^QTN/);
  assert.equal(q.convertedInvoiceId, null);
  assert.equal(await stock(), 50);

  assert.equal((await ok("GET", "/dashboard/liters-sold")).today, 0);
  assert.equal((await ok("GET", "/dashboard/liters-balance")).sold, 0);
  assert.equal((await ok("GET", "/reports/sales?from=2020-01-01&to=2099-12-31")).items.length, 0);
  assert.equal((await ok("GET", "/reports/profit-loss?from=2020-01-01&to=2099-12-31")).revenue, 0);
  assert.equal((await ok("GET", "/reports/commission?from=2020-01-01&to=2099-12-31")).totalLiters, 0);
});

test("editing a quotation into an invoice is refused — use Convert to Invoice", async () => {
  const r = await call("PATCH", `/invoices/${ids.quotation}`, bill("non_gst"));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /Convert to Invoice/);
  const q = await ok("GET", `/invoices/${ids.quotation}`);
  assert.equal(q.invoiceType, "quotation");
  assert.equal(await stock(), 50);
});

test("Convert to Invoice: new invoice number, stock moves, quotation stays and links to it", async () => {
  const inv = await ok("POST", "/invoices", bill("gst", { fromQuotationId: ids.quotation }));
  assert.notEqual(inv.invoiceNo, ids.quotationNo);
  assert.doesNotMatch(inv.invoiceNo, /^QTN/);
  assert.equal(inv.invoiceType, "gst");
  assert.equal(inv.sourceQuotationId, ids.quotation);
  assert.equal(inv.sourceQuotationNo, ids.quotationNo);
  assert.equal(inv.grandTotal, 590);
  assert.equal(await stock(), 45);

  const q = await ok("GET", `/invoices/${ids.quotation}`);
  assert.equal(q.invoiceType, "quotation");
  assert.equal(q.invoiceNo, ids.quotationNo);
  assert.equal(q.convertedInvoiceId, inv.id);
  assert.equal(q.convertedInvoiceNo, inv.invoiceNo);

  const list = await ok("GET", "/invoices?type=quotation");
  const row = list.find((x: any) => x.id === ids.quotation);
  assert.equal(row.convertedInvoiceNo, inv.invoiceNo);

  // Only the real invoice counts as a sale.
  assert.equal((await ok("GET", "/dashboard/liters-sold")).today, 5);
  assert.equal((await ok("GET", "/reports/commission?from=2020-01-01&to=2099-12-31")).totalLiters, 5);
  ids.invoice = inv.id;
});

test("a quotation can't be converted twice, nor into a quotation", async () => {
  const again = await call("POST", "/invoices", bill("non_gst", { fromQuotationId: ids.quotation }));
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.match(again.body.error, /already converted/);

  const q2 = await ok("POST", "/invoices", bill("quotation"));
  const asQuote = await call("POST", "/invoices", bill("quotation", { fromQuotationId: q2.id }));
  assert.equal(asQuote.status, 400);

  const notQuote = await call("POST", "/invoices", bill("gst", { fromQuotationId: ids.invoice }));
  assert.equal(notQuote.status, 404);
  assert.equal(await stock(), 45);
});
