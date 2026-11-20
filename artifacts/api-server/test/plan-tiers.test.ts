// Subscription packages: Silver / Gold / Diamond / Platinum decide which
// features and logins a company has; the server refuses the rest.
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
process.env.SESSION_SECRET = "plan-tiers-test-secret";
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
const co: Record<string, number> = {};

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
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function company(key: string, planTier: string | null) {
  const c = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Tier ${key} ${RUN}`]);
  co[key] = c.rows[0].id;
  if (planTier) {
    await pool.query(
      `INSERT INTO subscriptions (company_id, plan_name, plan_tier, subscription_start_date, subscription_end_date, subscription_amount, payment_status, subscription_status)
       VALUES ($1, 'monthly', $2, NOW(), NOW() + INTERVAL '30 days', '0', 'paid', 'active')`,
      [co[key], planTier],
    );
  }
  for (const role of ["admin", "salesman"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${key}-${role}-${RUN}`, role, role, co[key]],
    );
    cookies[`${key}-${role}`] = sessionCookie({ userId: u.rows[0].id, username: `${key}-${role}-${RUN}`, role, name: role, entityId: null, companyId: co[key] });
  }
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { ensurePricingSchema } = await import("../src/lib/plan-pricing");
  await ensurePricingSchema();
  await company("silver", "silver");
  await company("gold", "gold");
  await company("diamond", "diamond");
  await company("old", "business");
  await company("none", null);
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("the four packages are on sale with their prices; old plans are hidden", async () => {
  const plans = (await call(null, "GET", "/portal/plans")).body;
  const slugs = plans.map((p: any) => p.slug);
  for (const s of ["silver", "gold", "diamond", "platinum"]) assert.ok(slugs.includes(s), s);
  for (const s of ["starter", "business", "professional", "enterprise"]) assert.ok(!slugs.includes(s), s);
  const silver = plans.find((p: any) => p.slug === "silver");
  assert.equal(silver.priceMonthly, 500);
  assert.equal(silver.yearlyPrice, 5000);
  const q = (await call(null, "POST", "/portal/quote", { planSlug: "silver", billingCycle: "yearly" })).body;
  assert.equal(q.total, 5000, "yearly is exactly the GST-inclusive yearly price");
  const m = (await call(null, "POST", "/portal/quote", { planSlug: "gold", billingCycle: "monthly" })).body;
  assert.equal(m.total, 826, "₹700 + 18% GST");
});

test("Silver: only Silver features; Gold extras and manufacturing refused", async () => {
  const me = (await call("silver-admin", "GET", "/my-plan")).body;
  assert.equal(me.tier, "silver");
  assert.deepEqual(me.features, []);
  for (const p of ["/supplier-settle", "/stock-investment", "/workers", "/reward-schemes", "/books/trial-balance?from=2026-01-01&to=2026-01-31", "/boms", "/commissions/settings", "/customer-follow-ups"]) {
    const r = await call("silver-admin", "GET", p);
    assert.equal(r.status, 403, p);
    assert.equal(r.body.code, "PLAN_FEATURE", p);
  }
  assert.notEqual((await call("silver-admin", "GET", "/khatabook?type=customer")).status, 403);
  // GSTR-1 is in every package.
  assert.notEqual((await call("silver-admin", "GET", "/books/gstr1?from=2026-01-01&to=2026-01-31")).status, 403);
  assert.notEqual((await call("silver-admin", "GET", "/payments")).status, 403);
  // A salesman login isn't part of Silver.
  const s = await call("silver-salesman", "GET", "/products");
  assert.equal(s.status, 403);
  assert.equal(s.body.code, "PLAN_ROLE");
});

test("Silver users page: no salesman / store logins, and at most 3 staff logins", async () => {
  const bad = await call("silver-admin", "POST", "/users", { username: `s-sales-${RUN}`, password: "secret123", name: "S", role: "salesman" });
  assert.equal(bad.status, 403);
  // admin + salesman (made directly in the DB above) already count as 2.
  const ok = await call("silver-admin", "POST", "/users", { username: `s-acc-${RUN}`, password: "secret123", name: "A", role: "accountant" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const over = await call("silver-admin", "POST", "/users", { username: `s-acc2-${RUN}`, password: "secret123", name: "B", role: "accountant" });
  assert.equal(over.status, 403);
  assert.match(over.body.error, /allows 3 staff logins/);
  const cust = await call("silver-admin", "POST", "/users", { username: `s-cust-${RUN}`, password: "secret123", name: "C", role: "customer" });
  assert.equal(cust.status, 201, "customer logins don't count");
});

test("Gold has the extras but no manufacturing; Diamond has manufacturing but no Gold extras", async () => {
  assert.notEqual((await call("gold-admin", "GET", "/supplier-settle")).status, 403);
  assert.notEqual((await call("gold-salesman", "GET", "/products")).status, 403, "salesman login allowed in Gold");
  assert.equal((await call("gold-admin", "GET", "/boms")).status, 403);
  assert.notEqual((await call("diamond-admin", "GET", "/boms")).status, 403);
  assert.equal((await call("diamond-admin", "GET", "/supplier-settle")).status, 403);
});

test("an old plan or no subscription keeps everything (Platinum)", async () => {
  for (const k of ["old", "none"]) {
    assert.equal((await call(`${k}-admin`, "GET", "/my-plan")).body.tier, "platinum", k);
    assert.notEqual((await call(`${k}-admin`, "GET", "/supplier-settle")).status, 403, k);
    assert.notEqual((await call(`${k}-admin`, "GET", "/boms")).status, 403, k);
  }
});

test("the platform owner moves a company to another package and it applies at once", async () => {
  const su = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'super', 'super_admin', NULL, true) RETURNING id`,
    [`tier-super-${RUN}`],
  );
  cookies.super = sessionCookie({ userId: su.rows[0].id, username: `tier-super-${RUN}`, role: "super_admin", name: "super", entityId: null, companyId: null });
  const { rows: [sub] } = await pool.query(`SELECT id FROM subscriptions WHERE company_id = $1`, [co.silver]);
  assert.equal((await call("silver-admin", "PUT", `/platform-pricing/subscriptions/${sub.id}/package`, { tier: "gold" })).status, 403);
  assert.equal((await call("super", "PUT", `/platform-pricing/subscriptions/${sub.id}/package`, { tier: "bronze" })).status, 400);
  const r = await call("super", "PUT", `/platform-pricing/subscriptions/${sub.id}/package`, { tier: "gold" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await call("silver-admin", "GET", "/my-plan")).body.tier, "gold");
  assert.notEqual((await call("silver-admin", "GET", "/supplier-settle")).status, 403);
  const list = (await call("super", "GET", "/subscriptions")).body;
  const rows = Array.isArray(list) ? list : list.subscriptions ?? list.rows ?? [];
  assert.equal(rows.find((x: any) => x.id === sub.id)?.planTier, "gold");
});
