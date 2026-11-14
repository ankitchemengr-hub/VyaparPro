// Services (Inventory → Add Service): a products row with itemType
// "service". It is billed like any item but never holds stock — selling,
// editing or a stock movement leaves its stock at 0 and writes
// no stock_movements row, while goods on the same bill still move.
// Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "svc-test-secret";
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
let cookie = "";
const ids: Record<string, number> = {};

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

const one = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows[0];

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Service Test ${RUN}`]);
  const u = await one(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'svc admin', 'admin', $2, true) RETURNING id`,
    [`admin-svc-${RUN}`, A],
  );
  cookie = sessionCookie({ userId: u.id, username: `admin-svc-${RUN}`, role: "admin", name: "svc admin", entityId: null, companyId: A });
  ids.cust = (await one(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Service Cust', '9222222222') RETURNING id`, [A])).id;
  ids.oil = (await one(`INSERT INTO products (company_id, name, item_code, unit, current_stock, "group", brand) VALUES ($1, 'Gear Oil', $2, 'LTR', 50, 'General', 'General') RETURNING id`, [A, `GO-${RUN}`])).id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("a service is saved with its SAC code and never gets stock", async () => {
  const add = await call("POST", "/products", {
    itemType: "service", name: "Oil Change Labour", itemCode: `SRV-OIL-${RUN}`, hsnCode: "998719",
    group: "Services", brand: "Service", unit: "Job", purchasePrice: 0, retailPrice: 250, wholesalePrice: 250, mrp: 0,
    taxRate: 18, openingStock: 40, minStockThreshold: 5,
  });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.equal(add.body.itemType, "service");
  assert.equal(add.body.hsnCode, "998719");
  assert.equal(add.body.currentStock, 0, "opening stock is ignored for a service");
  assert.equal(add.body.minStockThreshold, null, "no low-stock alert for a service");
  ids.svc = add.body.id;

  const list = await call("GET", "/products");
  assert.equal(list.body.find((p: any) => p.id === ids.svc)?.itemType, "service");
  assert.equal(list.body.find((p: any) => p.id === ids.oil)?.itemType, "product");

  // Even a direct stock movement can't give it stock.
  await pool.query(`UPDATE products SET current_stock = 9 WHERE id = $1`, [ids.svc]);
  assert.equal(Number((await one(`SELECT current_stock FROM products WHERE id = $1`, [ids.svc])).current_stock), 0);
});

test("billing a service with goods: goods stock moves, the service's does not", async () => {
  const inv = await call("POST", "/invoices", {
    invoiceType: "non_gst", invoiceDate: "2026-11-14", customerId: ids.cust, placeOfSupply: "Maharashtra",
    items: [
      { productId: ids.oil, qty: 3, unit: "LTR", rate: 400, mrp: 0 },
      { productId: ids.svc, qty: 1, unit: "Job", rate: 250, mrp: 0 },
    ],
  });
  assert.ok(inv.status === 200 || inv.status === 201, JSON.stringify(inv.body));
  assert.equal(Number(inv.body.grandTotal), 1450);
  const stock = async (id: number) => Number((await one(`SELECT current_stock FROM products WHERE id = $1`, [id])).current_stock);
  assert.equal(await stock(ids.oil), 47);
  assert.equal(await stock(ids.svc), 0);
  const moves = await one(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1`, [ids.svc]);
  assert.equal(moves.n, 0, "no stock movement rows for a service");
  const items = (await pool.query(`SELECT product_id FROM invoice_items WHERE invoice_id = $1`, [inv.body.id])).rows;
  assert.equal(items.length, 2, "the service is still a line on the bill");

  // Editing the bill re-moves the goods and still leaves the service at 0.
  const edit = await call("PATCH", `/invoices/${inv.body.id}`, {
    invoiceType: "non_gst", invoiceDate: "2026-11-14", customerId: ids.cust, placeOfSupply: "Maharashtra",
    items: [
      { productId: ids.oil, qty: 2, unit: "LTR", rate: 400, mrp: 0 },
      { productId: ids.svc, qty: 2, unit: "Job", rate: 250, mrp: 0 },
    ],
  });
  assert.ok(edit.status < 300, JSON.stringify(edit.body));
  assert.equal(await stock(ids.oil), 48);
  assert.equal(await stock(ids.svc), 0);
  assert.equal((await one(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE product_id = $1`, [ids.svc])).n, 0);
});

test("turning a service back into a product lets it hold stock again", async () => {
  const r = await call("PATCH", `/products/${ids.svc}`, { itemType: "product" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await pool.query(`UPDATE products SET current_stock = 4 WHERE id = $1`, [ids.svc]);
  assert.equal(Number((await one(`SELECT current_stock FROM products WHERE id = $1`, [ids.svc])).current_stock), 4);
});
