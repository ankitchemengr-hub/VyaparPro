// Refer & Earn: a customer's code links a new signup, the new business gets
// its first-payment discount, its first real payment earns the referrer a
// cash reward, and the super admin pays or rejects it.
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
process.env.SESSION_SECRET = "referrals-test-secret";
process.env.RAZORPAY_KEY_SECRET = "referrals-test-razorpay";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const SLUG = `rf-plan-${RUN}`;
const cookies: Record<string, string> = {};
let referrerCompany = 0;
let original: any = null;

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

async function adminOf(name: string, extra: { mobile?: string; gstin?: string } = {}) {
  const co = await pool.query(`INSERT INTO companies (name, mobile) VALUES ($1, $2) RETURNING id`, [name, extra.mobile ?? null]);
  if (extra.gstin) await pool.query(`UPDATE companies SET gstin = $1 WHERE id = $2`, [extra.gstin, co.rows[0].id]);
  const u = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'admin', 'admin', $2, true) RETURNING id`,
    [`rf-${name}-${RUN}`, co.rows[0].id],
  );
  return { companyId: co.rows[0].id as number, cookie: sessionCookie({ userId: u.rows[0].id, username: `rf-${name}-${RUN}`, role: "admin", name: "admin", entityId: null, companyId: co.rows[0].id }) };
}

const mobile = (n: number) => `9${String(RUN).padStart(5, "0")}${String(n).padStart(4, "0")}`;
const register = (n: number, referralCode: string, gstin?: string) => call(null, "POST", "/portal/register", {
  businessName: `RF New ${n} ${RUN}`, ownerName: "Owner", mobile: mobile(n), email: `rf${n}-${RUN}@example.com`,
  password: "password123", planSlug: SLUG, billingCycle: "monthly", referralCode, ...(gstin ? { gstin } : {}),
});

async function pay(companyId: number, n: number, taxable: number) {
  const { rows: [sub] } = await pool.query(`SELECT id FROM subscriptions WHERE company_id = $1`, [companyId]);
  const orderId = `order_rf_${RUN}_${n}`;
  await pool.query(
    `INSERT INTO subscription_payments (company_id, subscription_id, plan_tier, billing_cycle, amount, razorpay_order_id, status, taxable_amount, gst_amount)
     VALUES ($1, $2, $3, 'monthly', $4, $5, 'pending', $6, $7)`,
    [companyId, sub.id, SLUG, String(taxable * 1.18), orderId, String(taxable), String(taxable * 0.18)],
  );
  const paymentId = `pay_rf_${RUN}_${n}`;
  const sig = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!).update(`${orderId}|${paymentId}`).digest("hex");
  const body = { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: sig };
  await ok(null, "POST", "/portal/payments/verify", body);
  await ok(null, "POST", "/portal/payments/verify", body); // re-sent: no second reward
}

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
    [`rf-super-${RUN}`],
  );
  cookies.super = sessionCookie({ userId: su.rows[0].id, username: `rf-super-${RUN}`, role: "super_admin", name: "super", entityId: null, companyId: null });
  await (await import("../src/lib/subscription-invoice")).ensureSubscriptionInvoiceSchema();
  const ref = await adminOf("referrer", { mobile: mobile(9000), gstin: `27AAAAA${String(RUN).padStart(4, "0").slice(-4)}A1Z5` });
  referrerCompany = ref.companyId;
  cookies.referrer = ref.cookie;
  cookies.other = (await adminOf("other")).cookie;
  await pool.query(
    `INSERT INTO subscription_plans (slug, name, price_monthly, trial_days, sort_order) VALUES ($1, 'RF Plan', 1000, 7, 999)`,
    [SLUG],
  );
  const { getReferralSettings } = await import("../src/lib/referrals");
  original = await getReferralSettings();
});

after(async () => {
  if (original) {
    await pool?.query(
      `UPDATE referral_settings SET is_enabled = $1, reward_kind = $2, reward_value = $3, new_customer_pct = $4, hold_days = $5 WHERE id = 1`,
      [original.isEnabled, original.rewardKind, original.rewardValue, original.newCustomerPct, original.holdDays],
    );
  }
  await pool?.query(`UPDATE subscription_plans SET is_active = false WHERE slug = $1`, [SLUG]);
  server?.close();
  await pool?.end();
});

let code = "";

test("only the super admin sees or changes the referral rules", async () => {
  assert.equal((await call("referrer", "GET", "/platform-pricing/referrals")).status, 403);
  assert.equal((await call("referrer", "PUT", "/platform-pricing/referral-settings", { rewardValue: 1 })).status, 403);
  const s = await ok("super", "PUT", "/platform-pricing/referral-settings", {
    isEnabled: true, rewardKind: "percent", rewardValue: 20, newCustomerPct: 10, holdDays: 7,
  });
  assert.deepEqual(s, { isEnabled: true, rewardKind: "percent", rewardValue: 20, newCustomerPct: 10, holdDays: 7 });
  assert.equal((await call("super", "PUT", "/platform-pricing/referral-settings", { rewardKind: "percent", rewardValue: 150, newCustomerPct: 10, holdDays: 7 })).status, 400);
});

test("each customer gets one code; a public check says if it works", async () => {
  const a = await ok("referrer", "GET", "/portal/referrals");
  assert.match(a.code, /^SHR[A-Z2-9]{5}$/);
  assert.equal((await ok("referrer", "GET", "/portal/referrals")).code, a.code, "same code every time");
  assert.notEqual((await ok("other", "GET", "/portal/referrals")).code, a.code);
  code = a.code;
  assert.deepEqual(await ok(null, "GET", `/portal/referral-code/${code.toLowerCase()}`), { valid: true, newCustomerPct: 10 });
  assert.equal((await ok(null, "GET", "/portal/referral-code/NOPE123")).valid, false);
  assert.equal((await call("referrer", "PUT", "/portal/referrals/upi", { upiId: "not a upi" })).status, 400);
  assert.equal((await ok("referrer", "PUT", "/portal/referrals/upi", { upiId: "shop@okhdfcbank" })).upiId, "shop@okhdfcbank");
  // The signup form previews the new-customer discount for a typed code.
  const q = await ok(null, "POST", "/portal/quote", { planSlug: SLUG, billingCycle: "monthly", referralCode: code });
  assert.deepEqual(q.referral, { pct: 10, discount: 100 });
  assert.equal(q.taxable, 900);
});

test("signup with the code links it; first payment discounted and earns the reward once", async () => {
  assert.equal((await register(1, code.toLowerCase())).status, 201);
  const { rows: [co] } = await pool.query(`SELECT id FROM companies WHERE mobile = $1`, [mobile(1)]);
  const u = await pool.query(`SELECT id FROM users WHERE company_id = $1`, [co.id]);
  cookies.newbie = sessionCookie({ userId: u.rows[0].id, username: "n", role: "admin", name: "n", entityId: null, companyId: co.id });

  // Logged in, the renewal quote carries the discount without typing the code.
  const q = await ok("newbie", "POST", "/portal/quote", { planSlug: SLUG, billingCycle: "monthly" });
  assert.equal(q.referral?.discount, 100);

  let mine = await ok("referrer", "GET", "/portal/referrals");
  assert.equal(mine.referrals.length, 1);
  assert.equal(mine.referrals[0].status, "signed_up");

  await pay(co.id, 1, 900);
  mine = await ok("referrer", "GET", "/portal/referrals");
  assert.equal(mine.referrals[0].status, "earned");
  assert.equal(mine.referrals[0].rewardAmount, 180, "20% of the ₹900 paid before GST");
  assert.equal(mine.totals.due, 180);
  const days = (new Date(mine.referrals[0].payableAfter).getTime() - Date.now()) / 86400000;
  assert.ok(days > 6.9 && days < 7.1);

  // Discount is for the first payment only.
  const q2 = await ok("newbie", "POST", "/portal/quote", { planSlug: SLUG, billingCycle: "monthly" });
  assert.equal(q2.referral, null);
  await pay(co.id, 2, 1000);
  mine = await ok("referrer", "GET", "/portal/referrals");
  assert.equal(mine.referrals[0].rewardAmount, 180, "a second payment earns nothing more");
});

test("the referrer's own GSTIN or a bad code doesn't link; programme off stops new links", async () => {
  const { rows: [r] } = await pool.query(`SELECT gstin FROM companies WHERE id = $1`, [referrerCompany]);
  assert.equal((await register(2, code, r.gstin)).status, 201);
  assert.equal((await register(3, "NOPE123")).status, 201, "a wrong code never blocks signup");
  await ok("super", "PUT", "/platform-pricing/referral-settings", { isEnabled: false, rewardKind: "percent", rewardValue: 20, newCustomerPct: 10, holdDays: 7 });
  assert.equal((await register(4, code)).status, 201);
  assert.equal((await ok(null, "GET", `/portal/referral-code/${code}`)).valid, false);
  await ok("super", "PUT", "/platform-pricing/referral-settings", { isEnabled: true, rewardKind: "percent", rewardValue: 20, newCustomerPct: 10, holdDays: 7 });
  const mine = await ok("referrer", "GET", "/portal/referrals");
  assert.equal(mine.referrals.length, 1);
});

test("super admin pays the reward with a UPI reference, or rejects one", async () => {
  const all = await ok("super", "GET", "/platform-pricing/referrals");
  const row = all.referrals.find((r: any) => r.referrer.companyId === referrerCompany);
  assert.equal(row.referrer.upiId, "shop@okhdfcbank");
  assert.equal((await call("super", "POST", `/platform-pricing/referrals/${row.id}/paid`, {})).status, 400, "needs a reference");
  const paid = await ok("super", "POST", `/platform-pricing/referrals/${row.id}/paid`, { payoutRef: "UTR123456" });
  assert.equal(paid.status, "paid");
  assert.equal((await call("super", "POST", `/platform-pricing/referrals/${row.id}/paid`, { payoutRef: "again" })).status, 400);
  assert.equal((await call("super", "POST", `/platform-pricing/referrals/${row.id}/reject`, { note: "x" })).status, 400, "paid can't be rejected");
  const mine = await ok("referrer", "GET", "/portal/referrals");
  assert.equal(mine.totals.paid, 180);
  assert.equal(mine.totals.due, 0);
});
