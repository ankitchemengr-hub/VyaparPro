import { Router, type IRouter } from "express";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";
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
import { getCurrentCompany } from "../lib/company";
import { verifyPassword } from "../lib/password";
import { loginRateLimitKey, checkLoginRateLimit, recordLoginFailure, clearLoginAttempts } from "../lib/login-rate-limit";
import { hashPassword } from "../lib/password";
import { isUsernameTaken } from "../lib/username";
import {
  CodeError, otpDisabled, createChallenge, verifyChallenge, resendChallenge,
  isDeviceTrusted, trustDevice, forgetTrustedDevices,
} from "../lib/auth-codes";

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

  // Brute-force guard — keyed by ip+username so unlimited password guesses
  // against one account are blocked without penalizing other users on the
  // same shared IP (e.g. a shop's wifi).
  const rateLimitKey = loginRateLimitKey(ip, username);
  const rateLimit = checkLoginRateLimit(rateLimitKey);
  if (rateLimit.blocked) {
    res.status(429).json({
      error: `Too many failed login attempts. Try again in ${Math.ceil(rateLimit.retryAfterMs / 60000)} minute(s).`,
    });
    await writeLoginAudit({ username, companyId: auditCompanyId, ipAddress: ip, success: false, reason: "rate_limited" });
    return;
  }

  // Since usernames are unique per company (not globally), the lookup MUST be
  // scoped to a specific company. Two strategies:
  //
  //   • companyId provided (regular user login): match (username, company_id).
  //   • No companyId (super_admin login):         match (username, company_id IS NULL).
  //
  // This means a regular user MUST select their company on the login screen.
  // The login form's company picker already sends companyId for all non-super_admin
  // accounts, so this is transparent to the user.
  // Case-insensitive username match — a phone/PC with caps-lock or
  // autocapitalize on ("ADMIN" vs stored "admin") must not fail login.
  const usernameMatch = eq(sql`lower(trim(${usersTable.username}))`, username.trim().toLowerCase());

  // Usernames are only unique WITHIN a company, so the same name (e.g.
  // "accountant") can exist in several companies. Among the rows a lookup
  // returns, the one whose password verifies is the account being signed into.
  // `failReason` records why nothing matched, for the audit log.
  type FailReason = "unknown_user" | "wrong_password" | "ambiguous_username";
  let failReason = "unknown_user" as FailReason;
  const pickByPassword = (rows: (typeof usersTable.$inferSelect)[]) => {
    if (rows.length === 0) return undefined;
    const ok = rows.filter((r) => verifyPassword(password, r.passwordHash));
    if (ok.length === 1) return ok[0];
    failReason = ok.length > 1 ? "ambiguous_username" : "wrong_password";
    return undefined;
  };

  let user: typeof usersTable.$inferSelect | undefined;
  // The company the login screen asked for. Cleared below when it turns out to
  // be a stale leftover, so the session isn't flagged as a validated switch.
  let effectiveSwitch: number | null = switchTarget;
  if (requestedCompanyId != null) {
    const rows = await db
      .select()
      .from(usersTable)
      .where(and(usernameMatch, eq(usersTable.companyId, requestedCompanyId)));
    user = pickByPassword(rows);
    // No such username in that company at all: the company id is most likely a
    // stale login-screen selection remembered by this browser (the hidden
    // super-admin switcher), not the user's choice — look the account up the
    // normal way instead of failing every login from this device.
    if (!user && rows.length === 0) effectiveSwitch = null;
  }
  if (!user && effectiveSwitch == null) {
    // No company selected — try super_admin (company_id IS NULL) first.
    user = pickByPassword(await db
      .select()
      .from(usersTable)
      .where(and(usernameMatch, isNull(usersTable.companyId))));
    if (!user) {
      // Dedicated single-company installs have no company picker on the login
      // screen at all, so regular staff never send a companyId — fall back to
      // the deployment's locked-in company instead of failing the lookup.
      const defaultCompanyId = getDefaultCompanyId();
      if (defaultCompanyId != null) {
        user = pickByPassword(await db
          .select()
          .from(usersTable)
          .where(and(usernameMatch, eq(usersTable.companyId, defaultCompanyId))));
      }

      // Shared multi-tenant mode: regular staff never see a company picker.
      // Search every company; the password tells same-named accounts apart.
      if (!user) {
        user = pickByPassword(await db
          .select()
          .from(usersTable)
          .where(and(usernameMatch, isNotNull(usersTable.companyId))));
      }
    }
  }

  if (!user) {
    recordLoginFailure(rateLimitKey);
    if (failReason === "ambiguous_username") {
      // Same username AND same password in two companies — can't tell which.
      res.status(409).json({
        error: "This username is used in more than one company. Ask your admin to give you a different username.",
      });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
    await writeLoginAudit({ username, companyId: auditCompanyId, ipAddress: ip, success: false, reason: failReason });
    return;
  }
  clearLoginAttempts(rateLimitKey);

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
  if (user.role !== "super_admin" && effectiveSwitch != null) {
    if (user.companyId == null || user.companyId !== effectiveSwitch) {
      res.status(403).json({
        error: "Your account does not belong to the selected company.",
      });
      await writeLoginAudit({ username, companyId: effectiveSwitch, ipAddress: ip, success: false, reason: "company_mismatch", userId: user.id, userName: user.name });
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
      : effectiveSwitch ?? getDefaultCompanyId() ?? user.companyId ?? null;

  const session = {
    userId: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    entityId: user.entityId ?? null,
    pricingTier: user.pricingTier ?? null,
    companyId: sessionCompanyId,
    companySwitch: user.role !== "super_admin" && effectiveSwitch != null,
  };

  const loginCompany = await getCurrentCompany(sessionCompanyId);

  const body = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    customerId: user.entityId ?? null,
    pricingTier: user.pricingTier ?? null,
    canEditRate: user.canEditRate ?? false,
    canReceiveProduction: user.canReceiveProduction ?? false,
    companyId: sessionCompanyId,
    company: loginCompany ? { name: loginCompany.name, logo: loginCompany.logo ?? null } : null,
  };

  // Website-signup accounts: an unverified email, or a device this account
  // hasn't trusted yet, needs the emailed code first. The checked session is
  // parked on the challenge and issued by POST /auth/login/verify.
  if (user.loginOtpRequired && !otpDisabled()) {
    const reason = !user.emailVerifiedAt ? "verify_email" : (await isDeviceTrusted(req, user.id)) ? null : "new_device";
    if (reason) {
      const ch = await createChallenge({
        userId: user.id, purpose: "login", email: user.username,
        payload: { session, body, username, ip },
      });
      if (!ch.sent) {
        res.status(503).json({ error: "We couldn't send your login code right now. Please try again in a few minutes, or contact support." });
        return;
      }
      res.status(202).json({ challenge: "email_code", reason, challengeId: ch.challengeId, email: ch.email });
      return;
    }
  }

  (req as any).session = session;
  res.json(body);

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

// ---------------------------------------------------------------------------
// Email codes: new-device / unverified-email login, change password & email
// ---------------------------------------------------------------------------

const MIN_PASSWORD = 8;

function codeErrorResponse(err: unknown, res: import("express").Response): boolean {
  if (err instanceof CodeError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}

// POST /auth/login/verify { challengeId, code, rememberDevice? } — finishes a
// login that answered 202 { challenge: "email_code" }.
router.post("/auth/login/verify", async (req, res): Promise<void> => {
  try {
    const ch = await verifyChallenge(req.body?.challengeId, "login", req.body?.code);
    const { session, body, username, ip } = ch.payload ?? {};
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, ch.user_id));
    if (!session || !user || !user.isActive) {
      res.status(403).json({ error: "This account can't sign in right now. Contact support." });
      return;
    }
    if (!user.emailVerifiedAt) {
      await pool.query(`UPDATE users SET email_verified_at = NOW() WHERE id = $1`, [user.id]);
    }
    if (req.body?.rememberDevice !== false) await trustDevice(req, res, user.id);
    (req as any).session = session;
    res.json(body);
    await writeLoginAudit({
      username: username ?? user.username, companyId: session.companyId ?? 0,
      ipAddress: ip ?? getClientIp(req as any), success: true, userId: user.id, userName: user.name,
    });
  } catch (err) {
    if (!codeErrorResponse(err, res)) throw err;
  }
});

// POST /auth/login/resend { challengeId }
router.post("/auth/login/resend", async (req, res): Promise<void> => {
  try {
    res.json(await resendChallenge(req.body?.challengeId, "login"));
  } catch (err) {
    if (!codeErrorResponse(err, res)) throw err;
  }
});

function sessionUserId(req: import("express").Request): number | null {
  const id = (req as any).session?.userId;
  return typeof id === "number" ? id : null;
}

// POST /auth/change-password { currentPassword, newPassword } — any signed-in
// user changes their own password. Other trusted devices are forgotten, so a
// new device has to prove the email again (website-signup accounts).
router.post("/auth/change-password", async (req, res): Promise<void> => {
  const userId = sessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    res.status(400).json({ error: "Enter your current and new password" });
    return;
  }
  if (newPassword.length < MIN_PASSWORD) {
    res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD} characters` });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    res.status(400).json({ error: "Current password is wrong" });
    return;
  }
  if (verifyPassword(newPassword, user.passwordHash)) {
    res.status(400).json({ error: "New password must be different from the current one" });
    return;
  }
  await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hashPassword(newPassword), userId]);
  await forgetTrustedDevices(userId, req);
  res.json({ message: "Password changed" });
});

// POST /auth/change-email { newEmail, password } — a company admin whose login
// is an email moves it to a new address; a code goes to the NEW address and
// POST /auth/change-email/verify applies it.
router.post("/auth/change-email", async (req, res): Promise<void> => {
  const userId = sessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const newEmail = String(req.body?.newEmail ?? "").trim().toLowerCase();
  const password = req.body?.password;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.role !== "admin" || !user.username.includes("@")) {
    res.status(403).json({ error: "Only a company admin with an email login can change it here" });
    return;
  }
  if (typeof password !== "string" || !verifyPassword(password, user.passwordHash)) {
    res.status(400).json({ error: "Password is wrong" });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(newEmail) || newEmail.length > 200) {
    res.status(400).json({ error: "Enter a valid email address" });
    return;
  }
  if (newEmail === user.username.toLowerCase()) {
    res.status(400).json({ error: "This is already your login email" });
    return;
  }
  if (await isUsernameTaken(pool, newEmail)) {
    res.status(409).json({ error: "This email is already used by another account" });
    return;
  }
  const ch = await createChallenge({ userId, purpose: "change_email", email: newEmail, payload: { newEmail } });
  if (!ch.sent) {
    res.status(503).json({ error: "We couldn't send the code right now. Please try again in a few minutes." });
    return;
  }
  res.json({ challengeId: ch.challengeId, email: ch.email });
});

// POST /auth/change-email/resend { challengeId }
router.post("/auth/change-email/resend", async (req, res): Promise<void> => {
  if (!sessionUserId(req)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    res.json(await resendChallenge(req.body?.challengeId, "change_email"));
  } catch (err) {
    if (!codeErrorResponse(err, res)) throw err;
  }
});

// POST /auth/change-email/verify { challengeId, code }
router.post("/auth/change-email/verify", async (req, res): Promise<void> => {
  const userId = sessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    const ch = await verifyChallenge(req.body?.challengeId, "change_email", req.body?.code);
    const newEmail = String(ch.payload?.newEmail ?? "");
    if (ch.user_id !== userId || !newEmail) {
      res.status(403).json({ error: "This code belongs to another session" });
      return;
    }
    if (await isUsernameTaken(pool, newEmail)) {
      res.status(409).json({ error: "This email is already used by another account" });
      return;
    }
    const { rows } = await pool.query(
      `UPDATE users SET username = $1, email_verified_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING company_id`,
      [newEmail, userId],
    );
    // Keep the company's contact email (reminders, invoices) on the new address
    // when it was the old login email.
    const companyId = rows[0]?.company_id;
    if (companyId) {
      await pool.query(
        `UPDATE companies SET email = $1, updated_at = NOW()
         WHERE id = $2 AND (email IS NULL OR lower(email) = lower($3))`,
        [newEmail, companyId, (req as any).session?.username ?? ""],
      );
    }
    (req as any).session = { ...(req as any).session, username: newEmail };
    res.json({ message: "Login email changed", username: newEmail });
  } catch (err) {
    if (!codeErrorResponse(err, res)) throw err;
  }
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
    pricingTier: user.pricingTier ?? null,
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

  // Effective company for branding: the user's own company, or (for a
  // super_admin) whichever company they've switched into.
  const activeCompanyId = (session.activeCompanyId as number | null | undefined) ?? null;
  const meCompany = await getCurrentCompany(user.companyId ?? activeCompanyId);

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    customerId: user.entityId ?? null,
    pricingTier: user.pricingTier ?? null,
    // Read fresh from the DB on every /auth/me, so turning it on/off in User
    // Accounts takes effect on the store user's next page load.
    canEditRate: user.canEditRate ?? false,
    canReceiveProduction: user.canReceiveProduction ?? false,
    companyId: user.companyId ?? null,
    // Surface the super_admin's currently switched-into company so the SPA can
    // show the right company context and unlock ERP navigation. Null for normal
    // users and for a super_admin that hasn't picked a company yet.
    activeCompanyId,
    company: meCompany ? { name: meCompany.name, logo: meCompany.logo ?? null } : null,
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
  // Only the company admin (or super_admin inside a company) may change what
  // other roles can do — otherwise any logged-in user could widen their own access.
  const role = (req as any).session?.role;
  if (role !== "admin" && role !== "super_admin") {
    res.status(403).json({ error: "Forbidden — admin only" });
    return;
  }
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
