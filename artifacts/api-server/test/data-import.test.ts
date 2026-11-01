// Settings → Data Import: parties with opening balance and items with
// opening stock, preview first, nothing twice. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "data-import-test-secret";
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

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Import Test ${RUN}`]);
  for (const role of ["admin", "accountant"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-imp-${RUN}`, `${role} imp`, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.rows[0].id, username: `${role}-imp-${RUN}`, role, name: `${role} imp`, entityId: null, companyId: A });
  }
  await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Old Customer', '9000000001')`, [A]);
});

after(async () => {
  server?.close();
  await pool?.end();
});

const PARTIES = [
  { row: 2, name: "Sharma Traders", mobile: "+91 98765 43210", gstin: "08abcde1234f1z5", openingBalance: "12,500", city: "Jaipur" },
  { row: 3, name: "Gupta Mills", mobile: "9123456780", type: "Supplier", openingBalance: "4000 Cr" },
  { row: 4, name: "Advance Wala", openingBalance: "-300" },
  { row: 5, name: "Old customer", mobile: "9000000009" },
  { row: 6, name: "Bad GST", gstin: "12345" },
  { row: 7, name: "" , mobile: "9000000002" },
  { row: 8, name: "Sharma Traders", mobile: "9876543210" },
  { row: 9, name: "Split Cols", type: "Sundry Creditors", receivable: "100", payable: "900" },
];

test("only admin can import", async () => {
  const r = await call("accountant", "POST", "/data-import/parties", { rows: PARTIES });
  assert.equal(r.status, 403);
});

test("parties: preview, import with opening balances, re-import adds nothing", async () => {
  const pre = await call("admin", "POST", "/data-import/parties", { rows: PARTIES, asOn: "2025-04-01" });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  const st = Object.fromEntries(pre.body.results.map((r: any) => [r.row, r.status]));
  assert.deepEqual(st, { 2: "new", 3: "new", 4: "new", 5: "exists", 6: "error", 7: "error", 8: "exists", 9: "new" });
  assert.deepEqual(pre.body.openingTotal, { customer: 12200, vendor: 4800 });
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS c FROM entities WHERE company_id = $1`, [A])).rows[0].c, 1, "preview saves nothing");

  const done = await call("admin", "POST", "/data-import/parties", { rows: PARTIES, asOn: "2025-04-01", dryRun: false, pricingTier: "wholesale" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.created, 4);
  const rows = (await pool.query(
    `SELECT e.name, e.type, e.mobile, e.gstin, e.code, e.pricing_tier, e.outstanding_balance::float AS bal,
            (SELECT json_agg(json_build_object('d', le.debit::float, 'c', le.credit::float, 't', le.type, 'day', le.date::date::text)) FROM ledger_entries le WHERE le.entity_id = e.id) AS led
     FROM entities e WHERE e.company_id = $1 AND e.customer_source = 'import' ORDER BY e.id`, [A])).rows;
  const by = Object.fromEntries(rows.map((r: any) => [r.name, r]));
  assert.equal(by["Sharma Traders"].mobile, "9876543210");
  assert.equal(by["Sharma Traders"].gstin, "08ABCDE1234F1Z5");
  assert.equal(by["Sharma Traders"].pricing_tier, "wholesale");
  assert.equal(by["Sharma Traders"].bal, 12500);
  assert.deepEqual(by["Sharma Traders"].led, [{ d: 12500, c: 0, t: "opening", day: "2025-04-01" }]);
  assert.equal(by["Gupta Mills"].type, "vendor");
  assert.equal(by["Gupta Mills"].bal, 4000);
  assert.equal(by["Advance Wala"].bal, -300);
  assert.deepEqual(by["Advance Wala"].led.map((l: any) => [l.d, l.c]), [[0, 300]]);
  assert.equal(by["Split Cols"].type, "vendor");
  assert.equal(by["Split Cols"].bal, 800);
  assert.equal(new Set(rows.map((r: any) => r.code)).size, 4, "each party gets its own code");

  // An imported supplier opening is a pre-ERP due: a payment clears it before any GST bill.
  const { gstCash } = await import("../src/lib/gst-books");
  const cash = await gstCash(A, "2099-12-31");
  const gupta = (await pool.query(`SELECT id FROM entities WHERE company_id = $1 AND name = 'Gupta Mills'`, [A])).rows[0].id;
  assert.equal(cash.vendorDue.get(gupta) ?? 0, 0, "no GST bill is due for the imported opening");

  const again = await call("admin", "POST", "/data-import/parties", { rows: PARTIES, dryRun: false });
  assert.equal(again.body.created, 0);
});

test("items: opening stock, GST rate parsing, codes, duplicates", async () => {
  const items = [
    { row: 2, name: "Wall Putty 20kg", hsnCode: "3214", taxRate: "GST@18%", unit: "Bags", salePrice: "650", purchasePrice: "520", openingStock: "40", brand: "Birla" },
    { row: 3, name: "Primer 1L", itemCode: "PR-1", taxRate: "12 %", salePrice: "₹320", openingStock: "0" },
    { row: 4, name: "Wall Putty 20KG" },
    { row: 5, name: "Odd", taxRate: "17" },
    { row: 6, name: "Neg", openingStock: "-3" },
  ];
  const pre = await call("admin", "POST", "/data-import/items", { rows: items });
  assert.equal(pre.status, 200, JSON.stringify(pre.body));
  assert.deepEqual(pre.body.results.map((r: any) => r.status), ["new", "new", "exists", "error", "error"]);
  assert.equal(pre.body.stockValue, 20800);

  const done = await call("admin", "POST", "/data-import/items", { rows: items, dryRun: false });
  assert.equal(done.body.created, 2);
  const p = (await pool.query(
    `SELECT name, item_code, unit, tax_rate::float AS tax, retail_price::float AS rp, wholesale_price::float AS wp, current_stock::float AS stock,
            opening_stock_value::float AS osv, "group", brand,
            (SELECT COUNT(*)::int FROM stock_movements m WHERE m.product_id = products.id) AS moves
     FROM products WHERE company_id = $1 ORDER BY id`, [A])).rows;
  assert.deepEqual(p.map((x: any) => [x.name, x.item_code, x.unit, x.tax, x.rp, x.wp, x.stock, x.osv, x.group, x.brand, x.moves]), [
    ["Wall Putty 20kg", "WAL-PUT-20KG", "BAG", 18, 650, 650, 40, 20800, "General", "Birla", 1],
    ["Primer 1L", "PR-1", "QTY", 12, 320, 320, 0, 0, "General", "General", 0],
  ]);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS c FROM brands WHERE company_id = $1`, [A])).rows[0].c, 2);
  const again = await call("admin", "POST", "/data-import/items", { rows: items, dryRun: false });
  assert.equal(again.body.created, 0);
  const log = (await pool.query(`SELECT action FROM audit_log WHERE company_id = $1 ORDER BY id`, [A])).rows.map((r: any) => r.action);
  assert.ok(log.includes("parties_imported") && log.includes("items_imported"));
});

test("parties: blank address filled from the GSTIN lookup, only for new parties", async () => {
  const { importParties } = await import("../src/lib/data-import");
  const asked: string[] = [];
  const lookup = async (g: string) => {
    asked.push(g);
    return { found: true, gstin: g, legalName: "REG NAME", address: "1, MG Road, Pune", city: "Pune", state: "Maharashtra", pinCode: "411001" };
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await importParties(client, A, {
      rows: [
        { row: 2, name: "Lookup Co", gstin: "27AAPFU0939F1ZV" },
        { row: 3, name: "Has Address", gstin: "27AAACR5055K1Z7", address: "Own address", city: "Nashik", state: "Maharashtra", pinCode: "422001" },
        { row: 4, name: "Sharma Traders", gstin: "08ABCDE1234F1Z5" },
      ],
      defaultType: "customer", pricingTier: "retail", asOn: "2025-04-01", dryRun: false, userId: null, userName: null, lookup,
    });
    assert.deepEqual(asked, ["27AAPFU0939F1ZV"], "existing parties and filled rows are not looked up");
    assert.equal(out.gstFilled, 1);
    const r = (await client.query(`SELECT name, address, city, state, pin_code FROM entities WHERE company_id = $1 AND name = 'Lookup Co'`, [A])).rows[0];
    assert.deepEqual(r, { name: "Lookup Co", address: "1, MG Road, Pune", city: "Pune", state: "Maharashtra", pin_code: "411001" });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
