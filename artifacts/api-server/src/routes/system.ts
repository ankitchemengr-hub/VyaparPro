import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import { isMultiCompanyMode, getDefaultCompanyId } from "../lib/system-config";
import { getCurrentCompany } from "../lib/company";
import { companyIdForHost } from "../lib/custom-domains";
import { requireAuth, requireSuperAdmin, getSession } from "../lib/tenant";
import { SetActiveCompanyBody } from "@workspace/api-zod";

const router: IRouter = Router();

// GET /system/config — PUBLIC (no auth). Lets the login screen know whether to
// run in shared SaaS mode (generic branding) or dedicated single-company mode
// (show the fixed company name + logo, no company selection). This is
// presentation only; real access control lives in the login handler + tenant
// middleware.
//
// In shared mode, a request arriving on a customer's verified custom domain
// (e.g. erp.myshop.com) returns THAT company, so the login screen shows its
// branding and signs staff straight into it (see lib/custom-domains.ts).
router.get("/system/config", async (req, res): Promise<void> => {
  // Identity/branding config must not be cached across deployments.
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");

  const multiCompanyMode = isMultiCompanyMode();
  const brandCompanyId = multiCompanyMode
    ? await companyIdForHost(req.headers["x-forwarded-host"]?.toString().split(",")[0] ?? req.headers.host)
    : getDefaultCompanyId();

  let company: { id: number; name: string; logo: string | null } | null = null;
  if (brandCompanyId != null) {
    const c = await getCurrentCompany(brandCompanyId);
    if (c) company = { id: c.id, name: c.name, logo: c.logo ?? null };
  }

  res.json({ multiCompanyMode, company, erpApplicationUrl: process.env["ERP_APPLICATION_URL"] ?? null });
});

// GET /system/companies-public — PUBLIC (no auth). Lists tenant companies for
// the login screen's hidden company switcher. Exposes only id/name/logo (no
// sensitive data). Access control still lives in the login handler + tenant
// middleware; this only powers the pre-auth picker.
router.get("/system/companies-public", async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const rows = await db
    .select({ id: companiesTable.id, name: companiesTable.name, logo: companiesTable.logo })
    .from(companiesTable)
    .orderBy(asc(companiesTable.name));
  res.json(rows.map((r) => ({ id: r.id, name: r.name, logo: r.logo ?? null })));
});

// GET /system/companies — super_admin only. Lists every tenant company so the
// platform operator can pick which one to switch into. Regular users never call
// this; they are locked to their own company.
router.get(
  "/system/companies",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    const rows = await db
      .select({ id: companiesTable.id, name: companiesTable.name, logo: companiesTable.logo })
      .from(companiesTable)
      .orderBy(asc(companiesTable.name));
    res.json(rows.map((r) => ({ id: r.id, name: r.name, logo: r.logo ?? null })));
  },
);

// POST /system/active-company — super_admin only. Records which company the
// super_admin has switched into on the session cookie. Passing `companyId: null`
// clears the selection (back to the platform console). Every company-scoped
// route reads this via getCompanyId(), so the switch instantly re-scopes data.
router.post(
  "/system/active-company",
  requireAuth,
  requireSuperAdmin,
  async (req, res): Promise<void> => {
    const parsed = SetActiveCompanyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const session = getSession(req)!;
    const { companyId } = parsed.data;

    if (companyId == null) {
      session.activeCompanyId = null;
      (req as any).session = session;
      res.json({ activeCompanyId: null, company: null });
      return;
    }

    const c = await getCurrentCompany(companyId);
    if (!c) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    session.activeCompanyId = companyId;
    (req as any).session = session;
    res.json({
      activeCompanyId: companyId,
      company: { id: c.id, name: c.name, logo: c.logo ?? null },
    });
  },
);

export default router;
