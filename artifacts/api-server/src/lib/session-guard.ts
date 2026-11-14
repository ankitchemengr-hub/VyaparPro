import { createHash } from "node:crypto";
import { pool } from "@workspace/db";

// The session lives entirely in a signed cookie, so on its own it can't be
// taken back: a disabled user, a changed role or a changed password would
// keep working until the cookie stopped being used. Every /api request with a
// session is therefore checked against the users row, and a session older
// than SESSION_MAX_AGE_MS must sign in again even if it stays in use.

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Short fingerprint of the password hash. Changing the password changes it,
// which signs out every other device that still carries the old value.
export function passwordVersion(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("hex").slice(0, 16);
}

export interface SessionUserRow {
  role: string;
  is_active: boolean;
  company_id: number | null;
  password_hash: string;
}

// Pure decision, so it can be tested without a database. Returns the session
// to keep (stamped with iat/pv when an older cookie lacks them) or null.
export function checkSession(session: any, user: SessionUserRow | undefined, now: number = Date.now()): any | null {
  if (!user || !user.is_active) return null;
  if (user.role !== session.role) return null;
  if (user.role !== "super_admin" && (user.company_id ?? null) !== (session.companyId ?? null)) return null;
  const pv = passwordVersion(user.password_hash);
  if (session.pv != null && session.pv !== pv) return null;
  const iat = typeof session.iat === "number" ? session.iat : now;
  if (now - iat > SESSION_MAX_AGE_MS) return null;
  if (session.pv === pv && session.iat === iat) return session;
  // Cookie minted before these checks existed: stamp it once.
  return { ...session, pv, iat };
}

export async function validateSession(session: any): Promise<any | null> {
  const userId = Number(session?.userId);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const { rows } = await pool.query<SessionUserRow>(
    `SELECT role, is_active, company_id, password_hash FROM users WHERE id = $1`,
    [userId],
  );
  return checkSession(session, rows[0]);
}
