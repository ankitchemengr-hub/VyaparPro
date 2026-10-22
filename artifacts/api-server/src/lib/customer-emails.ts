// Lifecycle emails to a subscribing customer (the company that signed up for
// SHRADHA ERP) — welcome on signup, and short reminders before / when the
// subscription runs out. (The payment thank-you goes out with the GST
// invoice — lib/subscription-invoice.ts emailInvoice.)
// Sent through lib/mailer.ts (best-effort: never throws). Every value that
// came from the customer is HTML-escaped.
import { pool } from "@workspace/db";
import { sendMail } from "./mailer";
import { logger } from "./logger";

const BRAND = "SHRADHA ERP";
const BLUE = "#2563eb";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

function portalUrl(path = ""): string {
  const base = (process.env["PORTAL_APPLICATION_URL"] ?? "").replace(/\/+$/, "");
  return base ? `${base}${path}` : "";
}
function erpUrl(): string {
  return (process.env["ERP_APPLICATION_URL"] ?? "").replace(/\/+$/, "");
}

function button(href: string, label: string): string {
  if (!href) return "";
  return `<p style="margin:24px 0;"><a href="${href}" style="background:${BLUE};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">${label}</a></p>`;
}

function layout(title: string, body: string): string {
  return `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;line-height:1.55;">
    <div style="border-bottom:3px solid ${BLUE};padding-bottom:10px;margin-bottom:18px;">
      <span style="font-size:20px;font-weight:bold;color:${BLUE};">${BRAND}</span>
    </div>
    <h2 style="margin:0 0 12px;font-size:20px;">${title}</h2>
    ${body}
    <p style="color:#64748b;font-size:13px;margin-top:28px;border-top:1px solid #e2e8f0;padding-top:12px;">
      Need help? Just reply to this email — we're happy to help.<br/>— Team ${BRAND}
    </p>
  </div>`;
}

// ── One-time code (signup verification / new-device login / email change) ──

export function codeEmail(
  purpose: "signup_verify" | "login" | "change_email",
  code: string,
): { subject: string; html: string } {
  const what = {
    signup_verify: { subject: `Your ${BRAND} verification code: ${code}`, title: "Verify your email", lead: "Use this code to verify your email and finish creating your account:" },
    login: { subject: `Your ${BRAND} login code: ${code}`, title: "Your login code", lead: "Someone (hopefully you) is signing in to your account from a new device. Enter this code to continue:" },
    change_email: { subject: `Confirm your new ${BRAND} login email: ${code}`, title: "Confirm your new email", lead: "Enter this code to make this address your new login email:" },
  }[purpose];
  const body = `
    <p>${what.lead}</p>
    <p style="margin:24px 0;font-size:32px;font-weight:bold;letter-spacing:8px;color:${BLUE};font-family:'Courier New',monospace;">${code}</p>
    <p style="color:#64748b;font-size:14px;">This code expires in 10 minutes. Never share it with anyone — ${BRAND} staff will never ask for it.</p>
    <p style="color:#64748b;font-size:14px;">Didn't ask for this? You can ignore this email${purpose === "login" ? " — but if it keeps happening, change your password" : ""}.</p>`;
  return { subject: what.subject, html: layout(what.title, body) };
}

export interface CompanyContact {
  email: string;
  ownerName: string;
  businessName: string;
}

// Where to reach a customer company: its own email, else its admin's login
// if that is an email address. Null when there's no email at all (mobile-only
// signups) — callers just skip the email.
export async function getCompanyContact(companyId: number): Promise<CompanyContact | null> {
  const { rows } = await pool.query(
    `SELECT c.name, c.owner_name, c.email,
            (SELECT u.username FROM users u WHERE u.company_id = c.id AND u.role = 'admin' AND u.username LIKE '%@%'
             ORDER BY u.id LIMIT 1) AS admin_email
     FROM companies c WHERE c.id = $1`,
    [companyId],
  );
  const r = rows[0];
  const email = (r?.email || r?.admin_email || "").trim();
  if (!r || !email.includes("@")) return null;
  return { email, ownerName: r.owner_name || r.name, businessName: r.name };
}

async function planName(slug: string | null | undefined): Promise<string> {
  if (!slug) return "your plan";
  const { rows } = await pool.query(`SELECT name FROM subscription_plans WHERE slug = $1`, [slug]);
  return rows[0]?.name ?? slug;
}

// ── Welcome (signup) ───────────────────────────────────────────────────────

export async function sendWelcomeEmail(params: {
  companyId: number;
  planSlug: string;
  onTrial: boolean;
  trialEnd: Date;
  loginUsername: string;
}): Promise<void> {
  try {
    const c = await getCompanyContact(params.companyId);
    if (!c) return;
    const plan = escapeHtml(await planName(params.planSlug));
    const erp = erpUrl();
    const body = `
      <p>Hi ${escapeHtml(c.ownerName)},</p>
      <p>Welcome to ${BRAND}! Your account for <b>${escapeHtml(c.businessName)}</b> has been created on the <b>${plan}</b> plan.</p>
      ${params.onTrial
        ? `<p>Your <b>free trial</b> is active until <b>${fmtDate(params.trialEnd)}</b> — explore billing, stock, accounts and reports at no cost.</p>`
        : `<p>Complete your first payment to activate the account. You can do it any time from your customer portal.</p>`}
      <table style="background:#f1f5f9;border-radius:6px;padding:12px 16px;margin:16px 0;font-size:14px;">
        <tr><td style="color:#64748b;padding-right:14px;">Login ID</td><td><b>${escapeHtml(params.loginUsername)}</b></td></tr>
        ${erp ? `<tr><td style="color:#64748b;padding-right:14px;">ERP link</td><td><a href="${erp}">${escapeHtml(erp)}</a></td></tr>` : ""}
      </table>
      <p><b>Get started in 3 steps:</b></p>
      <ol style="padding-left:18px;margin:0;">
        <li>Add your products (or import them) under Inventory.</li>
        <li>Add your customers.</li>
        <li>Make your first bill from Billing.</li>
      </ol>
      ${button(params.onTrial ? erp : portalUrl("/subscription"), params.onTrial ? "Open ERP" : "Complete payment")}`;
    await sendMail(c.email, `Welcome to ${BRAND}, ${c.ownerName}!`, layout("Welcome aboard 🎉", body));
  } catch (err) {
    logger.error({ err, companyId: params.companyId }, "Welcome email failed");
  }
}

// ── Expiry reminders (sent by lib/subscription-scheduler.ts) ───────────────

export async function sendExpiryEmail(params: {
  companyId: number;
  daysRemaining: number; // 0 = today; negative/expired handled by `expired`
  endDate: Date;
  isTrial: boolean;
  expired: boolean;
}): Promise<boolean> {
  try {
    const c = await getCompanyContact(params.companyId);
    if (!c) return false;
    const what = params.isTrial ? "free trial" : "subscription";
    const renew = portalUrl("/subscription");
    let subject: string;
    let title: string;
    let lead: string;
    if (params.expired) {
      subject = `Your ${BRAND} ${what} has expired`;
      title = `Your ${what} has expired`;
      lead = `Your ${BRAND} ${what} for <b>${escapeHtml(c.businessName)}</b> ended on <b>${fmtDate(params.endDate)}</b>, so logins are paused.
        <b>Your data is safe</b> — renew now and everything is back exactly as you left it.`;
    } else if (params.daysRemaining <= 0) {
      subject = `Your ${BRAND} ${what} ends today`;
      title = `Your ${what} ends today`;
      lead = `Your ${what} for <b>${escapeHtml(c.businessName)}</b> ends <b>today</b>. Renew now so billing doesn't stop tomorrow.`;
    } else {
      const d = params.daysRemaining === 1 ? "1 day" : `${params.daysRemaining} days`;
      subject = `Reminder: your ${BRAND} ${what} ends in ${d}`;
      title = `Your ${what} ends in ${d}`;
      lead = `Your ${what} for <b>${escapeHtml(c.businessName)}</b> ends on <b>${fmtDate(params.endDate)}</b>.
        Renew before then to keep billing without interruption.`;
    }
    const body = `<p>Hi ${escapeHtml(c.ownerName)},</p><p>${lead}</p>${button(renew, params.isTrial ? "Choose a plan" : "Renew now")}`;
    return await sendMail(c.email, subject, layout(title, body));
  } catch (err) {
    logger.error({ err, companyId: params.companyId }, "Expiry email failed");
    return false;
  }
}
