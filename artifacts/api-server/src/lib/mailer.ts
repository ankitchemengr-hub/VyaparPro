// Transactional email — Gmail SMTP via an App Password until a dedicated
// sender (Resend/Brevo/SendGrid) is set up. Sends are best-effort: a failure
// is logged, never thrown, so a broken mail server can't 500 an API call
// that already did its real work (e.g. saving a reset token).
import nodemailer from "nodemailer";
import { logger } from "./logger";

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
  });
}

export type MailAttachment = { filename: string; content: Buffer; contentType?: string };

export async function sendMail(to: string, subject: string, html: string, attachments?: MailAttachment[]): Promise<boolean> {
  const transport = getTransport();
  if (!transport) {
    logger.warn({ to, subject }, "Email not sent — SMTP is not configured");
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
