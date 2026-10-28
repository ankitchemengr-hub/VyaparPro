// Transactional email. Two ways to send, best-effort either way (a failure is
// logged and returns false, never thrown, so a broken mail setup can't 500 an
// API call that already did its real work):
//
//  • BREVO_API_KEY set → Brevo's HTTPS API (https://api.brevo.com/v3/smtp/email).
//    Use this on Railway Hobby: outbound SMTP ports are blocked there, so SMTP
//    just hangs until it times out.
//  • otherwise SMTP (SMTP_HOST/PORT/USER/PASS) with short timeouts, so a
//    blocked port fails in seconds instead of stalling the request for minutes.
//
// The sender is SMTP_FROM ("Name <address>") in both cases.
import nodemailer from "nodemailer";
import { logger } from "./logger";

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

function parseFrom(): { name?: string; email: string } | null {
  const raw = (process.env["SMTP_FROM"] || process.env["SMTP_USER"] || "").trim();
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : raw).trim();
  if (!email.includes("@")) return null;
  const name = m?.[1]?.trim();
  return name ? { name, email } : { email };
}

async function sendViaBrevoApi(apiKey: string, to: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<boolean> {
  const sender = parseFrom();
  if (!sender) {
    logger.warn({ to, subject }, "Email not sent — SMTP_FROM has no sender address");
    return false;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(attachments?.length
          ? { attachment: attachments.map((a) => ({ name: a.filename, content: a.content.toString("base64") })) }
          : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.error({ to, subject, status: res.status, body: (await res.text()).slice(0, 300) }, "Brevo API rejected email");
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email via Brevo API");
    return false;
  }
}

function getTransport() {
  const host = process.env["SMTP_HOST"];
  const port = process.env["SMTP_PORT"];
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: port ? Number(port) : 587,
    secure: false, // STARTTLS on port 587
    auth: { user, pass },
    // Fail fast when the port is blocked instead of nodemailer's 2-minute default.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export async function sendMail(to: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<boolean> {
  const apiKey = process.env["BREVO_API_KEY"]?.trim();
  if (apiKey) return sendViaBrevoApi(apiKey, to, subject, html, attachments);

  const transport = getTransport();
  if (!transport) {
    logger.warn({ to, subject }, "Email not sent — set BREVO_API_KEY or SMTP_HOST/USER/PASS");
    return false;
  }
  const from = process.env["SMTP_FROM"] || process.env["SMTP_USER"]!;
  try {
    await transport.sendMail({ from, to, subject, html, ...(attachments?.length ? { attachments } : {}) });
    return true;
  } catch (err) {
    logger.error({ err, to, subject }, "Failed to send email");
    return false;
  }
}

// Where staff notifications go (new demo lead, domain request, DNS
// verified). ADMIN_EMAIL wins; otherwise the address in SMTP_FROM (e.g.
// support@shradhaerp.com, forwarded to the owner's inbox). Not SMTP_USER: with
// a relay like Brevo that is an SMTP login, not a mailbox anyone reads.
export function adminNotifyEmail(): string | null {
  const explicit = process.env["ADMIN_EMAIL"]?.trim();
  if (explicit) return explicit;
  const from = process.env["SMTP_FROM"] ?? "";
  const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  if (addr.includes("@")) return addr;
  const user = process.env["SMTP_USER"]?.trim();
  return user && user.includes("@") ? user : null;
}

export function passwordResetEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: "Reset your SHRADHA ERP password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Reset your password</h2>
        <p>We received a request to reset your SHRADHA ERP password. Click the button below to set a new one — this link expires in 1 hour.</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">Reset Password</a>
        </p>
        <p style="color: #64748b; font-size: 14px;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      </div>
    `,
  };
}
