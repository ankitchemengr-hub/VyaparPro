// The company's subscription package (Silver / Gold / Diamond / Platinum) and
// what it unlocks — from GET /api/my-plan (api-server lib/plan-features.ts,
// which also blocks the same things on the server). Anything outside the plan
// is simply not shown: menu tiles, sidebar, search, routes and inner cards.
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";

export type PlanFeature =
  | "inactive_customers" | "supplier_settle" | "stock_investment" | "commission"
  | "rewards" | "books_audit" | "workers" | "payment_sync" | "manufacturing";

export interface MyPlan {
  tier: "silver" | "gold" | "diamond" | "platinum";
  planName: string;
  features: PlanFeature[];
  roles: string[];
  maxUsers: number | null;
}

// Pages that belong to one extra (anything not listed is in every plan).
export const PLAN_ROUTES: Array<[string, PlanFeature]> = [
  ["/customers/inactive", "inactive_customers"],
  ["/supplier-settle", "supplier_settle"],
  ["/stock-investment", "stock_investment"],
  ["/commission", "commission"],
  ["/salesman-dashboard", "commission"],
  ["/rewards", "rewards"],
  ["/workers", "workers"],
  ["/payment-sync", "payment_sync"],
  ["/manufacturing", "manufacturing"],
  ["/bom", "manufacturing"],
  ["/auto-manufacture", "manufacturing"],
  ["/material-received", "manufacturing"],
];

export function planFeatureForPath(path: string): PlanFeature | null {
  for (const [route, feature] of PLAN_ROUTES) {
    if (path === route || path.startsWith(route + "/") || path.startsWith(route + "?")) return feature;
  }
  return null;
}

export function usePlan() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/my-plan", user?.id ?? null],
    queryFn: async (): Promise<MyPlan> => {
      const res = await fetch("/api/my-plan", { credentials: "include" });
      if (!res.ok) throw new Error("plan");
      return res.json();
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  // Until the plan is known, the extras stay hidden (never flash in and out).
  const has = (feature: PlanFeature | null | undefined) => !feature || !!data?.features.includes(feature);
  const roleAllowed = (role: string) => !data || data.roles.includes(role);
  return { plan: data ?? null, isLoading, has, roleAllowed };
}
