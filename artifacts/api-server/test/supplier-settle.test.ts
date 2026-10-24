// Supplier Settle: sales matched to suppliers oldest-purchase-first, money
// collected as far as each bill is paid, and "pay now" = the supplier's share
// of collected money not yet paid to them. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "supplier-settle-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 600000 + RUN * 2;
const B = A + 1;
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

const purchase = (vendorId: number, qty: number, rate: number, date: string) => ok("adminA", "POST", "/purchases", {
  billType: "non_gst", billDate: date, vendorId, placeOfSupply: "Maharashtra",
  items: [{ productId: ids.product, qty, unit: "QTY", rate }],
});
const sale = (qty: number, date: string) => ok("adminA", "POST", "/invoices", {
  invoiceType: "non_gst", invoiceDate: date, customerId: ids.customer, placeOfSupply: "Maharashtra",
  items: [{ productId: ids.product, qty, unit: "QTY", rate: 150, mrp: 150 }],
});

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Settle Test ${tag} ${RUN}`]);
    for (const role of tag === "A" ? ["admin", "accountant", "store"] : ["admin"]) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
        [`${role}-${tag}-${RUN}`, `${role} ${tag}`, role, cid],
      );
      cookies[`${role}${tag}`] = sessionCookie({ userId: u.rows[0].id, username: `${role}-${tag}-${RUN}`, role, name: role, entityId: null, companyId: cid });
    }
  }
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 100) RETURNING id`,
    [A, `OIL-${RUN}`],
  )).rows[0].id;
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust', '91') RETURNING id`, [A])).rows[0].id;
  ids.v1 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Supplier One', '81') RETURNING id`, [A])).rows[0].id;
  ids.v2 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Supplier Two', '82') RETURNING id`, [A])).rows[0].id;
  ids.account = (await ok("adminA", "POST", "/accounts", { name: "Cash", type: "cash", openingBalance: 100000 })).id;

  await purchase(ids.v1, 10, 100, "2026-03-01");
  await purchase(ids.v2, 10, 120, "2026-03-05");
  const inv1 = await sale(12, "2026-03-10");
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: Number(inv1.grandTotal), mode: "cash",
    partyEntityId: ids.customer, invoiceId: inv1.id,
  });
  await sale(4, "2026-03-12"); // unpaid
});

after(async () => {
  server?.close();
  await pool?.end();
});

const find = (rep: any, vendorId: number) => rep.suppliers.find((s: any) => s.vendorId === vendorId);

test("sales are matched oldest-purchase-first and split by what customers have paid", async () => {
  const rep = await ok("adminA", "GET", "/supplier-settle");
  const v1 = find(rep, ids.v1);
  const v2 = find(rep, ids.v2);

  // Supplier One: all 10 sold on the paid bill.
  assert.equal(v1.products[0].soldQty, 10);
  assert.equal(v1.soldValue, 1500);
  assert.equal(v1.collected, 1500);
  assert.equal(v1.costOfCollected, 1000);
  assert.equal(v1.profitCollected, 500);
  assert.equal(v1.supplierDue, 1000);
  assert.equal(v1.payNow, 1000);

  // Supplier Two: 2 on the paid bill + 4 on the unpaid one, 4 still in stock.
  assert.equal(v2.products[0].soldQty, 6);
  assert.equal(v2.soldValue, 900);
  assert.equal(v2.collected, 300);
  assert.equal(v2.pendingFromCustomers, 600);
  assert.equal(v2.costOfCollected, 240);
  assert.equal(v2.payNow, 240);
  assert.equal(v2.products[0].stockQty, 4);
  assert.equal(v2.stockValue, 480);

  assert.equal(rep.totals.payNow, 1240);
  assert.equal(rep.unattributed.soldValue, 0);
});

test("paying a supplier reduces what is left to pay them", async () => {
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "out", amount: 400, mode: "cash", partyEntityId: ids.v1,
  });
  const v1 = find(await ok("adminA", "GET", "/supplier-settle"), ids.v1);
  assert.equal(v1.paidToSupplier, 400);
  assert.equal(v1.supplierDue, 600);
  assert.equal(v1.payNow, 600);
});

test("when the second bill is paid, Supplier Two's share of it becomes payable", async () => {
  const unpaid = (await pool.query(
    `SELECT id, grand_total FROM invoices WHERE company_id = $1 AND balance_due > 0 ORDER BY id DESC LIMIT 1`, [A],
  )).rows[0];
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: Number(unpaid.grand_total), mode: "cash",
    partyEntityId: ids.customer, invoiceId: unpaid.id,
  });
  const v2 = find(await ok("adminA", "GET", "/supplier-settle"), ids.v2);
  assert.equal(v2.collected, 900);
  assert.equal(v2.pendingFromCustomers, 0);
  assert.equal(v2.costOfCollected, 720);
  assert.equal(v2.payNow, 720);
});

test("a made product's sale is traced through its BOM to the raw-material supplier", async () => {
  // Raw material bought from Supplier Three; finished product made from it (2 per unit).
  const raw = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price, not_for_sale) VALUES ($1, 'Plastic Marshal', 'Raw', 'T', $2, 'QTY', 10, true) RETURNING id`,
    [A, `RAW-${RUN}`],
  )).rows[0].id;
  const made = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Marshal Tooti 40ml', 'Tooti', 'T', $2, 'QTY', 20) RETURNING id`,
    [A, `TOOTI-${RUN}`],
  )).rows[0].id;
  const bom = (await pool.query(`INSERT INTO boms (company_id, finished_product_id, output_quantity) VALUES ($1, $2, 1) RETURNING id`, [A, made])).rows[0].id;
  await pool.query(`INSERT INTO bom_items (company_id, bom_id, material_product_id, quantity, unit) VALUES ($1, $2, $3, 2, 'QTY')`, [A, bom, raw]);
  const v3 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Supplier Three', '83') RETURNING id`, [A])).rows[0].id;

  await ok("adminA", "POST", "/purchases", {
    billType: "non_gst", billDate: "2026-04-01", vendorId: v3, placeOfSupply: "Maharashtra",
    items: [{ productId: raw, qty: 100, unit: "QTY", rate: 10 }],
  });
  const inv = await ok("adminA", "POST", "/invoices", {
    invoiceType: "non_gst", invoiceDate: "2026-04-05", customerId: ids.customer, placeOfSupply: "Maharashtra",
    items: [{ productId: made, qty: 20, unit: "QTY", rate: 50, mrp: 50 }],
  });
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: Number(inv.grandTotal), mode: "cash",
    partyEntityId: ids.customer, invoiceId: inv.id,
  });

  // Backend: selling 20 made units consumed 40 of the raw material.
  const stock = (await pool.query(`SELECT current_stock::float8 AS s FROM products WHERE id = $1`, [raw])).rows[0].s;
  assert.equal(stock, 60);

  const rep = await ok("adminA", "GET", "/supplier-settle");
  const s3 = find(rep, v3);
  const line = s3.products.find((p: any) => p.productId === raw);
  assert.equal(line.soldQty, 40);
  assert.equal(line.usedInMadeQty, 40);
  assert.equal(line.stockQty, 60);
  assert.equal(s3.collected, 1000);
  assert.equal(s3.costOfCollected, 400);
  assert.equal(s3.profitCollected, 600);
  assert.equal(s3.payNow, 400);
  assert.equal(rep.unattributed.soldValue, 0);
});

test("only the company admin can open it (not accountant, store or super admin), and another company sees none of it", async () => {
  assert.equal((await call("accountantA", "GET", "/supplier-settle")).status, 403);
  // Platform super admin switched into company A still can't open it.
  const su = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'super', 'super_admin', NULL, true) RETURNING id`,
    [`super-${RUN}`],
  );
  cookies.super = sessionCookie({ userId: su.rows[0].id, username: `super-${RUN}`, role: "super_admin", name: "super", entityId: null, companyId: null, activeCompanyId: A });
  assert.equal((await call("super", "GET", "/supplier-settle")).status, 403);
  assert.equal((await call("storeA", "GET", "/supplier-settle")).status, 403);
  const other = await ok("adminB", "GET", "/supplier-settle");
  assert.deepEqual(other.suppliers, []);
});
