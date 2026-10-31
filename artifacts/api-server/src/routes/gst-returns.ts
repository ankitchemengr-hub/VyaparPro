import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { buildGstr1 } from "../lib/gstr1";
import { GST_ACCOUNTANT_ROLE } from "../lib/gst-access";

// Books & Audit → GST Returns. Read-only: admin, accountant and the GST
// Accountant / CA login.
const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

function allowed(req: any, res: any): boolean {
  const role = req.session?.role;
  if (role === "admin" || role === "accountant" || role === GST_ACCOUNTANT_ROLE) return true;
  res.status(403).json({ error: "Forbidden" });
  return false;
}

function period(req: any, res: any): { from: string; to: string } | null {
  const { from, to } = req.query;
  if (!validDate(from) || !validDate(to) || from > to) { res.status(400).json({ error: "Invalid date range" }); return null; }
  if (Date.parse(to) - Date.parse(from) > 92 * 86400_000) {
    res.status(400).json({ error: "Pick one month or one quarter" });
    return null;
  }
  return { from, to };
}

router.get("/books/gstr1", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const p = period(req, res);
  if (!p) return;
  try {
    const g = await buildGstr1(getCompanyId(req), p.from, p.to);
    const { json: _json, ...rest } = g;
    res.json(rest);
  } catch (err) {
    logger.error({ err }, "GET /books/gstr1 failed");
    res.status(500).json({ error: "Failed to build GSTR-1" });
  }
});

// The file to upload on the GST portal (GSTR-1 → Prepare offline → Upload).
router.get("/books/gstr1/json", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const p = period(req, res);
  if (!p) return;
  try {
    const companyId = getCompanyId(req);
    const g = await buildGstr1(companyId, p.from, p.to);
    const session = (req as any).session;
    await pool.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, "gstr1_exported", `GSTR-1 JSON downloaded for ${p.from} to ${p.to}`, session?.userId ?? 1, session?.name ?? "Unknown", JSON.stringify({ ...p, fp: g.fp })],
    );
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="GSTR1_${g.gstin || "GSTIN"}_${g.fp}.json"`);
    res.send(JSON.stringify(g.json));
  } catch (err) {
    logger.error({ err }, "GET /books/gstr1/json failed");
    res.status(500).json({ error: "Failed to build GSTR-1 JSON" });
  }
});

export default router;
