// One-time email codes and trusted devices — for accounts that signed up
// through the website (users.login_otp_required = true). Older accounts
// (created before this) keep logging in exactly as before.
//
//  • signup_verify — sent right after website signup; proves the email.
//  • login         — sent when such an account logs in with an unverified
//                    email or from a device it hasn't trusted yet. The
//                    already-checked session is parked on the challenge and
//                    only issued once the code is right.
//  • change_email  — sent to a NEW login email before it replaces the old one.
//
// Codes are 6 digits, valid 10 minutes, 5 wrong tries, resend after 60s (max
// 5 sends). Only an HMAC of the code is stored. A trusted device is a random
// token in a signed, httpOnly cookie, remembered for 30 days.
//
// Emergency switch: AUTH_OTP_DISABLED=true skips login codes entirely (e.g.
// if email sending breaks), so no customer is ever locked out by this.
import crypto from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { sendMail } from "./mailer";
import { codeEmail } from "./customer-emails";
import { logger } from "./logger";

export type ChallengePurpose = "signup_verify" | "login" | "change_email";

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS = 5;
export const TRUSTED_DEVICE_DAYS = 30;
const DEVICE_COOKIE = "td";

export class CodeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function otpDisabled(): boolean {
  return (process.env["AUTH_OTP_DISABLED"] ?? "").trim().toLowerCase() === "true";
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
function codeHash(token: string, code: string): string {
  return crypto.createHmac("sha256", process.env["SESSION_SECRET"] ?? "").update(`${token}:${code}`).digest("hex");
}

// "ankitchemengr@gmail.com" → "an•••••••••r@gmail.com"
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (local.length <= 2) return `${local[0] ?? ""}•@${domain}`;
  return `${local.slice(0, 2)}${"•".repeat(Math.min(local.length - 3, 8))}${local.slice(-1)}@${domain}`;
}

async function sendCode(email: string, purpose: ChallengePurpose, code: string): Promise<boolean> {
  const { subject, html } = codeEmail(purpose, code);
  return sendMail(email, subject, html);
}

// Starts a challenge (replacing any open one of the same purpose for this
// user) and emails the code. Returns the opaque challenge id for the client.
export async function createChallenge(params: {
  userId: number;
  purpose: ChallengePurpose;
  email: string;
  payload?: unknown;
}): Promise<{ challengeId: string; email: string; sent: boolean }> {
  const token = crypto.randomBytes(24).toString("hex");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `UPDATE auth_challenges SET consumed_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [params.userId, params.purpose],
  );
  await pool.query(
    `INSERT INTO auth_challenges (user_id, purpose, token_hash, code_hash, email, payload, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' milliseconds')::interval)`,
    [params.userId, params.purpose, sha256(token), codeHash(token, code), params.email,
      params.payload === undefined ? null : JSON.stringify(params.payload), String(CODE_TTL_MS)],
  );
  const sent = await sendCode(params.email, params.purpose, code);
  if (!sent) logger.error({ userId: params.userId, purpose: params.purpose }, "Verification code email failed");
  return { challengeId: token, email: maskEmail(params.email), sent };
}

async function openChallenge(token: unknown, purpose: ChallengePurpose) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) throw new CodeError("This code has expired. Please start again.", 410);
  const { rows } = await pool.query(
    `SELECT * FROM auth_challenges WHERE token_hash = $1 AND purpose = $2`,
    [sha256(token), purpose],
  );
  const ch = rows[0];
  if (!ch || ch.consumed_at) throw new CodeError("This code has expired. Please start again.", 410);
  return ch;
}

// Checks a code. On success the challenge is consumed (single use) and its
// row (user_id, email, payload) is returned.
export async function verifyChallenge(token: unknown, purpose: ChallengePurpose, code: unknown) {
  const ch = await openChallenge(token, purpose);
  if (new Date(ch.expires_at) < new Date()) throw new CodeError("This code has expired. Tap “Resend code” for a new one.", 410);
  if (ch.attempts >= MAX_ATTEMPTS) throw new CodeError("Too many wrong tries. Tap “Resend code” for a new one.", 429);
  const clean = typeof code === "string" ? code.replace(/\D/g, "") : "";
  const expected = Buffer.from(ch.code_hash, "hex");
  const given = Buffer.from(codeHash(token as string, clean), "hex");
  if (clean.length !== 6 || !crypto.timingSafeEqual(expected, given)) {
    await pool.query(`UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
    const left = MAX_ATTEMPTS - ch.attempts - 1;
    throw new CodeError(left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong tries. Tap “Resend code” for a new one.", left > 0 ? 400 : 429);
  }
  const { rowCount } = await pool.query(
    `UPDATE auth_challenges SET consumed_at = NOW() WHERE id = $1 AND consumed_at IS NULL`,
    [ch.id],
  );
  if (!rowCount) throw new CodeError("This code has already been used.", 410);
  return ch as { id: number; user_id: number; email: string; payload: any };
}

// New code for the same challenge (same challenge id), with a cooldown.
export async function resendChallenge(token: unknown, purpose: ChallengePurpose): Promise<{ email: string }> {
  const ch = await openChallenge(token, purpose);
  const wait = RESEND_COOLDOWN_MS - (Date.now() - new Date(ch.last_sent_at).getTime());
  if (wait > 0) throw new CodeError(`Please wait ${Math.ceil(wait / 1000)} seconds before asking for a new code.`, 429);
  if (ch.send_count >= MAX_SENDS) throw new CodeError("Too many codes sent. Please start again in a little while.", 429);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `UPDATE auth_challenges
       SET code_hash = $1, attempts = 0, send_count = send_count + 1, last_sent_at = NOW(),
           expires_at = NOW() + ($2 || ' milliseconds')::interval
     WHERE id = $3`,
    [codeHash(token as string, code), String(CODE_TTL_MS), ch.id],
  );
  if (!(await sendCode(ch.email, purpose, code))) {
    throw new CodeError("We couldn't send the code right now. Please try again in a few minutes.", 503);
  }
  return { email: maskEmail(ch.email) };
}

// ── Trusted devices ────────────────────────────────────────────────────────

export async function isDeviceTrusted(req: Request, userId: number): Promise<boolean> {
  const token = (req as any).signedCookies?.[DEVICE_COOKIE];
  if (typeof token !== "string" || !token) return false;
  const { rows } = await pool.query(
    `UPDATE trusted_devices SET last_used_at = NOW()
     WHERE user_id = $1 AND token_hash = $2 AND expires_at > NOW()
     RETURNING id`,
    [userId, sha256(token)],
  );
  return rows.length > 0;
}

export async function trustDevice(req: Request, res: Response, userId: number): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO trusted_devices (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)`,
    [userId, sha256(token), String(req.headers["user-agent"] ?? "").slice(0, 300), String(TRUSTED_DEVICE_DAYS)],
  );
  res.cookie(DEVICE_COOKIE, token, {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    path: "/",
    maxAge: TRUSTED_DEVICE_DAYS * 24 * 60 * 60 * 1000,
  });
}

// After a password change/reset: forget every trusted device except (when
// given) the one making the request, so a new device must prove the email.
export async function forgetTrustedDevices(userId: number, keepReq?: Request): Promise<void> {
  const keep = (keepReq as any)?.signedCookies?.[DEVICE_COOKIE];
  await pool.query(
    `DELETE FROM trusted_devices WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)`,
    [userId, typeof keep === "string" && keep ? sha256(keep) : null],
  );
}
