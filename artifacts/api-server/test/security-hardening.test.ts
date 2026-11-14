// Security hardening: role gates on brands / rewards / follow-ups / smart
// order, sessions checked against the users row, the per-username login cap,
// CORS limited to our own sites, security headers and raster-only product
// images. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "security-hardening-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
let passwordVersion: (h: string) => string;
let hashPassword: (p: string) => string;
const RUN = Math.floor(Math.random() * 90000);
const A = 900000 + RUN;
const cookies: Record<string, string> = {};
const users: Record<string, number> = {};
const ids: Record<string, number> = {};

function sign(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(cookie: string | undefined, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}

async function makeUser(role: string, extra: Record<string, unknown> = {}) {
  const name = `${role}-sec-${RUN}-${Object.keys(users).length}`;
  const u = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active, entity_id) VALUES ($1, $2, $3, $4, $5, true, $6) RETURNING id`,
    [name, hashPassword("old-password-1"), role, role, A, extra.entityId ?? null],
  );
  return { id: u.rows[0].id as number, username: name };
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  ({ passwordVersion } = await import("../src/lib/session-guard"));
  ({ hashPassword } = await import("../src/lib/password"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Security Test ${RUN}`]);
  ids.custA = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust A', '91') RETURNING id`, [A])).rows[0].id;
  ids.custB = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust B', '92') RETURNING id`, [A])).rows[0].id;
  for (const role of ["admin", "store", "salesman", "customer"]) {
    const u = await makeUser(role, role === "customer" ? { entityId: ids.custA } : {});
    users[role] = u.id;
    cookies[role] = sign({ userId: u.id, username: u.username, role, name: role, entityId: role === "customer" ? ids.custA : null, companyId: A });
  }
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("role gates: brands, reward schemes, follow-ups and smart order", async () => {
  // Everyone signed in may read brands; only admin/store may change them.
  assert.equal((await call(cookies.customer, "GET", "/brands")).status, 200);
  assert.equal((await call(cookies.customer, "POST", "/brands", { name: `Hack ${RUN}` })).status, 403);
  assert.equal((await call(cookies.salesman, "POST", "/brands", { name: `Hack2 ${RUN}` })).status, 403);
  const brand = await call(cookies.store, "POST", "/brands", { name: `Store Brand ${RUN}` });
  assert.ok(brand.status < 300, JSON.stringify(brand.body));
  assert.equal((await call(cookies.customer, "DELETE", `/brands/${brand.body.id}`)).status, 403);

  // Reward schemes: read for all, write admin only.
  assert.equal((await call(cookies.customer, "GET", "/reward-schemes")).status, 200);
  const scheme = { schemeName: "S", productId: 1, targetLiters: 10, rewardType: "gift", rewardValue: "Bag", startDate: "2026-01-01", endDate: "2026-12-31" };
  assert.equal((await call(cookies.customer, "POST", "/reward-schemes", scheme)).status, 403);
  assert.equal((await call(cookies.salesman, "POST", "/reward-progress/1/disburse")).status, 403);

  // Inactive customers / follow-ups: staff only.
  assert.equal((await call(cookies.customer, "GET", "/customers/inactive")).status, 403);
  assert.equal((await call(cookies.customer, "GET", `/customers/${ids.custB}/follow-ups`)).status, 403);
  assert.equal((await call(cookies.customer, "POST", `/customers/${ids.custB}/remind`, { days: 5 })).status, 403);
  assert.equal((await call(cookies.salesman, "GET", "/customers/inactive")).status, 200);

  // Smart order shows purchase prices: purchase roles only.
  assert.equal((await call(cookies.customer, "GET", "/smart-order/suggestions")).status, 403);
  assert.equal((await call(cookies.salesman, "GET", "/smart-order/suggestions")).status, 403);
  assert.equal((await call(cookies.store, "GET", "/smart-order/suggestions")).status, 200);
});

test("a customer sees only its own reward progress", async () => {
  const product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit) VALUES ($1, 'Oil', 'Oil', 'T', $2, 'QTY') RETURNING id`,
    [A, `RW-${RUN}`],
  )).rows[0].id;
  const s = (await pool.query(
    `INSERT INTO reward_schemes (company_id, scheme_name, product_id, target_liters, reward_type, reward_value, start_date, end_date)
     VALUES ($1, 'S', $2, 10, 'gift', 'Bag', NOW(), NOW() + interval '30 days') RETURNING id`,
    [A, product],
  )).rows[0].id;
  for (const c of [ids.custA, ids.custB]) {
    await pool.query(`INSERT INTO reward_progress (company_id, scheme_id, customer_id, liters_achieved) VALUES ($1, $2, $3, 1)`, [A, s, c]);
  }
  const mine = await call(cookies.customer, "GET", "/reward-progress");
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.map((r: any) => r.customerId), [ids.custA]);
  const asked = await call(cookies.customer, "GET", `/reward-progress?customerId=${ids.custB}`);
  assert.deepEqual(asked.body, [], "asking for another customer returns nothing");
  const admin = await call(cookies.admin, "GET", "/reward-progress");
  assert.equal(admin.body.length, 2);
});

test("sessions end when the user is disabled, its role changes, or the password changes", async () => {
  const u = await makeUser("salesman");
  const s = { userId: u.id, username: u.username, role: "salesman", name: "x", entityId: null, companyId: A };
  const c = sign(s);
  assert.equal((await call(c, "GET", "/brands")).status, 200);

  // An old cookie without pv/iat is accepted and stamped once.
  const first = await call(c, "GET", "/auth/me");
  assert.equal(first.status, 200);
  assert.match(first.headers.get("set-cookie") ?? "", /%22pv%22/);

  await pool.query(`UPDATE users SET role = 'store' WHERE id = $1`, [u.id]);
  const changed = await call(c, "GET", "/brands");
  assert.equal(changed.status, 401, "role changed → signed out");
  assert.match(changed.headers.get("set-cookie") ?? "", /session=;/);
  await pool.query(`UPDATE users SET role = 'salesman' WHERE id = $1`, [u.id]);

  await pool.query(`UPDATE users SET is_active = false WHERE id = $1`, [u.id]);
  assert.equal((await call(c, "GET", "/brands")).status, 401, "disabled → signed out");
  assert.equal((await call(c, "GET", "/auth/me")).status, 401, "/auth/me refuses it too");
  await pool.query(`UPDATE users SET is_active = true WHERE id = $1`, [u.id]);

  const hash = (await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [u.id])).rows[0].password_hash;
  const deviceA = sign({ ...s, iat: Date.now(), pv: passwordVersion(hash) });
  const deviceB = sign({ ...s, iat: Date.now(), pv: passwordVersion(hash) });
  const changedPw = await call(deviceA, "POST", "/auth/change-password", { currentPassword: "old-password-1", newPassword: "new-password-2" });
  assert.equal(changedPw.status, 200, JSON.stringify(changedPw.body));
  const fresh = decodeURIComponent((changedPw.headers.get("set-cookie") ?? "").split(";")[0]);
  assert.ok(fresh.startsWith("session=s:"), "this device gets a new cookie");
  assert.equal((await call(fresh, "GET", "/brands")).status, 200, "the device that changed it stays in");
  assert.equal((await call(deviceB, "GET", "/brands")).status, 401, "other devices are signed out");

  const newHash = (await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [u.id])).rows[0].password_hash;
  const old = sign({ ...s, iat: Date.now() - 8 * 24 * 60 * 60 * 1000, pv: passwordVersion(newHash) });
  assert.equal((await call(old, "GET", "/brands")).status, 401, "older than 7 days → sign in again");

  const otherCompany = sign({ ...s, companyId: A + 1, iat: Date.now(), pv: passwordVersion(newHash) });
  assert.equal((await call(otherCompany, "GET", "/brands")).status, 401, "company mismatch → signed out");
});

test("login limit: a faked IP per try still hits the per-username cap", async () => {
  const { loginRateLimitKey, checkLoginRateLimit, recordLoginFailure, clearLoginAttempts } = await import("../src/lib/login-rate-limit");
  const user = `victim-${RUN}`;
  for (let i = 0; i < 20; i++) {
    const key = loginRateLimitKey(`10.0.${i}.1`, user);
    assert.equal(checkLoginRateLimit(key).blocked, false, `try ${i}`);
    recordLoginFailure(key);
  }
  assert.equal(checkLoginRateLimit(loginRateLimitKey("10.9.9.9", user)).blocked, true, "21st try from a new IP is blocked");
  assert.equal(checkLoginRateLimit(loginRateLimitKey("10.9.9.9", `someone-else-${RUN}`)).blocked, false, "other users unaffected");
  // Same IP + username still stops at 5.
  const pair = loginRateLimitKey("10.1.1.1", `pair-${RUN}`);
  for (let i = 0; i < 5; i++) recordLoginFailure(pair);
  assert.equal(checkLoginRateLimit(pair).blocked, true);
  clearLoginAttempts(pair);
  assert.equal(checkLoginRateLimit(pair).blocked, false);
  // IPv6 addresses contain ":" — the key must still split on the username.
  const v6 = loginRateLimitKey("2001:db8::1", `v6-${RUN}`);
  recordLoginFailure(v6);
  assert.equal(checkLoginRateLimit(loginRateLimitKey("2001:db8::2", `v6-${RUN}`)).blocked, false);
});

test("CORS only for our own sites; foreign writes refused; security headers", async () => {
  const evil = await call(cookies.admin, "GET", "/brands", undefined, { origin: "https://evil.example.com" });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const write = await call(cookies.admin, "POST", "/brands", { name: `Evil ${RUN}` }, { origin: "https://evil.example.com" });
  assert.equal(write.status, 403);
  const nul = await call(cookies.admin, "POST", "/brands", { name: `Null ${RUN}` }, { origin: "null" });
  assert.equal(nul.status, 403);

  for (const origin of ["https://www.shradhaerp.com", "https://app.shradhaerp.com", "http://localhost:5173", base]) {
    const r = await call(cookies.admin, "GET", "/brands", undefined, { origin });
    assert.equal(r.headers.get("access-control-allow-origin"), origin, origin);
  }
  const own = await call(cookies.admin, "POST", "/brands", { name: `Own ${RUN}` }, { origin: "https://www.shradhaerp.com" });
  assert.ok(own.status < 300, JSON.stringify(own.body));
  const lookalike = await call(cookies.admin, "POST", "/brands", { name: `Look ${RUN}` }, { origin: "https://shradhaerp.com.evil.io" });
  assert.equal(lookalike.status, 403);
  // Webhooks / server calls send no Origin and pass through.
  assert.notEqual((await call(undefined, "POST", "/portal/payments/webhook", {})).status, 403);

  const h = (await call(undefined, "GET", "/healthz")).headers;
  assert.equal(h.get("x-powered-by"), null);
  assert.equal(h.get("x-content-type-options"), "nosniff");
  assert.equal(h.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(h.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(h.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
  const https = (await call(undefined, "GET", "/healthz", undefined, { "x-forwarded-proto": "https" })).headers;
  assert.match(https.get("strict-transport-security") ?? "", /max-age=31536000/);
});

test("product images: SVG never served, raster served sandboxed", async () => {
  const svg = "data:image/svg+xml;base64," + Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>").toString("base64");
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const mk = async (img: string, code: string) => (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, image_url) VALUES ($1, $2, 'G', 'B', $2, 'QTY', $3) RETURNING id`,
    [A, `${code}-${RUN}`, img],
  )).rows[0].id;
  const bad = await mk(svg, "SVG");
  const good = await mk(png, "PNG");
  assert.equal((await call(cookies.admin, "GET", `/products/${bad}/image`)).status, 404);
  const r = await fetch(`${base}/api/products/${good}/image`, { headers: { cookie: cookies.admin } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy") ?? "", /sandbox/);
});
