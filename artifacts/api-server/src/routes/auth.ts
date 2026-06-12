import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  usersTable,
  rolePermissionsTable,
} from "@workspace/db";
import {
  LoginBody,
  GetRolePermissionsResponse,
  UpdateRolePermissionsBody,
} from "@workspace/api-zod";
import { getCompanyId, handleTenantError } from "../lib/tenant";
import { isAccountAllowedHere, getDefaultCompanyId } from "../lib/system-config";

const router: IRouter = Router();

// Identity/session responses must NEVER be cached by the browser or proxies.
// Without this, the browser caches the authenticated `/auth/me` 200 (Express
// adds an ETag but no Cache-Control), so after a user clears their cookie the
// stale user object is served from disk cache and the SPA wrongly believes it
// is still authenticated. no-store forces a fresh request every time.
router.use("/auth", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// Simple password check (in prod use bcrypt - spec says admin123, pass123)
function checkPassword(plain: string, hash: string): boolean {
  return plain === hash;
}

// POST /auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password, companyId: requestedCompanyId } = parsed.data;
  const switchTarget = requestedCompanyId ?? null;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (!user || !checkPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Inactive accounts are rejected immediately, regardless of role or company.
  if (!user.isActive) {
    res.status(403).json({ error: "Your account has been deactivated. Contact administrator." });
    return;
  }

  // MULTI-COMPANY GUARD: every non-super_admin user MUST be bound to a company.
  // If company_id is NULL on a regular user it means the account was created
  // before tenant isolation was enforced (pre-fix bootstrap admin with role
  // "admin"). Allow it to log in would give them a NULL session company_id and
  // cause every protected data route to throw "No tenant context" (403) —
  // a confusing dead-end. Reject here with a clear, actionable message instead.
  if (user.role !== "super_admin" && user.companyId == null) {
    res.status(403).json({
      error:
        "Your account is not assigned to any company. Contact the Super Admin to fix this.",
    });
    return;
  }

  // Login-screen "Switch Company" selection. The hidden switcher lets a user
  // sign into a company OTHER than this deployment's locked default — but ONLY
  // into the company their own account belongs to. This bypasses the dedicated
  // lock for that case; it NEVER grants access to a company the account does not
  // belong to. The platform super_admin is exempt (it switches in explicitly
  // after login) so its selection is ignored here.
  if (user.role !== "super_admin" && switchTarget != null) {
    if (user.companyId == null || user.companyId !== switchTarget) {
      res.status(403).json({
        error: "Your account does not belong to the selected company.",
      });
      return;
    }
  } else if (!isAccountAllowedHere(user.role, user.companyId ?? null)) {
    // Dedicated single-company deployment lock: when MULTI_COMPANY_MODE=false
    // only users of the configured DEFAULT_COMPANY_ID (and the platform
    // super_admin) may sign in here. Enforced server-side via the shared,
    // fail-closed helper, so a tampered client cannot bypass it and a
    // misconfigured install denies access rather than falling open.
    res.status(403).json({
      error: "This system is dedicated to another company. You cannot sign in here.",
    });
    return;
  }

  // Subscription gating: if this user belongs to a tenant company, block login
  // when that company's subscription is expired or suspended. The platform
  // super_admin (companyId NULL) is exempt and never gated.
  if (user.role !== "super_admin" && user.companyId != null) {
    const subRes = await pool.query(
      `SELECT subscription_status, subscription_end_date
       FROM subscriptions
       WHERE company_id = $1
       ORDER BY subscription_end_date DESC
       LIMIT 1`,
      [user.companyId]
    );
    const sub = subRes.rows[0];
    const expired =
      !sub ||
      sub.subscription_status === "suspended" ||
      sub.subscription_status === "expired" ||
      new Date(sub.subscription_end_date) < new Date();
    if (expired) {
      res.status(403).json({
        error: "Your subscription has expired. Please contact administrator.",
      });
      return;
    }
  }

  // Tenant isolation: lock the session's company. A validated "Switch Company"
  // selection (switchTarget, already proven to match the user's own company)
  // wins so the user lands in the company they picked. Otherwise dedicated mode
  // (DEFAULT_COMPANY_ID set) forces every signed-in user onto that company; in
  // shared mode it falls back to the user's own company. The platform
  // super_admin is never scoped to a company (it switches in explicitly).
  const sessionCompanyId =
    user.role === "super_admin"
      ? null
      : switchTarget ?? getDefaultCompanyId() ?? user.companyId ?? null;

  // Store session — entityId is critical for salesman attribution & ledger
  // scoping; companyId is the tenant isolation key for every data route.
  (req as any).session = {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    entityId: user.entityId ?? null,
    companyId: sessionCompanyId,
    // Records a validated "Switch Company" sign-in so requireAuth lets this
    // regular user into their own company on a dedicated install.
    companySwitch: user.role !== "super_admin" && switchTarget != null,
  };

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    customerId: user.entityId ?? null,
    companyId: sessionCompanyId,
  });
});

// POST /auth/logout
router.post("/auth/logout", async (_req, res): Promise<void> => {
  // Must clearCookie explicitly — sendStatus(204) bypasses the res.json patch
  // that normally handles cookie clearing.
  res.clearCookie("session", { path: "/" });
  res.sendStatus(204);
});

// GET /auth/me
router.get("/auth/me", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Re-stamp the session cookie from the current DB record. Sessions issued
  // before `companyId` (or other fields) were added to the payload would
  // otherwise stay stale forever and trip getCompanyId() with a 403 on every
  // data route. Refreshing here lets a stale session self-heal on page load.
  (req as any).session = {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    entityId: user.entityId ?? null,
    companyId: user.companyId ?? null,
    // Preserve session-only fields that have NO DB column. Re-stamping would
    // otherwise drop them and the res.json patch would rewrite the cookie
    // without them — wiping the super_admin's switched-into company
    // (activeCompanyId) and a regular user's validated dedicated-mode unlock
    // (companySwitch). Since the company switcher refetches /auth/me right
    // after switching, omitting these makes every later data route 409.
    activeCompanyId: (session.activeCompanyId as number | null | undefined) ?? null,
    companySwitch: (session.companySwitch as boolean | undefined) ?? false,
  };

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    customerId: user.entityId ?? null,
    companyId: user.companyId ?? null,
    // Surface the super_admin's currently switched-into company so the SPA can
    // show the right company context and unlock ERP navigation. Null for normal
    // users and for a super_admin that hasn't picked a company yet.
    activeCompanyId: (session.activeCompanyId as number | null | undefined) ?? null,
  });
});

// GET /auth/permissions — scoped to the caller's company.
router.get("/auth/permissions", async (req, res): Promise<void> => {
  try {
    const companyId = getCompanyId(req);
    const perms = await db
      .select()
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.companyId, companyId));
    res.json(GetRolePermissionsResponse.parse(perms));
  } catch (err) {
    if (handleTenantError(err, res)) return;
    throw err;
  }
});

// PUT /auth/permissions — scoped to the caller's company.
router.put("/auth/permissions", async (req, res): Promise<void> => {
  const parsed = UpdateRolePermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const companyId = getCompanyId(req);
    for (const perm of parsed.data.permissions) {
      const existing = await db
        .select()
        .from(rolePermissionsTable)
        .where(
          and(
            eq(rolePermissionsTable.companyId, companyId),
            eq(rolePermissionsTable.role, perm.role),
            eq(rolePermissionsTable.feature, perm.feature)
          )
        );

      if (existing.length > 0) {
        await db
          .update(rolePermissionsTable)
          .set({ allowed: perm.allowed })
          .where(
            and(
              eq(rolePermissionsTable.companyId, companyId),
              eq(rolePermissionsTable.role, perm.role),
              eq(rolePermissionsTable.feature, perm.feature)
            )
          );
      } else {
        await db.insert(rolePermissionsTable).values({
          companyId,
          role: perm.role,
          feature: perm.feature,
          allowed: perm.allowed,
        });
      }
    }

    const updated = await db
      .select()
      .from(rolePermissionsTable)
      .where(eq(rolePermissionsTable.companyId, companyId));
    res.json(updated);
  } catch (err) {
    if (handleTenantError(err, res)) return;
    throw err;
  }
});

export default router;
