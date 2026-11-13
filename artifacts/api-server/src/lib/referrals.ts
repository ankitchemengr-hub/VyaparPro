import crypto from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// Refer & Earn. Every customer company gets its own code (SHR…). A new
// business that signs up with that code is linked to the referrer and gets a
// discount on its first payment. When that first real payment comes in the
// referrer earns a cash reward (paid by the platform owner over UPI, by hand)
// once a hold period has passed — so a refunded payment can be caught first.
//
// referrals.status:
//   signed_up — joined with the code, has not paid yet
//   earned    — first payment received; reward due after payable_after
//   paid      — the platform owner paid the reward (payout_ref = UPI ref)
//   rejected  — not rewarded (refund, fake account, …)

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };
const round2 = (n: number) => Math.round(n * 100) / 100;

let schemaReady: Promise<void> | null = null;
export function ensureReferralSchema(): Promise<void> {
  schemaReady ??= pool.query(`
    CREATE TABLE IF NOT EXISTS referral_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      reward_kind TEXT NOT NULL DEFAULT 'flat' CHECK (reward_kind IN ('flat', 'percent')),
      reward_value NUMERIC(12, 2) NOT NULL DEFAULT 500,
      new_customer_pct NUMERIC(5, 2) NOT NULL DEFAULT 10,
      hold_days INTEGER NOT NULL DEFAULT 7,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    INSERT INTO referral_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS referral_accounts (
      company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL UNIQUE,
      upi_id TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      referred_company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up', 'earned', 'paid', 'rejected')),
      first_payment_id INTEGER,
      first_payment_amount NUMERIC(12, 2),
      reward_amount NUMERIC(12, 2),
      earned_at TIMESTAMP WITH TIME ZONE,
      payable_after TIMESTAMP WITH TIME ZONE,
      paid_at TIMESTAMP WITH TIME ZONE,
      payout_ref TEXT,
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_company_id);
  `).then(() => undefined).catch((err) => {
    schemaReady = null; // retry next time rather than caching the failure
    logger.error({ err }, "Could not ensure referral schema");
    throw err;
  });
  return schemaReady;
}
ensureReferralSchema().catch(() => {});

export interface ReferralSettings {
  isEnabled: boolean;
  rewardKind: "flat" | "percent";
  rewardValue: number;
  newCustomerPct: number;
  holdDays: number;
}

export async function getReferralSettings(client: Queryable = pool): Promise<ReferralSettings> {
  await ensureReferralSchema();
  const { rows: [r] } = await client.query(`SELECT * FROM referral_settings WHERE id = 1`);
  return {
    isEnabled: r?.is_enabled ?? true,
    rewardKind: r?.reward_kind === "percent" ? "percent" : "flat",
    rewardValue: Number(r?.reward_value ?? 500),
    newCustomerPct: Number(r?.new_customer_pct ?? 10),
    holdDays: Number(r?.hold_days ?? 7),
  };
}

export const normalizeReferralCode = (code: unknown) =>
  typeof code === "string" ? code.trim().toUpperCase().replace(/\s+/g, "") : "";

// No 0/O, 1/I/L — the code is read out over the phone and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode(): string {
  const bytes = crypto.randomBytes(5);
  return "SHR" + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

// The company's own referral account (made the first time it is asked for).
export async function getOrCreateReferralAccount(companyId: number): Promise<{ code: string; upiId: string | null }> {
  await ensureReferralSchema();
  for (let i = 0; i < 5; i++) {
    const { rows: [r] } = await pool.query(
      `INSERT INTO referral_accounts (company_id, code) VALUES ($1, $2)
       ON CONFLICT DO NOTHING RETURNING code, upi_id`,
      [companyId, newCode()],
    );
    if (r) return { code: r.code, upiId: r.upi_id ?? null };
    const { rows: [existing] } = await pool.query(`SELECT code, upi_id FROM referral_accounts WHERE company_id = $1`, [companyId]);
    if (existing) return { code: existing.code, upiId: existing.upi_id ?? null };
    // Otherwise the random code was taken by another company — try another.
  }
  throw new Error("Could not create a referral code");
}

// Is this a working referral code? (Shown on the signup form as you type.)
export async function checkReferralCode(code: unknown): Promise<{ valid: boolean; newCustomerPct: number }> {
  const c = normalizeReferralCode(code);
  const settings = await getReferralSettings();
  if (!c || !settings.isEnabled) return { valid: false, newCustomerPct: 0 };
  const { rows } = await pool.query(`SELECT 1 FROM referral_accounts WHERE code = $1`, [c]);
  return { valid: rows.length > 0, newCustomerPct: rows.length ? settings.newCustomerPct : 0 };
}

// Called inside the signup transaction: links the new company to whoever
// owns `code`. Silently does nothing for an unknown code, when the programme
// is off, or when the "new" business is plainly the referrer itself (same
// mobile, email or GSTIN) — signup must never fail over a referral code.
export async function linkReferral(
  client: Queryable,
  newCompanyId: number,
  code: unknown,
  who: { mobile?: string | null; email?: string | null; gstin?: string | null },
): Promise<boolean> {
  const c = normalizeReferralCode(code);
  if (!c) return false;
  const settings = await getReferralSettings(client);
  if (!settings.isEnabled) return false;
  const { rows: [ref] } = await client.query(
    `SELECT ra.company_id, co.mobile, co.email, co.gstin
     FROM referral_accounts ra JOIN companies co ON co.id = ra.company_id
     WHERE ra.code = $1`,
    [c],
  );
  if (!ref || ref.company_id === newCompanyId) return false;
  const same = (a: unknown, b: unknown) =>
    typeof a === "string" && typeof b === "string" && a.trim() !== "" && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (same(ref.mobile, who.mobile) || same(ref.email, who.email) || same(ref.gstin, who.gstin)) {
    logger.warn({ code: c, newCompanyId }, "Referral not linked: same mobile / email / GSTIN as the referrer");
    return false;
  }
  const { rows } = await client.query(
    `INSERT INTO referrals (referrer_company_id, referred_company_id, code) VALUES ($1, $2, $3)
     ON CONFLICT (referred_company_id) DO NOTHING RETURNING id`,
    [ref.company_id, newCompanyId, c],
  );
  return rows.length > 0;
}

// The first-payment discount % for a price quote: for a company that joined
// with a code and hasn't paid yet, or (signup form, before the account
// exists) for a code typed in.
export async function referralDiscountPct(
  client: Queryable,
  { companyId, code }: { companyId?: number | null; code?: unknown },
): Promise<number> {
  const settings = await getReferralSettings(client);
  if (!(settings.newCustomerPct > 0)) return 0;
  if (companyId) {
    const { rows } = await client.query(
      `SELECT 1 FROM referrals WHERE referred_company_id = $1 AND status = 'signed_up'`,
      [companyId],
    );
    return rows.length ? settings.newCustomerPct : 0;
  }
  const c = normalizeReferralCode(code);
  if (!c || !settings.isEnabled) return 0;
  const { rows } = await client.query(`SELECT 1 FROM referral_accounts WHERE code = $1`, [c]);
  return rows.length ? settings.newCustomerPct : 0;
}

// Called inside the payment-activation transaction (exactly once per
// payment): the referred company's first payment earns the referrer's reward.
export async function recordReferralPayment(client: Queryable, payment: any): Promise<void> {
  await ensureReferralSchema();
  const { rows: [r] } = await client.query(
    `SELECT * FROM referrals WHERE referred_company_id = $1 AND status = 'signed_up' FOR UPDATE`,
    [payment.company_id],
  );
  if (!r) return;
  const settings = await getReferralSettings(client);
  // The reward is worked out on the amount before GST.
  const paid = payment.taxable_amount != null ? Number(payment.taxable_amount) : round2(Number(payment.amount) / 1.18);
  if (!(paid > 0)) return;
  const reward = settings.rewardKind === "percent"
    ? round2(paid * Math.min(100, settings.rewardValue) / 100)
    : round2(settings.rewardValue);
  await client.query(
    `UPDATE referrals SET status = 'earned', first_payment_id = $1, first_payment_amount = $2, reward_amount = $3,
       earned_at = NOW(), payable_after = NOW() + make_interval(days => $4)
     WHERE id = $5`,
    [payment.id, paid, reward, settings.holdDays, r.id],
  );
}

export function formatReferralStatus(r: any) {
  return {
    id: r.id,
    status: r.status as "signed_up" | "earned" | "paid" | "rejected",
    firstPaymentAmount: r.first_payment_amount == null ? null : Number(r.first_payment_amount),
    rewardAmount: r.reward_amount == null ? null : Number(r.reward_amount),
    joinedAt: new Date(r.created_at).toISOString(),
    earnedAt: r.earned_at ? new Date(r.earned_at).toISOString() : null,
    payableAfter: r.payable_after ? new Date(r.payable_after).toISOString() : null,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    payoutRef: r.payout_ref ?? null,
  };
}
