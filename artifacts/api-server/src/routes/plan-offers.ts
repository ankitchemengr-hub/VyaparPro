import { Router, type IRouter, type Response } from "express";
import { pool } from "@workspace/db";
import { requireSuperAdmin } from "./subscriptions";
import { ensurePricingSchema, getCycleDiscounts, normalizeCoupon } from "../lib/plan-pricing";

// Platform Console → Plans & Offers (super_admin only): edit each plan's
// price, features and trial, run an offer price until a date, set discounts
// for paying 3 / 6 / 12 months at once, and manage coupon codes. The website
// and the payment both read these live (lib/plan-pricing.ts).
const router: IRouter = Router();

class InputError extends Error {}

function num(v: unknown, label: string, { min = 0, max = 10_000_000, int = false, optional = false } = {}): number | null {
  if (v === null || v === undefined || v === "") {
    if (optional) return null;
    throw new InputError(`${label} is required`);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
    throw new InputError(`${label} must be ${int ? "a whole number" : "a number"} from ${min} to ${max}`);
  }
  return n;
}

function text(v: unknown, label: string, { max = 200, optional = false } = {}): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) {
    if (optional) return null;
    throw new InputError(`${label} is required`);
  }
  if (s.length > max) throw new InputError(`${label} is too long (max ${max} characters)`);
  return s;
}

function date(v: unknown, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new InputError(`${label} is not a valid date`);
  return d;
}

async function handle(res: Response, fn: () => Promise<unknown>): Promise<void> {
  try {
    res.json(await fn());
  } catch (err) {
    if (err instanceof InputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

function formatPlan(r: any) {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tagline: r.tagline ?? "",
    priceMonthly: Number(r.price_monthly),
    trialDays: r.trial_days,
    maxUsers: r.max_users ?? null,
    maxCompanies: r.max_companies ?? null,
    features: Array.isArray(r.features) ? r.features : [],
    isActive: r.is_active,
    sortOrder: r.sort_order,
    offerPrice: r.offer_price == null ? null : Number(r.offer_price),
    offerLabel: r.offer_label ?? null,
    offerEndsAt: iso(r.offer_ends_at),
  };
}

function formatCoupon(r: any) {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind as "percent" | "flat",
    value: Number(r.value),
    planSlugs: r.plan_slugs ?? [],
    maxUses: r.max_uses ?? null,
    usedCount: r.used_count,
    validUntil: iso(r.valid_until),
    isActive: r.is_active,
    note: r.note ?? null,
    createdAt: iso(r.created_at),
  };
}

// GET /platform-pricing — everything the Plans & Offers screen shows.
router.get("/platform-pricing", requireSuperAdmin, async (_req, res): Promise<void> => {
  await ensurePricingSchema();
  const [plans, coupons, cycleDiscounts] = await Promise.all([
    pool.query(`SELECT * FROM subscription_plans ORDER BY sort_order ASC, id ASC`),
    pool.query(`SELECT * FROM subscription_coupons ORDER BY created_at DESC`),
    getCycleDiscounts(),
  ]);
  res.json({ plans: plans.rows.map(formatPlan), coupons: coupons.rows.map(formatCoupon), cycleDiscounts });
});

// PUT /platform-pricing/plans/:id — price, details and offer of one plan.
router.put("/platform-pricing/plans/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  await handle(res, async () => {
    await ensurePricingSchema();
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const priceMonthly = num(b.priceMonthly, "Monthly price")!;
    const offerPrice = num(b.offerPrice, "Offer price", { optional: true });
    if (offerPrice != null && (offerPrice <= 0 || offerPrice >= priceMonthly)) {
      throw new InputError("Offer price must be more than ₹0 and less than the monthly price");
    }
    const offerEndsAt = date(b.offerEndsAt, "Offer end date");
    if (offerPrice != null && offerEndsAt && offerEndsAt <= new Date()) {
      throw new InputError("Offer end date must be in the future");
    }
    const features = Array.isArray(b.features)
      ? b.features.map((f: unknown) => String(f ?? "").trim()).filter(Boolean).slice(0, 20)
      : [];
    if (features.some((f: string) => f.length > 120)) throw new InputError("Each feature must be at most 120 characters");

    const { rows: [r] } = await pool.query(
      `UPDATE subscription_plans SET
         name = $1, tagline = $2, price_monthly = $3, trial_days = $4, max_users = $5, max_companies = $6,
         features = $7::jsonb, is_active = $8, offer_price = $9, offer_label = $10, offer_ends_at = $11, updated_at = NOW()
       WHERE id = $12 RETURNING *`,
      [
        text(b.name, "Plan name", { max: 60 }), text(b.tagline, "Tagline", { optional: true }),
        priceMonthly, num(b.trialDays, "Trial days", { max: 365, int: true }),
        num(b.maxUsers, "Max users", { min: 1, max: 100_000, int: true, optional: true }),
        num(b.maxCompanies, "Max companies", { min: 1, max: 10_000, int: true, optional: true }),
        JSON.stringify(features), b.isActive !== false,
        offerPrice, offerPrice != null ? text(b.offerLabel, "Offer name", { max: 60, optional: true }) : null,
        offerPrice != null ? offerEndsAt : null, id,
      ],
    );
    if (!r) throw new InputError("Plan not found");
    return formatPlan(r);
  });
});

// PUT /platform-pricing/cycle-discounts { quarterly, half_yearly, yearly } (%)
router.put("/platform-pricing/cycle-discounts", requireSuperAdmin, async (req, res): Promise<void> => {
  await handle(res, async () => {
    await ensurePricingSchema();
    const b = req.body ?? {};
    const q = num(b.quarterly ?? 0, "Quarterly discount", { max: 90 });
    const h = num(b.half_yearly ?? 0, "Half-yearly discount", { max: 90 });
    const y = num(b.yearly ?? 0, "Yearly discount", { max: 90 });
    await pool.query(
      `UPDATE platform_pricing SET quarterly_pct = $1, half_yearly_pct = $2, yearly_pct = $3, updated_at = NOW() WHERE id = 1`,
      [q, h, y],
    );
    return getCycleDiscounts();
  });
});

// POST /platform-pricing/coupons — a new coupon code.
router.post("/platform-pricing/coupons", requireSuperAdmin, async (req, res): Promise<void> => {
  await handle(res, async () => {
    await ensurePricingSchema();
    const b = req.body ?? {};
    const code = normalizeCoupon(b.code);
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new InputError("Code must be 3–20 letters or numbers (no spaces)");
    const kind = b.kind === "flat" ? "flat" : "percent";
    const value = num(b.value, kind === "percent" ? "Discount %" : "Discount amount", { min: 1, max: kind === "percent" ? 100 : 1_000_000 })!;
    const planSlugs = Array.isArray(b.planSlugs) ? b.planSlugs.map(String).filter(Boolean) : [];
    const validUntil = date(b.validUntil, "Valid until");
    if (validUntil && validUntil <= new Date()) throw new InputError("Valid-until date must be in the future");
    const dupe = await pool.query(`SELECT 1 FROM subscription_coupons WHERE code = $1`, [code]);
    if (dupe.rows.length) throw new InputError(`Coupon ${code} already exists`);
    const { rows: [r] } = await pool.query(
      `INSERT INTO subscription_coupons (code, kind, value, plan_slugs, max_uses, valid_until, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [code, kind, value, planSlugs.length ? planSlugs : null,
        num(b.maxUses, "Max uses", { min: 1, max: 1_000_000, int: true, optional: true }), validUntil,
        text(b.note, "Note", { optional: true })],
    );
    return formatCoupon(r);
  });
});

// PATCH /platform-pricing/coupons/:id { isActive } — switch a coupon on/off.
router.patch("/platform-pricing/coupons/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  await handle(res, async () => {
    await ensurePricingSchema();
    const { rows: [r] } = await pool.query(
      `UPDATE subscription_coupons SET is_active = $1 WHERE id = $2 RETURNING *`,
      [req.body?.isActive === true, Number(req.params.id)],
    );
    if (!r) throw new InputError("Coupon not found");
    return formatCoupon(r);
  });
});

// DELETE /platform-pricing/coupons/:id — only a never-used coupon; a used one
// stays on record (switch it off instead).
router.delete("/platform-pricing/coupons/:id", requireSuperAdmin, async (req, res): Promise<void> => {
  await handle(res, async () => {
    await ensurePricingSchema();
    const { rows: [r] } = await pool.query(`SELECT used_count FROM subscription_coupons WHERE id = $1`, [Number(req.params.id)]);
    if (!r) throw new InputError("Coupon not found");
    if (r.used_count > 0) throw new InputError("This coupon has been used — switch it off instead of deleting it");
    await pool.query(`DELETE FROM subscription_coupons WHERE id = $1`, [Number(req.params.id)]);
    return { deleted: true };
  });
});

export default router;
