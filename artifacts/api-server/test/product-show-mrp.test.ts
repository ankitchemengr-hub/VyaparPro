// Product → "Show MRP on invoice print": saved on create and edit, and
// returned with the product so the printed bill can add an MRP column.
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
process.env.SESSION_SECRET = "product-show-mrp-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 900000 + RUN;
let cookie = "";

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function ok(method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  assert.ok(res.status < 300, `${method} ${p} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `MRP Test ${RUN}`]);
  const u = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'admin', 'admin', $2, true) RETURNING id`,
    [`admin-mrp-${RUN}`, A],
  );
  cookie = sessionCookie({ userId: u.rows[0].id, username: `admin-mrp-${RUN}`, role: "admin", name: "admin", entityId: null, companyId: A });
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("show-MRP tick is saved on create, changed on edit, and listed", async () => {
  const base = { group: "Oil", brand: "T", unit: "QTY", purchasePrice: 100, retailPrice: 150, wholesalePrice: 140, mrp: 180 };
  const ticked = await ok("POST", "/products", { ...base, name: "Ticked", itemCode: `T-${RUN}`, showMrpOnInvoice: true });
  const plain = await ok("POST", "/products", { ...base, name: "Plain", itemCode: `P-${RUN}` });
  assert.equal(ticked.showMrpOnInvoice, true);
  assert.equal(plain.showMrpOnInvoice, false, "off unless ticked");

  const list = await ok("GET", "/products");
  assert.equal(list.find((p: any) => p.id === ticked.id).showMrpOnInvoice, true);
  assert.equal(list.find((p: any) => p.id === plain.id).showMrpOnInvoice, false);

  const edited = await ok("PATCH", `/products/${ticked.id}`, { showMrpOnInvoice: false });
  assert.equal(edited.showMrpOnInvoice, false);
  const other = await ok("PATCH", `/products/${plain.id}`, { retailPrice: 155 });
  assert.equal(other.showMrpOnInvoice, false, "an unrelated edit leaves it alone");
});
