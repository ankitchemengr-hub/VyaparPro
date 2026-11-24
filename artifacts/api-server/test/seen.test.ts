// Menu badge "seen" marks: per user, never move backwards. Needs TEST_DATABASE_URL.
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
process.env.SESSION_SECRET = "seen-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const cookies: Record<string, string> = {};

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}
async function call(who: string | null, method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
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
  const c = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Seen ${RUN}`]);
  for (const n of ["a", "b"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'admin', 'admin', $2, true) RETURNING id`,
      [`seen-${n}-${RUN}`, c.rows[0].id],
    );
    cookies[n] = sessionCookie({ userId: u.rows[0].id, username: `seen-${n}-${RUN}`, role: "admin", name: "admin", entityId: null, companyId: c.rows[0].id });
  }
});
after(async () => { server?.close(); await pool?.end(); });

test("seen marks are per user and never go backwards", async () => {
  assert.deepEqual((await call("a", "GET", "/seen")).body, { orders: null, customers: null });
  assert.equal((await call("a", "PUT", "/seen/orders", { lastId: 40 })).body.lastId, 40);
  assert.equal((await call("a", "PUT", "/seen/orders", { lastId: 10 })).body.lastId, 40, "older mark ignored");
  assert.deepEqual((await call("a", "GET", "/seen")).body, { orders: 40, customers: null });
  assert.deepEqual((await call("b", "GET", "/seen")).body, { orders: null, customers: null }, "other user unaffected");
  assert.equal((await call("a", "PUT", "/seen/bogus", { lastId: 1 })).status, 400);
  assert.equal((await call(null, "GET", "/seen")).status, 401);
});
