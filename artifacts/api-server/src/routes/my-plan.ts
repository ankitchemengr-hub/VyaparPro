import { Router, type IRouter } from "express";
import { getSession } from "../lib/tenant";
import { companyPlan, TIER_FEATURES, TIER_ROLES } from "../lib/plan-features";

// GET /my-plan — the logged-in company's package, so the app shows only what
// the plan includes (menu, cards, roles on the Users page). The server checks
// the same thing on every request (lib/plan-features.ts planGate).
const router: IRouter = Router();

router.get("/my-plan", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session || session.role === "super_admin" || session.companyId == null) {
    res.json({ tier: "platinum", planName: "Platinum", features: TIER_FEATURES.platinum, roles: TIER_ROLES.platinum, maxUsers: null });
    return;
  }
  res.json(await companyPlan(session.companyId));
});

export default router;
