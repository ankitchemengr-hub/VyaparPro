import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Login audit helpers
// ---------------------------------------------------------------------------

function getClientIp(req: Parameters<typeof router.post>[1]): string {
  const fwd = (req as any).headers?.["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  return (req as any).ip ?? (req as any).socket?.remoteAddress ?? "unknown";
}

// Fire-and-forget audit writer — never throws; never blocks the login response.
// company_id = 0 is a sentinel used when the user/company could not be resolved
// (e.g. wrong credentials with an unknown username). audit_log.company_id has
// no FK constraint so 0 is safe to store.
async function writeLoginAudit(params: {
  username: string;
  companyId: number;            // 0 = unknown
  ipAddress: string;
  success: boolean;
  reason?: string;              // failure reason; omit on success
  userId?: number;              // resolved user id on success
  userName?: string;            // resolved display name on success
}): Promise<void> {
  try {
    const action = params.success ? "login_success" : "login_failure";
    const description = params.success
      ? `Successful login for "${params.username}" (company_id=${params.companyId})`
      : `Failed login for "${params.username}" — ${params.reason ?? "unknown"} (company_id=${params.companyId})`;
    const metadata = JSON.stringify({
      username: params.username,
      companyId: params.companyId,
      ipAddress: params.ipAddress,
      success: params.success,
      reason: params.reason ?? null,
    });
    await pool.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.companyId,
        action,
        description,
        params.userId ?? 0,
        params.userName ?? params.username,
        metadata,
      ]
    );
  } catch (err) {
    console.error("[audit_log] login audit write failed", err);
  }
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
  const ip = getClientIp(req as any);
  // Sentinel company_id for audit rows where the company cannot be determined.
  const auditCompanyId = requestedCompanyId ?? 0;

  // Since usernames are unique per company (not globally), the lookup MUST be
  // scoped to a specific company. Two strategies:
  //
  //   • companyId provided (regular user login): match (username, company_id).
  //   • No companyId (super_admin login):         match (username, company_id IS NULL).
  //
  // This means a regular user MUST select their company on the login screen.
  // The login form's company picker already sends companyId for all non-super_admin
  // accounts, so this is transparent to the user.
  let user: typeof usersTable.$inferSelect | undefined;
  if (requestedCompanyId != null) {
    const [found] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.username, username), eq(usersTable.companyId, requestedCompanyId)));
    user = found;
  } else {
    // No company selected → super_admin only (company_id IS NULL).
    const [found] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.username, username), isNull(usersTable.companyId)));
    user = found;
  }

  if (!user || !checkPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    await writeLoginAudit({ username, companyId: auditCompanyId, ipAddress: ip, success: false, reason: "wrong_password" });
    return;
  }

  // Inactive accounts are rejected immediately, regardless of role or company.
  if (!user.isActive) {
    res.status(403).json({ error: "Your account has been deactivated. Contact administrator." });
    await writeLoginAudit({ username, companyId: user.companyId ?? auditCompanyId, ipAddress: ip, success: false, reason: "inactive_account", userId: user.id, userName: user.name });
    return;
  }

  // MULTI-COMPANY GUARD: every non-super_admin user MUST be bound to a company.
  if (user.role !== "super_admin" && user.companyId == null) {
    res.status(403).json({
      error: "Your account is not assigned to any company. Contact the Super Admin to fix this.",
    });
    await writeLoginAudit({ username, companyId: 0, ipAddress: ip, success: false, reason: "no_company_binding", userId: user.id, userName: user.name });
    return;
  }

  // Login-screen "Switch Company" selection — must match the user's own company.
  if (user.role !== "super_admin" && switchTarget != null) {
    if (user.companyId == null || user.companyId !== switchTarget) {
      res.status(403).json({
        error: "Your account does not belong to the selected company.",
      });
      await writeLoginAudit({ username, companyId: switchTarget, ipAddress: ip, success: false, reason: "company_mismatch", userId: user.id, userName: user.name });
      return;
    }
  } else if (!isAccountAllowedHere(user.role, user.companyId ?? null)) {
    // Dedicated single-company deployment lock.
    res.status(403).json({
      error: "This system is dedicated to another company. You cannot sign in here.",
    });
    await writeLoginAudit({ username, companyId: user.companyId ?? auditCompanyId, ipAddress: ip, success: false, reason: "deployment_lock", userId: user.id, userName: user.name });
    return;
  }

  // Subscription gating — block expired/suspended tenant companies.
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
      await writeLoginAudit({ username, companyId: user.companyId, ipAddress: ip, success: false, reason: "subscription_expired", userId: user.id, userName: user.name });
      return;
    }
  }

  // All checks passed — issue session.
  const sessionCompanyId =
    user.role === "super_admin"
      ? null
      : switchTarget ?? getDefaultCompanyId() ?? user.companyId ?? null;

  (req as any).session = {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    entityId: user.entityId ?? null,
    companyId: sessionCompanyId,
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

  // Audit success after sending the response.
  await writeLoginAudit({
    username,
    companyId: sessionCompanyId ?? 0,
    ipAddress: ip,
    success: true,
    userId: user.id,
    userName: user.name,
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

// GET /auth/audit-log — user-management audit trail, super_admin only.
// Returns password changes, role changes, user creation/activation events across
// ALL companies. Regular admins/users cannot access this endpoint.
// Optional query params: ?company_id=N  ?action=password_changed  ?limit=500
router.get("/auth/audit-log", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Re-check role from DB — never trust a potentially stale cookie.
  const [caller] = await db
    .select({ role: usersTable.role, isActive: usersTable.isActive })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId));
  if (!caller || !caller.isActive || caller.role !== "super_admin") {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }

  const USER_MANAGEMENT_ACTIONS = [
    "login_success",
    "login_failure",
    "user_created",
    "password_changed",
    "role_changed",
    "user_activated",
    "user_deactivated",
    "subscription_admin_created",
  ];

  const filterAction = String(req.query.action ?? "").trim();
  const filterCompany = Number(req.query.company_id ?? 0);
  const limit = Math.min(Number(req.query.limit ?? 500), 2000);

  // Build dynamic WHERE clause.
  const params: (string | number | string[])[] = [];
  const conditions: string[] = [];

  // Always restrict to user-management action types.
  const actionList = filterAction && USER_MANAGEMENT_ACTIONS.includes(filterAction)
    ? [filterAction]
    : USER_MANAGEMENT_ACTIONS;
  params.push(actionList);
  conditions.push(`action = ANY($${params.length})`);

  if (filterCompany > 0) {
    params.push(filterCompany);
    conditions.push(`company_id = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT
       al.id,
       al.company_id,
       c.name AS company_name,
       al.action,
       al.description,
       al.user_id       AS actor_id,
       al.user_name     AS actor_name,
       al.metadata,
       al.created_at
     FROM audit_log al
     LEFT JOIN companies c ON c.id = al.company_id
     ${where}
     ORDER BY al.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  res.json(
    rows.map((r) => {
      let meta: Record<string, unknown> = {};
      try {
        meta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : {};
      } catch {
        // malformed metadata — return empty
      }
      return {
        id: Number(r.id),
        companyId: Number(r.company_id),
        companyName: r.company_name ?? null,
        action: r.action,
        description: r.description ?? null,
        actorId: Number(r.actor_id),
        actorName: r.actor_name ?? null,
        targetUsername: (meta.targetUsername as string) ?? null,
        targetUserId: (meta.targetUserId as number) ?? null,
        oldRole: (meta.oldRole as string) ?? null,
        newRole: (meta.newRole as string) ?? null,
        ipAddress: (meta.ipAddress as string) ?? null,
        createdAt: new Date(r.created_at).toISOString(),
      };
    })
  );
});

export default router;
