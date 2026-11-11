// Plans & Offers: the super admin edits plan prices, runs an offer, sets
// discounts for longer billing cycles and makes coupon codes; the public
// quote / plans endpoints and the payment use exactly those numbers.
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
process.env.SESSION_SECRET = "plan-offers-test-secret";
process.env.RAZORPAY_KEY_SECRET = "plan-offers-test-razorpay";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const SLUG = `po-plan-${RUN}`;
const cookies: Record<string, string> = {};
let planId = 0;
let original: { price: number; cycle: any } | null = null;

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
async function ok(who: string | null, method: string, p: string, body?: unknown) {
  const r = await call(who, method, p, body);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const quote = (body: object) => call(null, "POST", "/portal/quote", { planSlug: SLUG, ...body });

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const su = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'super', 'super_admin', NULL, true) RETURNING id`,
    [`po-super-${RUN}`],
  );
  cookies.super = sessionCookie({ userId: su.rows[0].id, username: `po-super-${RUN}`, role: "super_admin", name: "super", entityId: null, companyId: null });
  const co = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`PO Co ${RUN}`]);
  const ad = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'admin', 'admin', $2, true) RETURNING id`,
    [`po-admin-${RUN}`, co.rows[0].id],
  );
  cookies.admin = sessionCookie({ userId: ad.rows[0].id, username: `po-admin-${RUN}`, role: "admin", name: "admin", entityId: null, companyId: co.rows[0].id });
  planId = (await pool.query(
    `INSERT INTO subscription_plans (slug, name, price_monthly, trial_days, sort_order) VALUES ($1, 'PO Plan', 1000, 0, 999) RETURNING id`,
    [SLUG],
  )).rows[0].id;
  // The cycle discounts are one shared row — put them back afterwards.
  const { getCycleDiscounts } = await import("../src/lib/plan-pricing");
  original = { price: 1000, cycle: await getCycleDiscounts() };
});

after(async () => {
  if (original) {
    await pool?.query(`UPDATE platform_pricing SET quarterly_pct = $1, half_yearly_pct = $2, yearly_pct = $3 WHERE id = 1`,
      [original.cycle.quarterly, original.cycle.half_yearly, original.cycle.yearly]);
  }
  await pool?.query(`UPDATE subscription_plans SET is_active = false WHERE slug = $1`, [SLUG]);
  server?.close();
  await pool?.end();
});

const planBody = (over: object = {}) => ({
  name: "PO Plan", tagline: "Test", priceMonthly: 1000, trialDays: 0, maxUsers: 5, maxCompanies: 1,
  features: ["GST billing", "Inventory"], isActive: true, offerPrice: null, offerLabel: null, offerEndsAt: null, ...over,
});

test("only the super admin can open or change Plans & Offers", async () => {
  assert.equal((await call("admin", "GET", "/platform-pricing")).status, 403);
  assert.equal((await call("admin", "PUT", `/platform-pricing/plans/${planId}`, planBody({ priceMonthly: 1 }))).status, 403);
  assert.equal((await call(null, "GET", "/platform-pricing")).status, 401);
  const all = await ok("super", "GET", "/platform-pricing");
  assert.ok(all.plans.some((p: any) => p.slug === SLUG));
});

test("a plan's price and offer change what the website shows and what is charged", async () => {
  await ok("super", "PUT", `/platform-pricing/plans/${planId}`, planBody({ priceMonthly: 1200 }));
  let q = (await quote({ billingCycle: "monthly" })).body;
  assert.equal(q.taxable, 1200);
  assert.equal(q.gst, 216);
  assert.equal(q.total, 1416);

  const ends = new Date(Date.now() + 7 * 86400000).toISOString();
  await ok("super", "PUT", `/platform-pricing/plans/${planId}`, planBody({ priceMonthly: 1200, offerPrice: 900, offerLabel: "Diwali Offer", offerEndsAt: ends }));
  const plans = await ok(null, "GET", "/portal/plans");
  const p = plans.find((x: any) => x.slug === SLUG);
  assert.equal(p.priceMonthly, 1200);
  assert.equal(p.offer.price, 900);
  assert.equal(p.offer.label, "Diwali Offer");
  q = (await quote({ billingCycle: "monthly" })).body;
  assert.equal(q.taxable, 900);
  assert.equal(q.offerDiscount, 300);

  // Bad offers are refused.
  assert.equal((await call("super", "PUT", `/platform-pricing/plans/${planId}`, planBody({ priceMonthly: 1200, offerPrice: 1300 }))).status, 400);
  assert.equal((await call("super", "PUT", `/platform-pricing/plans/${planId}`, planBody({ priceMonthly: 1200, offerPrice: 900, offerEndsAt: "2020-01-01" }))).status, 400);
});

test("an offer whose end date has passed stops by itself", async () => {
  await pool.query(`UPDATE subscription_plans SET offer_ends_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [planId]);
  const p = (await ok(null, "GET", "/portal/plans")).find((x: any) => x.slug === SLUG);
  assert.equal(p.offer, null);
  assert.equal((await quote({ billingCycle: "monthly" })).body.taxable, 1200);
  await ok("super", "PUT", `/platform-pricing/plans/${planId}`, planBody({ priceMonthly: 1000 }));
});

test("paying for 3 / 6 / 12 months at once gets the cycle discount", async () => {
  await ok("super", "PUT", "/platform-pricing/cycle-discounts", { quarterly: 5, half_yearly: 10, yearly: 20 });
  const q3 = (await quote({ billingCycle: "quarterly" })).body;
  assert.equal(q3.listAmount, 3000);
  assert.equal(q3.cycleDiscount, 150);
  assert.equal(q3.taxable, 2850);
  const q12 = (await quote({ billingCycle: "yearly" })).body;
  assert.equal(q12.taxable, 9600);
  assert.equal(q12.totalDiscount, 2400);
  assert.equal((await call("super", "PUT", "/platform-pricing/cycle-discounts", { yearly: 95 })).status, 400);
});

test("coupon codes: percent, flat, plan-only, expiry and use limit", async () => {
  const pct = await ok("super", "POST", "/platform-pricing/coupons", { code: `new${RUN}`, kind: "percent", value: 10, maxUses: 1 });
  assert.equal(pct.code, `NEW${RUN}`);
  let q = (await quote({ billingCycle: "monthly", couponCode: ` new${RUN} ` })).body;
  assert.equal(q.coupon.discount, 100);
  assert.equal(q.taxable, 900);

  await ok("super", "POST", "/platform-pricing/coupons", { code: `FLAT${RUN}`, kind: "flat", value: 5000 });
  q = (await quote({ billingCycle: "monthly", couponCode: `FLAT${RUN}` })).body;
  assert.equal(q.taxable, 1, "a flat coupon never takes the price below ₹1");

  await ok("super", "POST", "/platform-pricing/coupons", { code: `ONLY${RUN}`, kind: "percent", value: 10, planSlugs: ["some-other-plan"] });
  let bad = await quote({ billingCycle: "monthly", couponCode: `ONLY${RUN}` });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not valid for the selected plan/);

  bad = await quote({ billingCycle: "monthly", couponCode: "NOSUCHCODE" });
  assert.equal(bad.status, 400);

  const exp = await ok("super", "POST", "/platform-pricing/coupons", { code: `OLD${RUN}`, kind: "percent", value: 10 });
  await pool.query(`UPDATE subscription_coupons SET valid_until = NOW() - INTERVAL '1 day' WHERE id = $1`, [exp.id]);
  assert.match((await quote({ billingCycle: "monthly", couponCode: `OLD${RUN}` })).body.error, /expired/);

  const off = await ok("super", "PATCH", `/platform-pricing/coupons/${exp.id}`, { isActive: false });
  assert.equal(off.isActive, false);
  assert.equal((await call("super", "POST", "/platform-pricing/coupons", { code: `NEW${RUN}`, kind: "percent", value: 5 })).status, 400, "duplicate code");
});

test("a paid order with a coupon counts the use once; a used-up coupon is refused", async () => {
  const code = `NEW${RUN}`;
  const co = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`PO Pay ${RUN}`]);
  const sub = await pool.query(
    `INSERT INTO subscriptions (company_id, plan_name, plan_tier, subscription_start_date, subscription_end_date, subscription_amount, payment_status, subscription_status)
     VALUES ($1, 'monthly', $2, NOW(), NOW() + INTERVAL '1 day', '0', 'pending', 'suspended') RETURNING id`,
    [co.rows[0].id, SLUG],
  );
  const orderId = `order_po_${RUN}`;
  await pool.query(
    `INSERT INTO subscription_payments (company_id, subscription_id, plan_tier, billing_cycle, amount, razorpay_order_id, status, taxable_amount, gst_amount, coupon_code)
     VALUES ($1, $2, $3, 'monthly', '1062', $4, 'pending', '900', '162', $5)`,
    [co.rows[0].id, sub.rows[0].id, SLUG, orderId, code],
  );
  const paymentId = `pay_po_${RUN}`;
  const sig = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest("hex");
  const body = { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sig };
  await ok(null, "POST", "/portal/payments/verify", body);
  await ok(null, "POST", "/portal/payments/verify", body); // re-sent verify: no second count
  const used = (await pool.query(`SELECT used_count FROM subscription_coupons WHERE code = $1`, [code])).rows[0].used_count;
  assert.equal(used, 1);
  // A never-paid signup's first payment buys one month from today, not from
  // the end date set at registration.
  const end = new Date((await pool.query(`SELECT subscription_end_date FROM subscriptions WHERE id = $1`, [sub.rows[0].id])).rows[0].subscription_end_date);
  const days = (end.getTime() - Date.now()) / 86400000;
  assert.ok(days > 27 && days < 32, `one month from now, got ${days.toFixed(1)} days`);
  const r = await quote({ billingCycle: "monthly", couponCode: code });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /fully used/);

  const id = (await pool.query(`SELECT id FROM subscription_coupons WHERE code = $1`, [code])).rows[0].id;
  assert.equal((await call("super", "DELETE", `/platform-pricing/coupons/${id}`)).status, 400, "a used coupon can't be deleted");
});
