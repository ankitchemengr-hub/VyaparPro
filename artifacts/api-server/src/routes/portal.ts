import { Router, type IRouter, type Response } from "express";
import crypto from "node:crypto";
import { pool } from "@workspace/db";
import {
  CreateDemoRequestBody,
  RegisterPortalCustomerBody,
  CreatePortalPaymentOrderBody,
  VerifyPortalPaymentBody,
  ForgotPortalPasswordBody,
  ResetPortalPasswordBody,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/password";
import { isUsernameTaken } from "../lib/username";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { sendMail, passwordResetEmail } from "../lib/mailer";
import { PLAN_MONTHS, addMonths, daysBetween } from "./subscriptions";
import {
  ensureSubscriptionInvoiceSchema, saveCompanyBillingDetails, issueInvoiceForPayment,
  emailInvoice, renderInvoicePdf, withGst, GST_RATE,
} from "../lib/subscription-invoice";
import { DomainError, getDomainState, requestDomain, verifyDomain, removeDomain } from "../lib/custom-domains";
import { sendWelcomeEmail } from "../lib/customer-emails";
import { CodeError, createChallenge, verifyChallenge, resendChallenge, trustDevice, forgetTrustedDevices } from "../lib/auth-codes";

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

// Public form → cap submissions per IP so a bot can't flood the leads list
// (or the admin's inbox). In-memory is enough for a single API instance.
const DEMO_LIMIT_PER_HOUR = 5;
const demoHits = new Map<string, number[]>();
function demoRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (demoHits.get(ip) ?? []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= DEMO_LIMIT_PER_HOUR) {
    demoHits.set(ip, recent);
    return true;
  }
  recent.push(now);
  demoHits.set(ip, recent);
  return false;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// POST /portal/demo-requests — "Book a Demo" / contact form. Saved as a lead
// (Subscriptions admin console → Demo Leads tab) and emailed to the admin
// straight away so it's followed up while the prospect is still interested.
router.post("/portal/demo-requests", async (req, res): Promise<void> => {
  const parsed = CreateDemoRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string" ? forwarded.split(",")[0]!.trim() : (req.ip ?? "unknown");
  if (demoRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests — please try again later or call us directly." });
    return;
  }
  const d = parsed.data;
  await pool.query(
    `INSERT INTO demo_requests (name, business_name, mobile, email, business_type, num_users, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [d.name, d.businessName ?? null, d.mobile, d.email ?? null, d.businessType ?? null, d.numUsers ?? null, d.message ?? null],
  );

  const adminEmail = process.env["SMTP_USER"];
  if (adminEmail) {
    const row = (label: string, value: string | number | null | undefined) =>
      value == null || value === "" ? "" : `<tr><td style="padding:2px 12px 2px 0;color:#666">${label}</td><td><b>${escapeHtml(String(value))}</b></td></tr>`;
    void sendMail(
      adminEmail,
      `New demo request: ${d.name}${d.businessName ? ` (${d.businessName})` : ""}`.slice(0, 150),
      `<p>A new "Book a Demo" request came in from the website:</p>
       <table>${row("Name", d.name)}${row("Business", d.businessName)}${row("Mobile", d.mobile)}${row("Email", d.email)}${row("Business type", d.businessType)}${row("Users", d.numUsers)}</table>
       ${d.message ? `<p style="white-space:pre-wrap">${escapeHtml(d.message)}</p>` : ""}
       <p>See all leads in the Subscriptions admin console → Demo Leads.</p>`,
    );
  }
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
  // Email is required: the verification code, login codes, invoices and
  // renewal reminders all go there, and it is the account's login ID.
  if (!d.email || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(d.email.trim())) {
    res.status(400).json({ error: "Please enter a valid email address — your verification code and invoices are sent there." });
    return;
  }
  if (d.password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

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
    // The admin login's username is this email/mobile — it must not already be
    // someone's username in any company (lib/username.ts).
    if (await isUsernameTaken(client, (d.email ?? d.mobile).trim())) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "An account with this email or mobile already exists. Please log in, or use a different one." });
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
    // GSTIN / city / state go on the customer's GST invoices.
    await saveCompanyBillingDetails(client, companyId, d);

    const username = (d.email ?? d.mobile).trim().toLowerCase();
    const userRes = await client.query(
      // login_otp_required: this account verifies its email and gets a code on
      // new devices (lib/auth-codes.ts). Accounts made before this never do.
      `INSERT INTO users (username, password_hash, role, name, is_active, company_id, login_otp_required)
       VALUES ($1, $2, 'admin', $3, true, $4, true)
       RETURNING id`,
      [username, hashPassword(d.password), d.ownerName, companyId],
    );
    const userId: number = userRes.rows[0].id;

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
    // Email the verification code. The welcome email goes out once the code
    // is entered (POST /portal/verify-email), so it reaches a proven address.
    // A failure here must not fail a signup that already committed — the
    // customer simply gets the code on their first login instead.
    const ch = await createChallenge({
      userId, purpose: "signup_verify", email: username,
      payload: { companyId, planSlug: plan.slug, onTrial, trialEnd: end.toISOString(), loginUsername: username },
    }).catch((err) => {
      logger.error({ err, userId }, "Signup verification code failed");
      return null;
    });
    res.status(201).json({
      companyId, subscriptionId: subRes.rows[0].id, requiresPayment: !onTrial,
      verification: ch ? { challengeId: ch.challengeId, email: ch.email, sent: ch.sent } : null,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Portal registration failed");
    res.status(500).json({ error: "Registration failed" });
  } finally {
    client.release();
  }
});

// POST /portal/verify-email { challengeId, code } — the code emailed right
// after signup. Marks the email verified, trusts this browser (so the first
// login here doesn't ask again) and sends the welcome email.
router.post("/portal/verify-email", async (req, res): Promise<void> => {
  try {
    const ch = await verifyChallenge(req.body?.challengeId, "signup_verify", req.body?.code);
    await pool.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, [ch.user_id]);
    await trustDevice(req, res, ch.user_id);
    const p = ch.payload ?? {};
    if (p.companyId) {
      void sendWelcomeEmail({
        companyId: p.companyId, planSlug: p.planSlug, onTrial: !!p.onTrial,
        trialEnd: new Date(p.trialEnd), loginUsername: p.loginUsername,
      });
    }
    res.json({ verified: true });
  } catch (err) {
    if (err instanceof CodeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// POST /portal/verify-email/resend { challengeId }
router.post("/portal/verify-email/resend", async (req, res): Promise<void> => {
  try {
    res.json(await resendChallenge(req.body?.challengeId, "signup_verify"));
  } catch (err) {
    if (err instanceof CodeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
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
  const baseAmount = Number(plan.price_monthly) * months;
  if (!(baseAmount > 0)) {
    res.status(400).json({ error: "This plan requires custom pricing — please contact sales" });
    return;
  }
  // Pricing-page prices are before GST — 18% GST is added on top here.
  const { taxable, gst, total: amount } = withGst(baseAmount);
  await ensureSubscriptionInvoiceSchema();

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
      `INSERT INTO subscription_payments (company_id, subscription_id, plan_tier, billing_cycle, amount, razorpay_order_id, status, taxable_amount, gst_amount)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
      [sub.company_id, subscriptionId, planSlug, billingCycle, String(amount), order.id, String(taxable), String(gst)],
    );

    res.status(201).json({ orderId: order.id, amount, taxable, gst, gstRate: GST_RATE, currency: "INR", keyId });
  } catch (err) {
    logger.error({ err }, "Razorpay order creation errored");
    res.status(502).json({ error: "Could not create payment order" });
  }
});

// Activates a captured payment exactly once — whichever of /verify or the
// webhook lands first — then issues its GST invoice in the same transaction.
// Keyed on activated_at (not status): the webhook used to flip status to
// "success" without extending the subscription, and /verify then skipped
// activation because the status already said success — so the customer paid
// and nothing renewed. Caller holds the payment row lock (SELECT … FOR UPDATE).
async function activateAndInvoicePayment(
  client: { query: (text: string, params?: any[]) => Promise<any> },
  payment: any,
  razorpayPaymentId: string,
  razorpaySignature: string | null,
): Promise<{ invoiceId: number; created: boolean } | null> {
  await ensureSubscriptionInvoiceSchema();
  if (payment.activated_at) {
    const inv = await client.query(`SELECT id FROM subscription_invoices WHERE payment_id = $1`, [payment.id]);
    return inv.rows[0] ? { invoiceId: inv.rows[0].id, created: false } : null;
  }
  await client.query(
    `UPDATE subscription_payments
     SET status = 'success', razorpay_payment_id = $1,
         razorpay_signature = COALESCE($2, razorpay_signature),
         verified_at = COALESCE(verified_at, NOW()), activated_at = NOW()
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

  const inv = await issueInvoiceForPayment(client, payment.id, { start: base, end: newEnd });
  return { invoiceId: inv.id, created: inv.created };
}

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

    const invoice = await activateAndInvoicePayment(client, payment, razorpayPaymentId, razorpaySignature);

    await client.query("COMMIT");
    // Email the PDF after commit — never delays or fails the payment itself.
    if (invoice?.created) void emailInvoice(invoice.invoiceId);

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
    // Same activation as /verify — the customer's browser may have closed
    // before /verify ran. Signature already checked above.
    const client = await pool.connect();
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      const { rows } = await client.query(
        `SELECT * FROM subscription_payments WHERE razorpay_order_id = $1 FOR UPDATE`,
        [paymentEntity.order_id],
      );
      let invoice: { invoiceId: number; created: boolean } | null = null;
      if (rows[0]) invoice = await activateAndInvoicePayment(client, rows[0], paymentEntity.id, null);
      await client.query("COMMIT");
      if (invoice?.created) void emailInvoice(invoice.invoiceId);
      if (rows[0]) logger.info({ orderId: paymentEntity.order_id }, "Razorpay webhook: payment captured and activated");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error({ err, orderId: paymentEntity.order_id }, "Razorpay webhook activation failed");
      // 500 so Razorpay retries the delivery.
      res.status(500).end();
      return;
    } finally {
      client.release();
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
  await ensureSubscriptionInvoiceSchema();
  const { rows } = await pool.query(
    `SELECT sp.*, si.id AS invoice_id, si.invoice_no
     FROM subscription_payments sp
     LEFT JOIN subscription_invoices si ON si.payment_id = sp.id
     WHERE sp.company_id = $1 ORDER BY sp.created_at DESC`,
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
    invoiceId: r.invoice_id ?? null,
    invoiceNo: r.invoice_no ?? null,
  })));
});

// GET /portal/invoices/:id/pdf — the GST tax invoice for one subscription
// payment. The paying company's own users, or the platform super_admin.
router.get("/portal/invoices/:id/pdf", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid invoice id" });
    return;
  }
  await ensureSubscriptionInvoiceSchema();
  const { rows: [inv] } = await pool.query(`SELECT * FROM subscription_invoices WHERE id = $1`, [id]);
  const session = (req as any).session;
  const allowed = inv && (session?.role === "super_admin" || (session?.userId && session.companyId === inv.company_id));
  if (!allowed) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const pdf = await renderInvoicePdf(inv);
  const fileName = `${String(inv.invoice_no).replace(/\//g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${fileName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(Buffer.from(pdf));
});

// ── Custom domain (portal "My Domain" page) ────────────────────────────────
// All authenticated via getCompanyId(). The logic — DNS records, Railway
// attach, verification, safe switch-over — lives in lib/custom-domains.ts.

async function domainRoute(res: Response, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await fn());
  } catch (err) {
    if (err instanceof DomainError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

// GET /portal/domain — current active domain, pending change, DNS records.
router.get("/portal/domain", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  await domainRoute(res, () => getDomainState(companyId));
});

// POST /portal/domain { domain } — add a domain, or start changing to a new
// one (the current active domain keeps working until the new one verifies).
router.post("/portal/domain", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  await domainRoute(res, () => requestDomain(companyId, req.body?.domain));
});

// POST /portal/domain/verify — check the DNS records now; goes live if correct.
router.post("/portal/domain/verify", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  await domainRoute(res, () => verifyDomain(companyId));
});

// DELETE /portal/domain/pending | /portal/domain/active
router.delete("/portal/domain/:which", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const which = req.params.which;
  if (which !== "pending" && which !== "active") {
    res.status(400).json({ error: "Use /pending or /active" });
    return;
  }
  await domainRoute(res, () => removeDomain(companyId, which));
});

// POST /portal/forgot-password — public. Always returns the same generic
// message regardless of whether the email exists, so this endpoint can't be
// used to enumerate registered companies. Only email-based accounts can
// reset this way — a portal account whose username is a mobile number
// (registered with no email) has no recovery channel yet.
router.post("/portal/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPortalPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();

  const { rows } = await pool.query(
    `SELECT id, username FROM users WHERE lower(username) = $1 AND company_id IS NOT NULL AND is_active = true`,
    [email],
  );
  const user = rows[0];
  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt],
    );
    const baseUrl = process.env["PORTAL_APPLICATION_URL"] ?? "http://localhost:3002";
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
    const { subject, html } = passwordResetEmail(resetUrl);
    void sendMail(user.username, subject, html);
  }
  res.json({ message: "If that email is registered, a password reset link has been sent." });
});

// POST /portal/reset-password — public (the token IS the capability). One-time
// use: a token is marked used_at the moment it's consumed, so a reused/leaked
// link doesn't grant a second reset.
router.post("/portal/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPortalPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { token, newPassword } = parsed.data;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const { rows } = await pool.query(`SELECT * FROM password_reset_tokens WHERE token_hash = $1`, [tokenHash]);
  const record = rows[0];
  if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
    res.status(400).json({ error: "This reset link is invalid or has expired" });
    return;
  }

  // Website-signup accounts follow the 8-character rule; older accounts keep
  // the schema's minimum.
  const { rows: [owner] } = await pool.query(`SELECT login_otp_required FROM users WHERE id = $1`, [record.user_id]);
  if (owner?.login_otp_required && newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  // The reset link arrived by email, so the email is proven. Every trusted
  // device is forgotten — after a reset, any device needs a fresh code.
  await pool.query(
    `UPDATE users SET password_hash = $1, email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $2`,
    [hashPassword(newPassword), record.user_id],
  );
  await pool.query(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [record.id]);
  await forgetTrustedDevices(record.user_id);
  res.json({ message: "Password reset successfully — you can now log in with your new password." });
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
