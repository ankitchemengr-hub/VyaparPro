// Deployment-level configuration that decides whether this instance runs as a
// shared multi-tenant SaaS (company chosen per-user at login) or as a dedicated
// single-company install (locked to one company, e.g. handed to "Shradha
// Enterprises"). Driven by environment variables so the SAME codebase can be
// deployed in either mode without code changes.
//
//   DEFAULT_COMPANY_ID = <numeric company id>
//     -> if set, this is a DEDICATED single-company install locked to that id.
//     -> if NOT set, this is the shared multi-tenant SaaS (default).
//
// That single variable is the whole switch. (MULTI_COMPANY_MODE is still honored
// as an optional explicit override for backwards compatibility, but you do not
// need it — just set DEFAULT_COMPANY_ID to lock the system to one company.)
//
// SECURITY: the frontend reads this config to adjust the login screen, but it is
// NEVER trusted for access control. Enforcement happens in the login handler and
// in every data route via the session companyId — see lib/tenant.ts.

// Raw PRESENCE of the env var (any non-empty value), independent of whether it
// parses to a valid id. This is what flips the install into dedicated mode, so a
// malformed value can never silently fall back to open multi-tenant access.
export function hasDefaultCompanyIdEnv(): boolean {
  const raw = process.env.DEFAULT_COMPANY_ID;
  return raw != null && raw.trim() !== "";
}

export function getDefaultCompanyId(): number | null {
  const raw = process.env.DEFAULT_COMPANY_ID;
  if (!raw) return null;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function isMultiCompanyMode(): boolean {
  // Presence of DEFAULT_COMPANY_ID is the simple trigger: if it's set (even to a
  // malformed value), this is a dedicated single-company install. A malformed id
  // then makes getDefaultCompanyId() null, and isAccountAllowedHere() denies all
  // non-super_admin accounts (fail-closed) rather than reverting to shared mode.
  if (hasDefaultCompanyIdEnv()) return false;
  // Optional explicit override; defaults to shared SaaS when unset.
  const raw = (process.env.MULTI_COMPANY_MODE ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

// Single source of truth for "may this account be served by this deployment?".
// Used both at login and on every authenticated request (defense in depth).
//
// FAIL-CLOSED: in dedicated mode, if DEFAULT_COMPANY_ID is missing/invalid we
// deny all non-super_admin accounts rather than silently allowing everyone — a
// misconfigured dedicated install must never fall back to open multi-tenant
// access. The platform super_admin is always allowed so the operator can fix it.
export function isAccountAllowedHere(role: string, companyId: number | null): boolean {
  if (isMultiCompanyMode()) return true;
  if (role === "super_admin") return true;
  const defaultCompanyId = getDefaultCompanyId();
  if (defaultCompanyId == null) return false;
  return companyId === defaultCompanyId;
}
