// Product barcode and part no. (Inventory product form): saved, searchable,
// a barcode on one product only, and clearable. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "bc-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 650000 + RUN;
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
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Barcode Test ${RUN}`]);
  const u = await one(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'bc admin', 'admin', $2, true) RETURNING id`,
    [`admin-bc-${RUN}`, A],
  );
  cookie = sessionCookie({ userId: u.id, username: `admin-bc-${RUN}`, role: "admin", name: "bc admin", entityId: null, companyId: A });
});

after(async () => {
  server?.close();
  await pool?.end();
});

const product = (extra: object) => ({
  group: "Spares", brand: "Honda", unit: "PCS", purchasePrice: 100, retailPrice: 150, wholesalePrice: 140, mrp: 160, ...extra,
});

test("barcode and part no. are saved and found by search", async () => {
  const a = await call("POST", "/products", product({ name: "Air Filter", itemCode: `AF-${RUN}`, barcode: "  8901234567890 ", partNo: "17210-K44-V00" }));
  assert.equal(a.status, 201, JSON.stringify(a.body).slice(0, 300));
  assert.equal(a.body.barcode, "8901234567890", "trimmed");
  assert.equal(a.body.partNo, "17210-K44-V00");
  ids.a = a.body.id;

  const blank = await call("POST", "/products", product({ name: "Brake Shoe", itemCode: `BS-${RUN}`, barcode: "", partNo: "  " }));
  assert.equal(blank.status, 201, JSON.stringify(blank.body));
  assert.equal(blank.body.barcode, null, "empty barcode is stored as none");
  assert.equal(blank.body.partNo, null);
  ids.b = blank.body.id;

  const byBarcode = await call("GET", "/products?search=8901234567890");
  assert.deepEqual(byBarcode.body.map((p: any) => p.id), [ids.a]);
  const byPart = await call("GET", "/products?search=K44");
  assert.deepEqual(byPart.body.map((p: any) => p.id), [ids.a]);
});

test("a barcode can be on one product only", async () => {
  const dup = await call("POST", "/products", product({ name: "Air Filter Copy", itemCode: `AF2-${RUN}`, barcode: "8901234567890" }));
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /Barcode "8901234567890"/);

  const dupEdit = await call("PATCH", `/products/${ids.b}`, { barcode: "8901234567890" });
  assert.equal(dupEdit.status, 409);

  // The same part no. on two products is fine (different makes share numbers).
  const samePart = await call("PATCH", `/products/${ids.b}`, { partNo: "17210-K44-V00" });
  assert.equal(samePart.status, 200, JSON.stringify(samePart.body));

  // Clearing it frees the barcode for another product.
  const clear = await call("PATCH", `/products/${ids.a}`, { barcode: null });
  assert.equal(clear.status, 200, JSON.stringify(clear.body));
  assert.equal(clear.body.barcode, null);
  const take = await call("PATCH", `/products/${ids.b}`, { barcode: "8901234567890" });
  assert.equal(take.status, 200, JSON.stringify(take.body));
  assert.equal(take.body.barcode, "8901234567890");
});
