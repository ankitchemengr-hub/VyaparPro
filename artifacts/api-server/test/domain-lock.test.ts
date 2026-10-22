// A customer's own domain serves only that company: a session from any other
// company is refused (and signed out) on it. Also: the public company list is
// empty in SaaS mode, and the session cookie is Secure over HTTPS.
// Same harness as the other tests — needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "domain-lock-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 700000 + RUN * 2;
const B = A + 1;
const DOMAIN_A = `erp-${RUN}.abc-test.com`;
const cookies: Record<string, string> = {};

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function get(who: string | null, p: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + "/api" + p, { headers: { ...(who ? { cookie: cookies[who] } : {}), ...headers } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, setCookie: res.headers.get("set-cookie") ?? "" };
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Domain Test ${tag} ${RUN}`]);
    await pool.query(
      `INSERT INTO subscriptions (company_id, plan_name, subscription_start_date, subscription_end_date, subscription_amount, payment_status, subscription_status)
       VALUES ($1, 'monthly', NOW(), NOW() + INTERVAL '30 days', 0, 'paid', 'active')`,
      [cid],
    );
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, 'admin', $3, true) RETURNING id`,
      [`admin-${tag}-${RUN}`, `admin ${tag}`, cid],
    );
    cookies[tag] = sessionCookie({ userId: u.rows[0].id, username: `admin-${tag}-${RUN}`, role: "admin", name: `admin ${tag}`, entityId: null, companyId: cid });
  }
  await pool.query(`INSERT INTO company_domains (company_id, domain, status) VALUES ($1, $2, 'active')`, [A, DOMAIN_A]);

  // Real passwords for the login tests, plus one username that exists in
  // both companies with the same password.
  const { hashPassword } = await import("../src/lib/password");
  await pool.query(`UPDATE users SET password_hash = $1 WHERE company_id IN ($2, $3)`, [hashPassword(PASSWORD), A, B]);
  for (const cid of [A, B]) {
    await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, $2, 'shared staff', 'store', $3, true)`,
      [`staff-${RUN}`, hashPassword(PASSWORD), cid],
    );
  }
});

const PASSWORD = "Domain-Lock-Test-1";

async function login(username: string, host?: string) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", ...(host ? { "x-forwarded-host": host } : {}) },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

after(async () => {
  server?.close();
  await pool?.end();
});

test("on a company's own domain, its users get their data", async () => {
  const r = await get("A", "/dashboard/summary", { "x-forwarded-host": DOMAIN_A });
  assert.equal(r.status, 200);
});

test("on a company's own domain, another company's session is refused and signed out", async () => {
  const r = await get("B", "/dashboard/summary", { "x-forwarded-host": DOMAIN_A });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /another company/);
  assert.match(r.setCookie, /session=;/, "session cookie must be cleared");
  // Host header casing / port / trailing dot don't get around it.
  const r2 = await get("B", "/dashboard/summary", { "x-forwarded-host": `${DOMAIN_A.toUpperCase()}.:443` });
  assert.equal(r2.status, 403);
});

test("on the shared ERP link, every company still works as before", async () => {
  assert.equal((await get("A", "/dashboard/summary", { "x-forwarded-host": "app.shared-erp.test" })).status, 200);
  assert.equal((await get("B", "/dashboard/summary", { "x-forwarded-host": "app.shared-erp.test" })).status, 200);
  assert.equal((await get("B", "/dashboard/summary")).status, 200);
});

test("the login page no longer lists other customers' companies", async () => {
  const r = await get(null, "/system/companies-public");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);
  const cfg = await get(null, "/system/config", { "x-forwarded-host": DOMAIN_A });
  assert.equal(cfg.body.company?.id, A, "own domain still shows its own branding");
});

test("session cookie is Secure over HTTPS and stays usable over plain HTTP", async () => {
  const https = await get("A", "/dashboard/summary", { "x-forwarded-proto": "https" });
  assert.match(https.setCookie, /;\s*Secure/i);
  const http = await get("A", "/dashboard/summary");
  assert.ok(http.setCookie.includes("session=") && !/;\s*Secure/i.test(http.setCookie));
});

test("login on a company's own domain: its own user gets in", async () => {
  const r = await login(`admin-A-${RUN}`, DOMAIN_A);
  assert.equal(r.status, 200);
  assert.equal(r.body.companyId, A);
});

test("login on a company's own domain: another company's user is refused at login", async () => {
  const r = await login(`admin-B-${RUN}`, DOMAIN_A);
  assert.equal(r.status, 403);
  assert.match(r.body.error, /another company/);
});

test("login on a company's own domain picks that company's account for a shared username", async () => {
  const r = await login(`staff-${RUN}`, DOMAIN_A);
  assert.equal(r.status, 200, "own domain decides which same-named account signs in");
  assert.equal(r.body.companyId, A);
  // On the shared link the same username + password stays ambiguous.
  assert.equal((await login(`staff-${RUN}`, "app.shared-erp.test")).status, 409);
});

test("login on the shared ERP link works for every company as before", async () => {
  assert.equal((await login(`admin-A-${RUN}`, "app.shared-erp.test")).status, 200);
  assert.equal((await login(`admin-B-${RUN}`)).status, 200);
});
