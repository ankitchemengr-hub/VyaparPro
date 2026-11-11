import { pool } from "@workspace/db";
import { logger } from "./logger";
import { withGst } from "./subscription-invoice";

// Plans & Offers (Platform Console). What a customer pays for a plan:
//   monthly price — or the plan's offer price while its offer runs
//   × months in the billing cycle
//   − the cycle discount (e.g. yearly 15% off)
//   − a coupon code, if one was entered
//   + 18% GST
// Every amount is worked out here on the server; the browser only shows it.

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const round2 = (n: number) => Math.round(n * 100) / 100;

let schemaReady: Promise<void> | null = null;
export function ensurePricingSchema(): Promise<void> {
  schemaReady ??= pool.query(`
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS offer_price NUMERIC(12, 2);
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS offer_label TEXT;
    ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS offer_ends_at TIMESTAMP WITH TIME ZONE;
    CREATE TABLE IF NOT EXISTS platform_pricing (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      quarterly_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
      half_yearly_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
      yearly_pct NUMERIC(5, 2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    INSERT INTO platform_pricing (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS subscription_coupons (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('percent', 'flat')),
      value NUMERIC(12, 2) NOT NULL CHECK (value > 0),
      plan_slugs TEXT[],
      max_uses INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      valid_until TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      note TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS list_amount NUMERIC(12, 2);
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12, 2);
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS coupon_code TEXT;
  `).then(() => undefined).catch((err) => {
    schemaReady = null; // retry next time rather than caching the failure
    logger.error({ err }, "Could not ensure plan pricing schema");
    throw err;
  });
  return schemaReady;
}
ensurePricingSchema().catch(() => {});

export class PricingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const normalizeCoupon = (code: unknown) =>
  typeof code === "string" ? code.trim().toUpperCase().replace(/\s+/g, "") : "";

// The offer counts while it has a price below the normal one and its end
// date (if any) hasn't passed.
export function activeOffer(plan: any, now = new Date()): { price: number; label: string | null; endsAt: string | null } | null {
  const price = plan.offer_price == null ? null : Number(plan.offer_price);
  if (price == null || !(price > 0) || price >= Number(plan.price_monthly)) return null;
  if (plan.offer_ends_at && new Date(plan.offer_ends_at) <= now) return null;
  return { price, label: plan.offer_label ?? null, endsAt: plan.offer_ends_at ? new Date(plan.offer_ends_at).toISOString() : null };
}

export interface CycleDiscounts { quarterly: number; half_yearly: number; yearly: number }

export async function getCycleDiscounts(client: Queryable = pool): Promise<CycleDiscounts> {
  await ensurePricingSchema();
  const { rows: [r] } = await client.query(`SELECT * FROM platform_pricing WHERE id = 1`);
  return {
    quarterly: Number(r?.quarterly_pct ?? 0),
    half_yearly: Number(r?.half_yearly_pct ?? 0),
    yearly: Number(r?.yearly_pct ?? 0),
  };
}

// Why a coupon can't be used, or null when it can.
function couponProblem(c: any, planSlug: string, now = new Date()): string | null {
  if (!c || !c.is_active) return "This coupon code is not valid";
  if (c.valid_until && new Date(c.valid_until) <= now) return "This coupon code has expired";
  if (c.max_uses != null && Number(c.used_count) >= Number(c.max_uses)) return "This coupon code has been fully used";
  if (Array.isArray(c.plan_slugs) && c.plan_slugs.length > 0 && !c.plan_slugs.includes(planSlug)) {
    return "This coupon code is not valid for the selected plan";
  }
  return null;
}

export interface PriceQuote {
  planSlug: string;
  planName: string;
  billingCycle: string;
  months: number;
  monthlyPrice: number;       // normal price per month
  effectiveMonthly: number;   // offer price per month when an offer runs
  offer: { label: string | null; endsAt: string | null } | null;
  listAmount: number;         // normal price × months, before any discount
  offerDiscount: number;
  cycleDiscountPct: number;
  cycleDiscount: number;
  coupon: { code: string; discount: number } | null;
  totalDiscount: number;
  taxable: number;
  gst: number;
  total: number;
}

// Price of `planSlug` for `billingCycle`, with the running offer, the cycle
// discount and (if given) a coupon. A bad coupon throws PricingError with a
// message fit to show the customer.
export async function quotePlan(
  client: Queryable,
  { planSlug, billingCycle, couponCode }: { planSlug: string; billingCycle: string; couponCode?: string | null },
): Promise<PriceQuote> {
  await ensurePricingSchema();
  const months = CYCLE_MONTHS[billingCycle];
  if (!months) throw new PricingError("Choose a billing cycle");
  const { rows: [plan] } = await client.query(
    `SELECT * FROM subscription_plans WHERE slug = $1 AND is_active = true`,
    [planSlug],
  );
  if (!plan) throw new PricingError("Plan not found", 404);
  const monthlyPrice = Number(plan.price_monthly);
  if (!(monthlyPrice > 0)) throw new PricingError("This plan requires custom pricing — please contact sales");

  const offer = activeOffer(plan);
  const effectiveMonthly = offer ? offer.price : monthlyPrice;
  const listAmount = round2(monthlyPrice * months);
  const afterOffer = round2(effectiveMonthly * months);

  const discounts = await getCycleDiscounts(client);
  const cycleDiscountPct = billingCycle === "monthly" ? 0 : Math.min(90, Math.max(0, discounts[billingCycle as keyof CycleDiscounts] ?? 0));
  const cycleDiscount = round2(afterOffer * cycleDiscountPct / 100);
  let net = round2(afterOffer - cycleDiscount);

  let coupon: PriceQuote["coupon"] = null;
  const code = normalizeCoupon(couponCode);
  if (code) {
    const { rows: [c] } = await client.query(`SELECT * FROM subscription_coupons WHERE code = $1`, [code]);
    const problem = couponProblem(c, planSlug);
    if (problem) throw new PricingError(problem);
    const raw = c.kind === "percent" ? net * Math.min(100, Number(c.value)) / 100 : Number(c.value);
    // Never below ₹1 — Razorpay can't take a zero payment.
    const discount = round2(Math.min(raw, net - 1));
    if (discount > 0) {
      net = round2(net - discount);
      coupon = { code, discount };
    }
  }

  const { taxable, gst, total } = withGst(net);
  return {
    planSlug: plan.slug,
    planName: plan.name,
    billingCycle,
    months,
    monthlyPrice,
    effectiveMonthly,
    offer: offer ? { label: offer.label, endsAt: offer.endsAt } : null,
    listAmount,
    offerDiscount: round2(listAmount - afterOffer),
    cycleDiscountPct,
    cycleDiscount,
    coupon,
    totalDiscount: round2(listAmount - taxable),
    taxable,
    gst,
    total,
  };
}

// Counts a coupon as used once its payment is activated (called inside the
// activation transaction, exactly once per payment).
export async function recordCouponUse(client: Queryable, couponCode: string | null | undefined): Promise<void> {
  const code = normalizeCoupon(couponCode);
  if (!code) return;
  await client.query(`UPDATE subscription_coupons SET used_count = used_count + 1 WHERE code = $1`, [code]);
}
