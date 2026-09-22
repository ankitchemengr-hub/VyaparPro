import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import {
  CreateDemoRequestBody,
  RegisterPortalCustomerBody,
  CreatePortalPaymentOrderBody,
  VerifyPortalPaymentBody,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/password";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { PLAN_MONTHS, addMonths, daysBetween } from "./subscriptions";

const router: IRouter = Router();

// This router is registered BEFORE the app-wide requireAuth gate (see
// routes/index.ts) because most of its routes are public — the two "my-*"
// routes at the bottom check auth themselves via getCompanyId(req), which
// throws (caught by app.ts's global TenantContextError handler) if there's
// no session, exactly like every other authenticated route in this codebase.

// GET /portal/plans — public pricing-page tiers.
router.get("/portal/plans", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(
    `SELECT id, slug, name, tagline, price_monthly, max_users, max_companies, features, trial_days, is_active
     FROM subscription_plans WHERE is_active = true ORDER BY sort_order ASC`,
  );
  res.json(rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? null,
    priceMonthly: Number(r.price_monthly),
    maxUsers: r.max_users ?? null,
    maxCompanies: r.max_companies ?? null,
    features: r.features ?? [],
    trialDays: r.trial_days,
    isActive: r.is_active,
  })));
});

// GET /portal/faqs — public FAQ accordion content.
router.get("/portal/faqs", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(
    `SELECT id, question, answer FROM faqs WHERE is_active = true ORDER BY sort_order ASC`,
  );
  res.json(rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer })));
});

// POST /portal/demo-requests — "Book a Demo" / contact form.
router.post("/portal/demo-requests", async (req, res): Promise<void> => {
  const parsed = CreateDemoRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  await pool.query(
    `INSERT INTO demo_requests (name, business_name, mobile, email, business_type, num_users, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [d.name, d.businessName ?? null, d.mobile, d.email ?? null, d.businessType ?? null, d.numUsers ?? null, d.message ?? null],
  );
  res.status(201).end();
});

// POST /portal/register — self-serve signup. Mirrors POST /subscriptions/create's
// provisioning (companies row + admin users row + subscriptions row in one
// transaction) so a self-registered tenant is indistinguishable from one the
// platform super_admin created by hand.
//
// subscriptionStatus has no "awaiting payment" value in the existing schema
// (only active/expired/suspended, shared with the platform admin console) —
// a not-yet-paid signup is stored as subscriptionStatus='suspended' +
// paymentStatus='pending' so it can't be mistaken for a fully active tenant,
// and the portal UI reads paymentStatus to show "complete your payment"
// rather than a generic "suspended" message.
router.post("/portal/register", async (req, res): Promise<void> => {
  const parsed = RegisterPortalCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const dupe = await client.query(
      `SELECT c.id FROM companies c
       WHERE ($1::text IS NOT NULL AND lower(c.email) = lower($1)) OR c.mobile = $2`,
      [d.email ?? null, d.mobile],
    );
    if (dupe.rows.length > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "A company with this email or mobile is already registered" });
      return;
    }

    const planRes = await client.query(
      `SELECT * FROM subscription_plans WHERE slug = $1 AND is_active = true`,
      [d.planSlug],
    );
    const plan = planRes.rows[0];
    if (!plan) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Selected plan not found" });
      return;
    }

    const cycle = d.billingCycle ?? "monthly";
    const months = PLAN_MONTHS[cycle] ?? 1;
    const start = new Date();
    const onTrial = Number(plan.trial_days) > 0;
    const end = onTrial
      ? new Date(start.getTime() + Number(plan.trial_days) * 24 * 60 * 60 * 1000)
      : addMonths(start, months);
    const amount = onTrial ? 0 : Number(plan.price_monthly) * months;

    const companyRes = await client.query(
      `INSERT INTO companies (name, owner_name, mobile, email) VALUES ($1, $2, $3, $4) RETURNING id`,
      [d.businessName, d.ownerName, d.mobile, d.email ?? null],
    );
    const companyId = companyRes.rows[0].id;

    const username = (d.email ?? d.mobile).trim().toLowerCase();
    await client.query(
      `INSERT INTO users (username, password_hash, role, name, is_active, company_id)
       VALUES ($1, $2, 'admin', $3, true, $4)`,
      [username, hashPassword(d.password), d.ownerName, companyId],
    );

    const subRes = await client.query(
      `INSERT INTO subscriptions
        (company_id, plan_name, plan_tier, subscription_start_date, subscription_end_date,
         subscription_amount, payment_status, subscription_status, last_payment_date, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $5)
       RETURNING id`,
      [
        companyId, cycle, plan.slug, start, end, String(amount),
        onTrial ? "pending" : "pending",
        onTrial ? "active" : "suspended",
        onTrial ? start : null,
      ],
    );

    await client.query("COMMIT");
    res.status(201).json({ companyId, subscriptionId: subRes.rows[0].id, requiresPayment: !onTrial });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Portal registration failed");
    res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

// POST /portal/payments/create-order — server-side Razorpay order creation.
// The amount is always recomputed here from the plan's stored price, never
// taken from the client, so a tampered request can't buy a cheaper plan.
router.post("/portal/payments/create-order", async (req, res): Promise<void> => {
  const parsed = CreatePortalPaymentOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { subscriptionId, planSlug, billingCycle } = parsed.data;

  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keyId || !keySecret) {
    res.status(500).json({ error: "Payment gateway is not configured" });
    return;
  }

  const subRes = await pool.query(`SELECT id, company_id FROM subscriptions WHERE id = $1`, [subscriptionId]);
  const sub = subRes.rows[0];
  if (!sub) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  const planRes = await pool.query(`SELECT * FROM subscription_plans WHERE slug = $1 AND is_active = true`, [planSlug]);
  const plan = planRes.rows[0];
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  const months = PLAN_MONTHS[billingCycle] ?? 1;
  const amount = Number(plan.price_monthly) * months;
  if (!(amount > 0)) {
    res.status(400).json({ error: "This plan requires custom pricing — please contact sales" });
    return;
  }

  try {
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        notes: { subscriptionId: String(subscriptionId), planSlug, billingCycle },
      }),
    });
    if (!orderRes.ok) {
      const errBody = await orderRes.text();
      logger.error({ status: orderRes.status, errBody }, "Razorpay order creation failed");
      res.status(502).json({ error: "Could not create payment order" });
      return;
    }
    const order = (await orderRes.json()) as { id: string };

    await pool.query(
      `INSERT INTO subscription_payments (company_id, subscription_id, plan_tier, billing_cycle, amount, razorpay_order_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [sub.company_id, subscriptionId, planSlug, billingCycle, String(amount), order.id],
    );

    res.status(201).json({ orderId: order.id, amount, currency: "INR", keyId });
  } catch (err) {
    logger.error({ err }, "Razorpay order creation errored");
    res.status(502).json({ error: "Could not create payment order" });
  }
});

// POST /portal/payments/verify — the ONLY place a subscription is ever
// activated from a payment. Recomputes the HMAC signature server-side
// (Razorpay's documented formula: order_id + "|" + payment_id, keyed with
// the account's key secret) — a frontend "payment succeeded" claim alone is
// never trusted. Idempotent: re-verifying an already-success row just
// returns the current subscription instead of extending it a second time.
router.post("/portal/payments/verify", async (req, res): Promise<void> => {
  const parsed = VerifyPortalPaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = parsed.data;
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  if (!keySecret) {
    res.status(500).json({ error: "Payment gateway is not configured" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const payRes = await client.query(
      `SELECT * FROM subscription_payments WHERE razorpay_order_id = $1 FOR UPDATE`,
      [razorpayOrderId],
    );
    const payment = payRes.rows[0];
    if (!payment) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Order not found" });
      return;
    }

    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");
    const providedBuf = Buffer.from(razorpaySignature, "utf8");
    const expectedBuf = Buffer.from(expectedSignature, "utf8");
    const signatureValid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);

    if (!signatureValid) {
      await client.query(
        `UPDATE subscription_payments SET status = 'failed', razorpay_payment_id = $1, razorpay_signature = $2 WHERE id = $3`,
        [razorpayPaymentId, razorpaySignature, payment.id],
      );
      await client.query("COMMIT");
      res.status(400).json({ error: "Payment signature verification failed" });
      return;
    }

    if (payment.status !== "success") {
      await client.query(
        `UPDATE subscription_payments
         SET status = 'success', razorpay_payment_id = $1, razorpay_signature = $2, verified_at = NOW()
         WHERE id = $3`,
        [razorpayPaymentId, razorpaySignature, payment.id],
      );

      const subRes = await client.query(`SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`, [payment.subscription_id]);
      const sub = subRes.rows[0];
      const months = PLAN_MONTHS[payment.billing_cycle] ?? 1;
      const now = new Date();
      const curEnd = new Date(sub.subscription_end_date);
      const base = curEnd > now ? curEnd : now;
      const newEnd = addMonths(base, months);

      await client.query(
        `UPDATE subscriptions SET
           plan_name = $1, plan_tier = $2, subscription_amount = $3,
           subscription_end_date = $4, subscription_status = 'active', payment_status = 'paid',
           last_payment_date = NOW(), next_due_date = $4, updated_at = NOW()
         WHERE id = $5`,
        [payment.billing_cycle, payment.plan_tier, payment.amount, newEnd, payment.subscription_id],
      );
    }

    await client.query("COMMIT");

    const { rows } = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [payment.subscription_id]);
    res.json(formatMySubscription(rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Payment verification failed");
    res.status(500).json({ error: "Payment verification failed" });
  } finally {
    client.release();
  }
});

// POST /portal/payments/webhook — Razorpay server-to-server callback, the
// safety net for when the browser closes before /verify fires. Verifies the
// x-razorpay-signature header (a DIFFERENT secret than the checkout
// signature above) against the raw body bytes captured by app.ts's
// express.raw() middleware for this one path. Idempotent via the same
// success-status check as /verify, so a re-delivered webhook is a no-op.
router.post("/portal/payments/webhook", async (req, res): Promise<void> => {
  const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"];
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  if (!webhookSecret || !signature) {
    res.status(400).end();
    return;
  }
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    logger.warn("Razorpay webhook signature mismatch");
    res.status(400).end();
    return;
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).end();
    return;
  }

  const paymentEntity = event?.payload?.payment?.entity;
  if (event?.event === "payment.captured" && paymentEntity?.order_id) {
    const { rows } = await pool.query(
      `SELECT status FROM subscription_payments WHERE razorpay_order_id = $1`,
      [paymentEntity.order_id],
    );
    if (rows.length > 0 && rows[0].status !== "success") {
      // Same activation the /verify handler performs — a webhook can arrive
      // even when the customer's browser never called /verify at all.
      await pool.query(
        `UPDATE subscription_payments SET status = 'success', razorpay_payment_id = $1, verified_at = NOW() WHERE razorpay_order_id = $2`,
        [paymentEntity.id, paymentEntity.order_id],
      );
      logger.info({ orderId: paymentEntity.order_id }, "Razorpay webhook: payment captured (subscription activation left to /verify or a manual check)");
    }
  }

  res.status(200).end();
});

// GET /portal/my-subscription — authenticated (getCompanyId throws 401 if not).
router.get("/portal/my-subscription", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const { rows } = await pool.query(`SELECT * FROM subscriptions WHERE company_id = $1`, [companyId]);
  if (rows.length === 0) {
    res.status(404).json({ error: "No subscription found" });
    return;
  }
  res.json(formatMySubscription(rows[0]));
});

// GET /portal/my-payments — authenticated.
router.get("/portal/my-payments", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const { rows } = await pool.query(
    `SELECT * FROM subscription_payments WHERE company_id = $1 ORDER BY created_at DESC`,
    [companyId],
  );
  res.json(rows.map((r) => ({
    id: r.id,
    planTier: r.plan_tier,
    billingCycle: r.billing_cycle,
    amount: Number(r.amount),
    currency: r.currency,
    status: r.status,
    razorpayPaymentId: r.razorpay_payment_id ?? null,
    createdAt: r.created_at.toISOString(),
  })));
});

function formatMySubscription(r: any) {
  const end = new Date(r.subscription_end_date);
  return {
    id: r.id,
    companyId: r.company_id,
    planTier: r.plan_tier ?? null,
    planName: r.plan_name ?? null,
    billingCycle: r.plan_name ?? null,
    subscriptionAmount: Number(r.subscription_amount),
    subscriptionStatus: r.subscription_status,
    paymentStatus: r.payment_status,
    subscriptionStartDate: r.subscription_start_date ? new Date(r.subscription_start_date).toISOString() : null,
    subscriptionEndDate: end.toISOString(),
    daysRemaining: daysBetween(new Date(), end),
  };
}

export default router;
