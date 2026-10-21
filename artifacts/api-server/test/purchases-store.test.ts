// A store user may enter new purchase bills but never see Purchase History:
// no list, report, other bills, edit or cancel, and no last purchase prices.
// Same harness as non-gst-cleanup.test.ts — needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "purchases-store-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const COMPANY = 800000 + Math.floor(Math.random() * 90000);
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

const bill = (productId: number, vendorId: number) => ({
  billType: "non_gst", billDate: "2026-02-01", vendorId, placeOfSupply: "Maharashtra",
  items: [{ productId, qty: 10, unit: "QTY", rate: 100 }],
});

async function upload(who: string, purchaseId: number) {
  const form = new FormData();
  // 1x1 transparent PNG — the upload accepts only JPG, PNG or PDF.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  form.append("files", new Blob([png], { type: "image/png" }), "bill.png");
  const res = await fetch(`${base}/api/purchases/${purchaseId}/attachments`, { method: "POST", headers: { cookie: cookies[who] }, body: form });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [COMPANY, `Store Test ${COMPANY}`]);
  for (const role of ["admin", "store"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-${COMPANY}`, role, role, COMPANY],
    );
    ids[role] = u.rows[0].id;
    cookies[role] = sessionCookie({ userId: u.rows[0].id, username: `${role}-${COMPANY}`, role, name: role, entityId: null, companyId: COMPANY });
  }
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil', 'Oil', 'T', $2, 'QTY', 100) RETURNING id`,
    [COMPANY, `OIL-${COMPANY}`],
  )).rows[0].id;
  ids.vendor = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'V', '1') RETURNING id`, [COMPANY])).rows[0].id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("store can enter a new purchase bill and attach a file to it", async () => {
  const created = await call("store", "POST", "/purchases", bill(ids.product, ids.vendor));
  assert.ok(created.status < 300, JSON.stringify(created.body));
  ids.storeBill = created.body.id;
  const up = await upload("store", ids.storeBill);
  assert.ok(up.status < 300, JSON.stringify(up.body));
  const list = await call("store", "GET", `/purchases/${ids.storeBill}/attachments`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
});

test("store cannot see Purchase History, the report, or open, edit or cancel a bill", async () => {
  ids.adminBill = (await call("admin", "POST", "/purchases", bill(ids.product, ids.vendor))).body.id;
  assert.equal((await call("store", "GET", "/purchases")).status, 403);
  assert.equal((await call("store", "GET", "/purchases/report")).status, 403);
  assert.equal((await call("store", "GET", `/purchases/${ids.storeBill}`)).status, 403);
  assert.equal((await call("store", "PUT", `/purchases/${ids.storeBill}`, bill(ids.product, ids.vendor))).status, 403);
  assert.equal((await call("store", "DELETE", `/purchases/${ids.storeBill}`)).status, 403);
  // Admin still sees everything.
  const all = await call("admin", "GET", "/purchases");
  assert.equal(all.status, 200);
  assert.ok(all.body.some((p: any) => p.id === ids.storeBill) && all.body.some((p: any) => p.id === ids.adminBill));
});

test("store cannot touch attachments of bills someone else entered", async () => {
  assert.ok((await upload("admin", ids.adminBill)).status < 300);
  assert.deepEqual((await call("store", "GET", `/purchases/${ids.adminBill}/attachments`)).body, []);
  assert.equal((await upload("store", ids.adminBill)).status, 404);
  const att = (await call("admin", "GET", `/purchases/${ids.adminBill}/attachments`)).body[0];
  assert.equal((await call("store", "GET", `/purchases/attachments/${att.id}/file`)).status, 404);
  assert.equal((await call("store", "DELETE", `/purchases/attachments/${att.id}`)).status, 404);
  assert.equal((await call("admin", "GET", `/purchases/${ids.adminBill}/attachments`)).body.length, 1);
});

test("store gets no last purchase prices", async () => {
  const s = await call("store", "GET", `/products/${ids.product}/recent-prices`);
  assert.deepEqual(s.body.lastPurchasePrices, []);
  const a = await call("admin", "GET", `/products/${ids.product}/recent-prices`);
  assert.ok(a.body.lastPurchasePrices.length > 0);
});
