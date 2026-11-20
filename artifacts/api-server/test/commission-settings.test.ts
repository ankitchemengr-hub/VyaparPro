// Commission → Settings: per-salesman commission rule (per liter, % of bill
// before/with GST, product %, fixed per bill, none) applied on billing, edit,
// cancel and return; and TA / DA (per day / per order / monthly DA, per km /
// per day / actual TA) with travel claims and payments. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "commission-settings-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 500000 + RUN;
const cookies: Record<string, string> = {};
const ids: Record<string, any> = {};

function sign(session: object): string {
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
const bill = (salesmanId: number, qty: number, opts: { date?: string; gst?: boolean } = {}) => ({
  invoiceType: opts.gst ? "gst" : "non_gst", invoiceDate: opts.date ?? "2026-11-03", customerId: ids.cust, salesmanId,
  placeOfSupply: "Maharashtra",
  items: [{ productId: ids.oil, qty, unit: "QTY", rate: 100, mrp: 100, taxPct: opts.gst ? 18 : 0 }],
});
const rowsFor = async (invoiceId: number) => (await pool.query(
  `SELECT invoice_no, commission_amount, total_liters, status FROM commission_transactions WHERE company_id = $1 AND invoice_id = $2 ORDER BY id`,
  [A, invoiceId],
)).rows.map((r: any) => ({ no: r.invoice_no, amount: Number(r.commission_amount), liters: Number(r.total_liters), status: r.status }));
const total = async (invoiceId: number) => (await rowsFor(invoiceId)).reduce((s, r) => s + r.amount, 0);
const rule = (method: string, rate = 0, extra: Record<string, unknown> = {}) => ({
  method, rate, base: "without_gst", daMode: "none", daAmount: 0, daBasis: "invoices", taMode: "none", taRate: 0, ...extra,
});

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Commission ${RUN}`]);
  ids.s1 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'salesman', 'Raju', '81') RETURNING id`, [A])).rows[0].id;
  ids.s2 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'salesman', 'Mohan', '82') RETURNING id`, [A])).rows[0].id;
  ids.cust = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Shop', '91') RETURNING id`, [A])).rows[0].id;
  ids.oil = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price, liters_per_box, commission_per_liter)
     VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 50, 1, 2) RETURNING id`, [A, `OIL-C-${RUN}`],
  )).rows[0].id;
  for (const [role, entityId] of [["admin", null], ["accountant", null], ["salesman", ids.s1]] as const) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active, entity_id) VALUES ($1, 'x', $2, $3, $4, true, $5) RETURNING id`,
      [`${role}-com-${RUN}`, role, role, A, entityId],
    );
    cookies[role] = sign({ userId: u.rows[0].id, username: `${role}-com-${RUN}`, role, name: role, entityId, companyId: A });
  }
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("no settings → per liter as before", async () => {
  const inv = await ok("admin", "POST", "/invoices", bill(ids.s1, 10));
  assert.equal(await total(inv.id), 20, "10 L × ₹2");
});

test("% of bill before GST and with GST, product %, fixed per bill, none", async () => {
  await ok("admin", "PUT", `/commissions/settings/${ids.s1}`, rule("invoice_percent", 2));
  const a = await ok("admin", "POST", "/invoices", bill(ids.s1, 10, { gst: true }));
  assert.equal(await total(a.id), 20, "2% of ₹1000 before GST");
  await ok("admin", "PUT", `/commissions/settings/${ids.s1}`, rule("invoice_percent", 2, { base: "with_gst" }));
  const b = await ok("admin", "POST", "/invoices", bill(ids.s1, 10, { gst: true }));
  assert.equal(await total(b.id), 23.6, "2% of ₹1180 with GST");

  // Company default for everyone without their own rule.
  await ok("admin", "PUT", "/commissions/settings/0", rule("product_percent"));
  await ok("admin", "PUT", "/commissions/product-rates", { rates: [{ productId: ids.oil, percent: 5 }] });
  const c = await ok("admin", "POST", "/invoices", bill(ids.s2, 10));
  assert.equal(await total(c.id), 50, "Mohan uses the default: 5% of ₹1000");

  await ok("admin", "PUT", `/commissions/settings/${ids.s2}`, rule("per_invoice", 75));
  const d = await ok("admin", "POST", "/invoices", bill(ids.s2, 3));
  assert.equal(await total(d.id), 75);

  await ok("admin", "PUT", `/commissions/settings/${ids.s2}`, rule("none"));
  const e = await ok("admin", "POST", "/invoices", bill(ids.s2, 3));
  assert.ok((await total(e.id)) === 0);

  // Back to the default.
  await ok("admin", "DELETE", `/commissions/settings/${ids.s2}`);
  const f = await ok("admin", "POST", "/invoices", bill(ids.s2, 2));
  assert.equal(await total(f.id), 10, "5% of ₹200");

  const s = await ok("accountant", "GET", "/commissions/settings");
  assert.equal(s.default.method, "product_percent");
  assert.equal(s.salesmen.find((x: any) => x.id === ids.s1).rule.method, "invoice_percent");
  assert.equal(s.salesmen.find((x: any) => x.id === ids.s2).rule, null);
});

test("edit, return and cancel keep commission right", async () => {
  await ok("admin", "PUT", `/commissions/settings/${ids.s1}`, rule("invoice_percent", 2));
  const inv = await ok("admin", "POST", "/invoices", bill(ids.s1, 10));
  assert.equal(await total(inv.id), 20);

  // Still pending: the bill's own row is rewritten.
  await ok("admin", "PATCH", `/invoices/${inv.id}`, bill(ids.s1, 20));
  let rows = await rowsFor(inv.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 40);

  // Paid, then edited: the difference is booked separately.
  await pool.query(`UPDATE commission_transactions SET status = 'paid' WHERE company_id = $1 AND invoice_id = $2`, [A, inv.id]);
  await ok("admin", "PATCH", `/invoices/${inv.id}`, bill(ids.s1, 15));
  rows = await rowsFor(inv.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].amount, -10);
  assert.equal(rows[1].status, "pending");
  assert.match(rows[1].no, /\(Edited\)$/);

  // Return 5 of 15: 2% of ₹500 back.
  const full = await ok("admin", "GET", `/invoices/${inv.id}`);
  await ok("admin", "POST", "/sales-returns", { invoiceId: inv.id, items: [{ invoiceItemId: full.items[0].id, productId: ids.oil, qty: 5 }] });
  const ret = (await pool.query(
    `SELECT commission_amount FROM commission_transactions WHERE company_id = $1 AND invoice_id = $2 AND invoice_no LIKE '%(Return%'`, [A, inv.id],
  )).rows;
  assert.equal(Number(ret[0].commission_amount), -10);

  // Cancel a pending bill: its commission goes.
  const other = await ok("admin", "POST", "/invoices", bill(ids.s1, 10));
  assert.equal(await total(other.id), 20);
  assert.equal((await call("admin", "DELETE", `/invoices/${other.id}`)).status, 204);
  assert.equal((await rowsFor(other.id)).length, 0);
});

test("who can see and change settings", async () => {
  assert.equal((await call("salesman", "GET", "/commissions/settings")).status, 403);
  assert.equal((await call("accountant", "PUT", "/commissions/settings/0", rule("none"))).status, 403);
  assert.equal((await call("admin", "PUT", "/commissions/settings/0", { ...rule("invoice_percent", 150) })).status, 400);
  assert.equal((await call("admin", "PUT", "/commissions/settings/0", { ...rule("bogus") })).status, 400);
});

test("TA / DA: per working day DA, per km TA, claims, statement and payment", async () => {
  await ok("admin", "PUT", `/commissions/settings/${ids.s1}`, rule("invoice_percent", 2, { daMode: "per_day", daAmount: 300, taMode: "per_km", taRate: 4 }));
  // Bills on 2 more days in November (one already on the 3rd from earlier tests).
  await ok("admin", "POST", "/invoices", bill(ids.s1, 1, { date: "2026-11-05" }));
  await ok("admin", "POST", "/invoices", bill(ids.s1, 1, { date: "2026-11-05" }));
  await ok("admin", "POST", "/invoices", bill(ids.s1, 1, { date: "2026-11-07" }));

  // The salesman adds their own claim; admin adds one for them.
  assert.equal((await call("salesman", "POST", "/commissions/travel-claims", { date: "2026-11-05", km: 50, note: "Pune route" })).status, 201);
  await ok("admin", "POST", "/commissions/travel-claims", { salesmanId: ids.s1, date: "2026-11-07", km: 30 });
  assert.equal((await call("salesman", "POST", "/commissions/travel-claims", { salesmanId: ids.s2, date: "2026-11-05", km: 999 })).status, 201,
    "a salesman's claim is always their own, whatever they send");
  const mine = await ok("salesman", "GET", "/commissions/travel-claims");
  assert.ok(mine.every((c: any) => c.salesmanId === ids.s1));

  const st = await ok("admin", "GET", `/commissions/allowances?from=2026-11-01&to=2026-11-30&salesmanId=${ids.s1}`);
  const r = st.rows[0];
  assert.equal(r.workingDays, 3, "3rd, 5th, 7th (cancelled bills don't count)");
  assert.equal(r.da, 900);
  assert.equal(r.km, 50 + 30 + 999);
  assert.equal(r.ta, (50 + 30 + 999) * 4);
  assert.equal(r.due, r.total);

  await ok("admin", "POST", "/commissions/allowances/pay", { salesmanId: ids.s1, from: "2026-11-01", to: "2026-11-30", ta: r.ta, da: r.da, reference: "UPI" });
  const after = (await ok("admin", "GET", `/commissions/allowances?from=2026-11-01&to=2026-11-30&salesmanId=${ids.s1}`)).rows[0];
  assert.equal(after.paid, r.total);
  assert.equal(after.due, 0);

  // Per-order DA and actual TA.
  await ok("admin", "PUT", `/commissions/settings/${ids.s1}`, rule("invoice_percent", 2, { daMode: "per_order", daAmount: 50, taMode: "actual" }));
  await ok("admin", "POST", "/commissions/travel-claims", { salesmanId: ids.s1, date: "2026-11-08", amount: 120 });
  const r2 = (await ok("admin", "GET", `/commissions/allowances?from=2026-11-08&to=2026-11-08&salesmanId=${ids.s1}`)).rows[0];
  assert.equal(r2.da, 0, "no bills that day");
  assert.equal(r2.ta, 120);
  const own = await ok("salesman", "GET", "/commissions/allowances?from=2026-11-01&to=2026-11-30");
  assert.deepEqual(own.rows.map((x: any) => x.salesmanId), [ids.s1], "a salesman sees only their own statement");
  assert.equal((await call("salesman", "POST", "/commissions/allowances/pay", { salesmanId: ids.s1, from: "2026-11-01", to: "2026-11-30", ta: 1, da: 1 })).status, 403);
});

test("Report works each salesman out by their own rule", async () => {
  // Raju: 2% of bill before GST (set in the TA / DA test). Mohan: default, product 5%.
  const base = async (sid: number) => Number((await pool.query(
    `SELECT COALESCE(SUM(ii.amount / (1 + (ii.tax_pct + ii.cess_pct) / 100)), 0) AS v
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.company_id = $1 AND i.salesman_id = $2 AND i.status = 'saved' AND i.invoice_type IN ('gst', 'non_gst')
        AND i.invoice_date >= '2026-11-01' AND i.invoice_date < '2026-12-01'`, [A, sid],
  )).rows[0].v);
  const rep = await ok("admin", "GET", "/reports/commission?from=2026-11-01&to=2026-11-30");
  const raju = rep.rows.find((r: any) => r.salesmanId === ids.s1);
  const mohan = rep.rows.find((r: any) => r.salesmanId === ids.s2);
  assert.match(raju.ruleLabel, /2% of bill before GST/);
  assert.equal(raju.commission, Math.round((await base(ids.s1)) * 0.02 * 100) / 100);
  assert.equal(raju.productBreakdown[0].rate, "2%");
  assert.match(mohan.ruleLabel, /Product-wise %/);
  assert.equal(mohan.commission, Math.round((await base(ids.s2)) * 0.05 * 100) / 100);

  // Fixed per bill: bills × amount.
  await ok("admin", "PUT", `/commissions/settings/${ids.s2}`, rule("per_invoice", 40));
  const rep2 = await ok("admin", "GET", `/reports/commission?from=2026-11-01&to=2026-11-30&salesmanId=${ids.s2}`);
  const bills = Number((await pool.query(
    `SELECT COUNT(*) AS n FROM invoices WHERE company_id = $1 AND salesman_id = $2 AND status = 'saved' AND invoice_type IN ('gst', 'non_gst')
       AND invoice_date >= '2026-11-01' AND invoice_date < '2026-12-01'`, [A, ids.s2],
  )).rows[0].n);
  assert.equal(rep2.rows[0].commission, bills * 40);
  assert.equal(rep2.rows[0].bills, bills);
});
