import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { getSession } from "./tenant";
import { logger } from "./logger";

// What each subscription package unlocks (Silver / Gold / Diamond / Platinum).
//
//   Silver   — billing, invoices, sales return, quotations, customer orders,
//              purchases, inventory, brands, stock adjustment, khatabook,
//              accounts / payments / cash book, expenses, reports, customers,
//              price list, users, settings, backup, own domain.
//   Gold     — Silver + inactive customers, supplier settle, stock investment,
//              salesman commission, rewards, books & audit, workers, bill
//              payment sync, and salesman / store logins.
//   Diamond  — Silver + manufacturing (BOM, manufacturing, auto manufacturing)
//              and manufacturing logins.
//   Platinum — everything.
//
// Only the extras are listed: anything not named here is in every package.
// A company on an old plan (starter / business / …), with no subscription, or
// on a self-hosted single-company install gets Platinum, so nothing that
// worked before stops working.

export type PlanFeature =
  | "inactive_customers" | "supplier_settle" | "stock_investment" | "commission"
  | "rewards" | "books_audit" | "workers" | "payment_sync" | "manufacturing";
export type Tier = "silver" | "gold" | "diamond" | "platinum";
export const TIERS: Tier[] = ["silver", "gold", "diamond", "platinum"];

const GOLD_EXTRAS: PlanFeature[] = [
  "inactive_customers", "supplier_settle", "stock_investment", "commission", "rewards", "books_audit", "workers", "payment_sync",
];
const MFG_EXTRAS: PlanFeature[] = ["manufacturing"];
export const TIER_FEATURES: Record<Tier, PlanFeature[]> = {
  silver: [],
  gold: GOLD_EXTRAS,
  diamond: MFG_EXTRAS,
  platinum: [...GOLD_EXTRAS, ...MFG_EXTRAS],
};

const BASE_ROLES = ["admin", "accountant", "gst_accountant", "customer", "counter"];
export const TIER_ROLES: Record<Tier, string[]> = {
  silver: BASE_ROLES,
  gold: [...BASE_ROLES, "salesman", "store"],
  diamond: [...BASE_ROLES, "manufacturing"],
  platinum: [...BASE_ROLES, "salesman", "store", "manufacturing"],
};

// API path prefix (under /api) → the extra it belongs to.
const API_FEATURES: Array<[string, PlanFeature]> = [
  ["/customer-follow-ups", "inactive_customers"],
  ["/supplier-settle", "supplier_settle"],
  ["/stock-investment", "stock_investment"],
  ["/commissions", "commission"],
  ["/reward-schemes", "rewards"],
  ["/reward-progress", "rewards"],
  ["/books", "books_audit"],
  ["/bank-recon", "books_audit"],
  ["/cheques", "books_audit"],
  ["/godowns", "books_audit"],
  ["/batches", "books_audit"],
  ["/workers", "workers"],
  ["/worker-attendance", "workers"],
  ["/worker-payments", "workers"],
  ["/payment-sync", "payment_sync"],
  ["/boms", "manufacturing"],
  ["/manufacturing", "manufacturing"],
  ["/workload", "manufacturing"],
  ["/material-transfers", "manufacturing"],
  ["/auto-manufacture", "manufacturing"],
];

export function featureForPath(path: string): PlanFeature | null {
  for (const [prefix, feature] of API_FEATURES) {
    if (path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "?")) return feature;
  }
  return null;
}

export const tierOf = (planTier: unknown): Tier =>
  (TIERS as string[]).includes(String(planTier)) ? (planTier as Tier) : "platinum";

export interface CompanyPlan {
  tier: Tier;
  planName: string;
  features: PlanFeature[];
  roles: string[];
  maxUsers: number | null;
}

const cache = new Map<number, { at: number; plan: CompanyPlan }>();
const TTL_MS = 30_000;

// Forget a company's cached plan (after a payment or a plan change).
export function clearPlanCache(companyId?: number | null): void {
  if (companyId == null) cache.clear();
  else cache.delete(companyId);
}

export async function companyPlan(companyId: number): Promise<CompanyPlan> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.plan;
  const { rows: [r] } = await pool.query(
    `SELECT s.plan_tier, p.name, p.max_users
       FROM subscriptions s LEFT JOIN subscription_plans p ON p.slug = s.plan_tier
      WHERE s.company_id = $1 ORDER BY s.id DESC LIMIT 1`,
    [companyId],
  );
  const tier = tierOf(r?.plan_tier);
  const isNewTier = (TIERS as string[]).includes(String(r?.plan_tier));
  const plan: CompanyPlan = {
    tier,
    planName: isNewTier ? (r?.name ?? tier) : "Platinum",
    features: TIER_FEATURES[tier],
    roles: TIER_ROLES[tier],
    maxUsers: isNewTier && r?.max_users != null ? Number(r.max_users) : null,
  };
  cache.set(companyId, { at: Date.now(), plan });
  return plan;
}

const ROLE_LABEL: Record<string, string> = {
  salesman: "Salesman", store: "Store / Stock Manager", manufacturing: "Manufacturing",
};

// After requireAuth: a company only reaches what its package includes —
// a feature outside it, or a login whose role it doesn't include, gets 403.
export async function planGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = getSession(req);
  if (!session?.userId || session.role === "super_admin" || session.companyId == null) {
    next();
    return;
  }
  try {
    const plan = await companyPlan(session.companyId);
    if (!plan.roles.includes(session.role)) {
      res.status(403).json({
        error: `Your company's ${plan.planName} plan doesn't include ${ROLE_LABEL[session.role] ?? session.role} logins. Ask your admin to upgrade the plan.`,
        code: "PLAN_ROLE",
      });
      return;
    }
    const feature = featureForPath(req.path);
    if (feature && !plan.features.includes(feature)) {
      res.status(403).json({ error: `This feature is not in your ${plan.planName} plan.`, code: "PLAN_FEATURE", feature });
      return;
    }
  } catch (err) {
    // Never lock a business out because the plan lookup failed.
    logger.error({ err }, "Plan check failed — allowing the request");
  }
  next();
}

// Users page: can this role be given, and is there room for one more login?
// Customer logins (the customer portal) are never counted.
export async function checkUserAllowed(
  companyId: number, role: string, opts: { addingActiveUser: boolean; excludeUserId?: number },
): Promise<string | null> {
  const plan = await companyPlan(companyId);
  if (!plan.roles.includes(role)) {
    return `The ${plan.planName} plan doesn't include ${ROLE_LABEL[role] ?? role} logins. Upgrade the plan to add one.`;
  }
  if (opts.addingActiveUser && role !== "customer" && plan.maxUsers != null) {
    const { rows: [c] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users
        WHERE company_id = $1 AND is_active = true AND role <> 'customer' AND ($2::int IS NULL OR id <> $2)`,
      [companyId, opts.excludeUserId ?? null],
    );
    if (c.n >= plan.maxUsers) {
      return `The ${plan.planName} plan allows ${plan.maxUsers} staff logins and you already have ${c.n}. Turn one off or upgrade the plan.`;
    }
  }
  return null;
}
