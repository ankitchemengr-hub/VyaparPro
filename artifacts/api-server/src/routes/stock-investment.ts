import { Router, type IRouter } from "express";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { buildStockInvestment, loadSettings, saveSettings, type Speed } from "../lib/stock-investment";

// Stock Investment (see lib/stock-investment.ts) — admin only, like Supplier
// Settle: it shows the business's profit per item.
const router: IRouter = Router();

const isAdmin = (req: any) => req.session?.role === "admin";

router.get("/stock-investment", async (req, res): Promise<void> => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    res.json(await buildStockInvestment(getCompanyId(req), { from: req.query.from, to: req.query.to }));
  } catch (err) {
    logger.error({ err }, "GET /stock-investment failed");
    res.status(500).json({ error: "Failed to load Stock Investment" });
  }
});

// PUT /stock-investment/settings — { fastPct?, normalPct?, days?, speed?: { productId, speed: "fast" | "normal" | null } }
router.put("/stock-investment/settings", async (req, res): Promise<void> => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const companyId = getCompanyId(req);
    const s = await loadSettings(companyId);
    const body = (req.body ?? {}) as Record<string, any>;
    for (const k of ["fastPct", "normalPct", "days"] as const) {
      if (body[k] == null) continue;
      const v = Number(body[k]);
      const max = k === "days" ? 3650 : 100;
      if (!Number.isFinite(v) || v < 0 || v > max || (k === "days" && v < 1)) {
        res.status(400).json({ error: k === "days" ? "Days must be between 1 and 3650" : "Percent must be between 0 and 100" });
        return;
      }
      s[k] = k === "days" ? Math.round(v) : v;
    }
    if (body.speed) {
      const id = Number(body.speed.productId);
      const sp = body.speed.speed as Speed | null;
      if (!Number.isInteger(id) || id <= 0 || !(sp === "fast" || sp === "normal" || sp === null)) {
        res.status(400).json({ error: "Invalid item speed" });
        return;
      }
      if (sp) s.overrides[String(id)] = sp;
      else delete s.overrides[String(id)];
    }
    await saveSettings(companyId, s);
    res.json(s);
  } catch (err) {
    logger.error({ err }, "PUT /stock-investment/settings failed");
    res.status(500).json({ error: "Failed to save Stock Investment settings" });
  }
});

export default router;
