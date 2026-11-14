// The platform owner (super_admin) runs the Platform Console but must never see
// a customer's business data: switching into a company is refused, and an old
// session that had switched in is treated as having no company. Needs
// TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "platform-owner-privacy-test-secret";
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

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Privacy Test ${RUN}`]);
  const admin = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'admin', 'admin', $2, true) RETURNING id`,
    [`admin-priv-${RUN}`, A],
  );
  cookies.admin = sessionCookie({ userId: admin.rows[0].id, username: `admin-priv-${RUN}`, role: "admin", name: "admin", entityId: null, companyId: A });
  const su = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'super', 'super_admin', NULL, true) RETURNING id`,
    [`super-priv-${RUN}`],
  );
  const superSession = { userId: su.rows[0].id, username: `super-priv-${RUN}`, role: "super_admin", name: "super", entityId: null, companyId: null };
  cookies.super = sessionCookie(superSession);
  // A session minted before switching was turned off, still pointing at A.
  cookies.superSwitched = sessionCookie({ ...superSession, activeCompanyId: A });
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("the company's own admin still sees its data", async () => {
  assert.equal((await call("admin", "GET", "/invoices")).status, 200);
});

test("the platform owner cannot switch into a customer's company", async () => {
  const r = await call("super", "POST", "/system/active-company", { companyId: A });
  assert.equal(r.status, 403);
  assert.equal((await call("super", "POST", "/system/active-company", { companyId: null })).status, 200);
});

test("an old switched-in session no longer reaches the company's data", async () => {
  for (const p of ["/invoices", "/entities", "/products", "/purchases"]) {
    assert.equal((await call("superSwitched", "GET", p)).status, 403, p);
  }
  const me = await call("superSwitched", "GET", "/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.activeCompanyId, null);
  assert.equal(me.body.company, null);
});

test("the Platform Console itself still works", async () => {
  const r = await call("super", "GET", "/subscriptions/dashboard");
  assert.equal(r.status, 200);
  assert.ok(r.body.totalCompanies >= 1);
});
