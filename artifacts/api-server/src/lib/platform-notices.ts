// Platform Console → Notices. The platform owner (super_admin) schedules a
// maintenance window once; every customer company is then told by email
// automatically:
//
//   • "announce" — right away when the notice is saved (if asked for),
//   • "reminder" — about an hour before it starts,
//   • "back"     — once the window is over and this server is running again.
//
// While a notice is near or in progress, every ERP screen shows it as a
// banner (GET /system/notice-banner). Unplanned outages can't be announced
// from here — the server is down then — so tools/uptime-watchdog (a
// Cloudflare Worker) does that, using GET /system/notify-list.
import { pool } from "@workspace/db";
import { sendMail } from "./mailer";
import { logger } from "./logger";

const BRAND = "SHRADHA ERP";
const BLUE = "#2563eb";
const REMINDER_BEFORE_MS = 60 * 60 * 1000;
// The banner appears this long before a window starts.
const BANNER_LEAD_MS = 24 * 60 * 60 * 1000;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fmtIst = (d: Date | string) =>
  new Date(d).toLocaleString("en-IN", {
    day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
  });

export type NoticeEmailKind = "announce" | "reminder" | "back";

export interface Notice {
  id: number;
  title: string;
  message: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "cancelled";
  announcedAt: string | null;
  remindedAt: string | null;
  backSentAt: string | null;
  lastSendCount: number | null;
  createdByName: string | null;
  createdAt: string;
}

function formatNotice(r: any): Notice {
  const iso = (v: any) => (v ? new Date(v).toISOString() : null);
  return {
    id: r.id,
    title: r.title,
    message: r.message,
    startsAt: new Date(r.starts_at).toISOString(),
    endsAt: new Date(r.ends_at).toISOString(),
    status: r.status,
    announcedAt: iso(r.announced_at),
    remindedAt: iso(r.reminded_at),
    backSentAt: iso(r.back_sent_at),
    lastSendCount: r.last_send_count ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// Every customer company's signup email, once each.
export async function customerEmails(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT lower(trim(email)) AS email FROM companies
      WHERE email IS NOT NULL AND trim(email) ~* '^[^\\s@]+@[^\\s@]+\\.[a-z]{2,}$'
      ORDER BY 1`,
  );
  return rows.map((r: any) => r.email);
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
      Questions? Just reply to this email.<br/>— Team ${BRAND}
    </p>
  </div>`;
}

export function noticeEmail(kind: NoticeEmailKind, n: Pick<Notice, "title" | "message" | "startsAt" | "endsAt">): { subject: string; html: string } {
  const when = `${fmtIst(n.startsAt)} – ${fmtIst(n.endsAt)} (IST)`;
  const note = n.message.trim()
    ? `<p style="white-space:pre-line;">${escapeHtml(n.message.trim())}</p>`
    : "";
  if (kind === "back") {
    return {
      subject: `${BRAND} is back online`,
      html: layout("We're back online", `
        <p>The scheduled maintenance is over and ${BRAND} is working normally again. You can log in and continue as usual.</p>
        <p>Your data is safe — nothing was lost. Sorry for the inconvenience, and thank you for your patience.</p>
        <p>मेंटेनेंस पूरा हो गया है, ERP फिर से चालू है। आपका सारा data सुरक्षित है। असुविधा के लिए क्षमा करें।</p>`),
    };
  }
  const soon = kind === "reminder";
  return {
    subject: soon
      ? `Reminder: ${BRAND} maintenance starts soon — ${fmtIst(n.startsAt)}`
      : `Scheduled maintenance: ${BRAND} unavailable ${fmtIst(n.startsAt)}`,
    html: layout(escapeHtml(n.title || "Scheduled maintenance"), `
      <p>${soon ? "A reminder: " : ""}${BRAND} will be unavailable for planned maintenance:</p>
      <p style="font-size:16px;font-weight:bold;">${when}</p>
      ${note}
      <p>During this time you won't be able to log in or make bills. Your data is completely safe, and the ERP comes back on its own — you don't need to do anything. Tip: finish or print any urgent bills before it starts.</p>
      <p>${BRAND} ऊपर दिए समय पर maintenance के लिए बंद रहेगा। आपका data पूरी तरह सुरक्षित है, समय पूरा होते ही ERP अपने आप चालू हो जाएगा। ज़रूरी bills पहले बना लें। असुविधा के लिए क्षमा करें।</p>
      <p>Sorry for the inconvenience.</p>`),
  };
}

// One email per address (never a shared To/CC), a few at a time.
export async function sendToAll(subject: string, html: string, emails?: string[]): Promise<{ sent: number; failed: number }> {
  const list = emails ?? (await customerEmails());
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += 5) {
    const results = await Promise.all(list.slice(i, i + 5).map((to) => sendMail(to, subject, html)));
    for (const ok of results) ok ? sent++ : failed++;
  }
  return { sent, failed };
}

const COLUMN: Record<NoticeEmailKind, string> = { announce: "announced_at", reminder: "reminded_at", back: "back_sent_at" };

// Claims the send first (column set inside the UPDATE), so two overlapping
// ticks or server instances can never email everyone twice.
async function sendNoticeEmail(id: number, kind: NoticeEmailKind): Promise<number | null> {
  const col = COLUMN[kind];
  const claimed = await pool.query(
    `UPDATE platform_notices SET ${col} = NOW() WHERE id = $1 AND ${col} IS NULL AND status = 'scheduled' RETURNING *`,
    [id],
  );
  if (claimed.rowCount === 0) return null;
  const n = formatNotice(claimed.rows[0]);
  const { subject, html } = noticeEmail(kind, n);
  const { sent, failed } = await sendToAll(subject, html);
  await pool.query(`UPDATE platform_notices SET last_send_count = $2 WHERE id = $1`, [id, sent]);
  logger.info({ noticeId: id, kind, sent, failed }, "Maintenance notice emails sent");
  return sent;
}

export async function listNotices(): Promise<Notice[]> {
  const { rows } = await pool.query(`SELECT * FROM platform_notices ORDER BY starts_at DESC, id DESC LIMIT 50`);
  return rows.map(formatNotice);
}

export async function createNotice(input: {
  title: string; message: string; startsAt: Date; endsAt: Date; emailNow: boolean;
  createdBy: { userId: number | null; name: string | null };
}): Promise<{ notice: Notice; emailed: number | null }> {
  const { rows } = await pool.query(
    `INSERT INTO platform_notices (title, message, starts_at, ends_at, created_by_user_id, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.title, input.message, input.startsAt, input.endsAt, input.createdBy.userId, input.createdBy.name],
  );
  const id = rows[0].id;
  // Already within the reminder hour → the announcement is the reminder.
  const soon = input.startsAt.getTime() - Date.now() <= REMINDER_BEFORE_MS;
  if (soon) await pool.query(`UPDATE platform_notices SET reminded_at = NOW() WHERE id = $1`, [id]);
  const emailed = input.emailNow ? await sendNoticeEmail(id, "announce") : null;
  const fresh = await pool.query(`SELECT * FROM platform_notices WHERE id = $1`, [id]);
  return { notice: formatNotice(fresh.rows[0]), emailed };
}

export async function cancelNotice(id: number): Promise<Notice | null> {
  const { rows } = await pool.query(
    `UPDATE platform_notices SET status = 'cancelled' WHERE id = $1 AND status = 'scheduled' RETURNING *`,
    [id],
  );
  return rows[0] ? formatNotice(rows[0]) : null;
}

// The notice to show as a banner right now, if any.
export async function currentBanner(now: Date = new Date()): Promise<Pick<Notice, "id" | "title" | "message" | "startsAt" | "endsAt"> | null> {
  const { rows } = await pool.query(
    `SELECT * FROM platform_notices
      WHERE status = 'scheduled' AND ends_at > $1 AND starts_at - make_interval(secs => $2) <= $1
      ORDER BY starts_at ASC LIMIT 1`,
    [now, BANNER_LEAD_MS / 1000],
  );
  if (!rows[0]) return null;
  const n = formatNotice(rows[0]);
  return { id: n.id, title: n.title, message: n.message, startsAt: n.startsAt, endsAt: n.endsAt };
}

// Sends whatever is due: reminders for windows starting within the hour and
// "back online" for windows that have ended. A window that ended more than a
// day ago (server was off far longer) gets no late email.
export async function runDueNoticeEmails(now: Date = new Date()): Promise<number> {
  let sent = 0;
  const reminders = await pool.query(
    `SELECT id FROM platform_notices
      WHERE status = 'scheduled' AND reminded_at IS NULL
        AND starts_at > $1 AND starts_at - make_interval(secs => $2) <= $1`,
    [now, REMINDER_BEFORE_MS / 1000],
  );
  for (const r of reminders.rows) if ((await sendNoticeEmail(r.id, "reminder")) !== null) sent++;
  const back = await pool.query(
    `SELECT id FROM platform_notices
      WHERE status = 'scheduled' AND back_sent_at IS NULL
        AND ends_at <= $1 AND ends_at > $1 - INTERVAL '1 day'`,
    [now],
  );
  for (const r of back.rows) if ((await sendNoticeEmail(r.id, "back")) !== null) sent++;
  return sent;
}

const CHECK_INTERVAL_MS = 60 * 1000;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runDueNoticeEmails();
  } catch (err) {
    logger.error({ err }, "Maintenance notice scheduler tick failed");
  } finally {
    running = false;
  }
}

export function startNoticeScheduler(): void {
  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
  logger.info("Maintenance notice scheduler started");
}
