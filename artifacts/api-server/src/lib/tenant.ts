import type { Request, Response, NextFunction } from "express";
import { isAccountAllowedHere } from "./system-config";

// The authenticated session shape stored in the signed cookie.
export interface AppSession {
  userId: number;
  username: string;
  role: string;
  name: string;
  entityId: number | null;
  // Tenant company this user belongs to. NULL only for platform `super_admin`,
  // which operates across all companies and is never scoped to one.
  companyId: number | null;
  // The company the platform `super_admin` has "switched into". Only ever set
  // for super_admin; regular users are scoped by `companyId` instead. When set,
  // every company-scoped route treats the super_admin as a member of this
  // company so it can view/manage that tenant's data.
  activeCompanyId?: number | null;
  // True when this regular user signed in via the login-screen "Switch Company"
  // feature into their OWN company. Login already validated companyId ===
  // user.companyId, so this lets requireAuth skip the dedicated-deployment lock
  // for this session (it would otherwise 403 a non-default-company user on every
  // request). Set server-side only; the signed cookie makes it tamper-proof.
  companySwitch?: boolean;
}

// Raised when a request that requires a tenant context has none (e.g. an
// unauthenticated request, or a super_admin hitting a company-scoped route).
export class TenantContextError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "TenantContextError";
    this.status = status;
  }
}

export function getSession(req: Request): AppSession | null {
  return ((req as any).session as AppSession | null) ?? null;
}

export function isSuperAdmin(req: Request): boolean {
  return getSession(req)?.role === "super_admin";
}

// Returns the caller's company id, or throws if there is no tenant context.
// Use this in every company-scoped route — reads MUST filter by it and writes
// MUST stamp it, so tenants can never see or touch another tenant's rows.
export function getCompanyId(req: Request): number {
  const session = getSession(req);
  if (!session || !session.userId) {
    throw new TenantContextError("Not authenticated", 401);
  }
  // Platform super_admin has no home company. It scopes to whichever company it
  // has switched into (session.activeCompanyId). Until one is selected it has no
  // tenant context, so company-scoped routes must not silently leak data.
  if (session.role === "super_admin") {
    if (session.activeCompanyId == null) {
      throw new TenantContextError("Select a company to continue", 409);
    }
    return session.activeCompanyId;
  }
  if (session.companyId == null) {
    throw new TenantContextError("No tenant context for this account", 403);
  }
  return session.companyId;
}

// Convenience accessor used by the login flow and middleware to read the active
// tenant company for the current request. Thin wrapper over getCompanyId.
export function getCurrentCompanyId(req: Request): number {
  return getCompanyId(req);
}

// Express middleware: require a logged-in user before any data route runs and
// expose convenience flags. This is the single choke point that guarantees no
// data route can be reached anonymously.
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const session = getSession(req);
  if (!session || !session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  // Defense in depth: re-check the dedicated-company lock on EVERY request, not
  // just at login. Otherwise a session minted before the instance was switched
  // to dedicated mode (or for a different company) would keep working until the
  // cookie expired. Fail-closed and clear the stale session so the SPA re-logs in.
  // Exception: a session that signed in via the validated "Switch Company" flow
  // (companySwitch) is allowed into its own company even on a dedicated install —
  // login already proved companyId === user.companyId.
  if (!session.companySwitch && !isAccountAllowedHere(session.role, session.companyId ?? null)) {
    res.clearCookie("session", { path: "/" });
    res.status(403).json({ error: "This system is dedicated to another company." });
    return;
  }
  // For a normal user this is their home company; for the platform super_admin
  // it is whichever company they have switched into (null until they pick one).
  (req as any).companyId =
    session.role === "super_admin"
      ? session.activeCompanyId ?? null
      : session.companyId ?? null;
  (req as any).isSuperAdmin = session.role === "super_admin";
  next();
}

// Express middleware: restrict a route to the platform super_admin.
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isSuperAdmin(req)) {
    res.status(403).json({ error: "Super admin access required" });
    return;
  }
  next();
}

// Central error translator so routes can simply `throw` a TenantContextError.
export function handleTenantError(err: unknown, res: Response): boolean {
  if (err instanceof TenantContextError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  return false;
}
