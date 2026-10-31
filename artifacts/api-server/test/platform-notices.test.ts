// Platform Console → Notices: maintenance emails to every customer, the ERP
// banner, and the watchdog's customer list. Real Express app against a
// THROWAWAY database (TEST_DATABASE_URL); Brevo is faked, nothing is sent.
//
//   TEST_DATABASE_URL=postgres://... node test/run.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database");
process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET = "platform-notices-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
process.env.BREVO_API_KEY = "test-key";
process.env.SMTP_FROM = "SHRADHA ERP <support@erp.test>";
process.env.WATCHDOG_TOKEN = "w".repeat(24);
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

// Fake Brevo: record every email, pass everything else through.
const sentMail: { to: string; subject: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  if (String(input).startsWith("https://api.brevo.com/")) {
    const body = JSON.parse(init.body);
    sentMail.push({ to: body.to[0].email, subject: body.subject });
    return new Response("{}", { status: 201 });
  }
  return realFetch(input, init);
}) as typeof fetch;

let pool: any;
let notices: typeof import("../src/lib/platform-notices");
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 100000);
const cookies: Record<string, string> = {};
const myEmails: string[] = [];

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(who: string | null, method: string, p: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await realFetch(base + "/api" + p, {
    method,
    headers: { ...(who ? { cookie: cookies[who] } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const mailsTo = (subject: RegExp) => sentMail.filter((m) => subject.test(m.subject) && myEmails.includes(m.to)).map((m) => m.to).sort();

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  notices = await import("../src/lib/platform-notices");
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Two customer companies (one email in mixed case, entered twice) and one without an email.
  for (const [i, email] of [[1, `Owner${RUN}@Shop.in`], [2, `owner${RUN}@shop.in`], [3, null], [4, `b${RUN}@mill.in`]] as const) {
    const c = await pool.query(`INSERT INTO companies (name, email) VALUES ($1, $2) RETURNING id`, [`Notice Co ${i} ${RUN}`, email]);
    if (i === 1) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'Shop admin', 'admin', $2, true) RETURNING id`,
        [`shopadmin-${RUN}`, c.rows[0].id],
      );
      cookies.admin = sessionCookie({ userId: u.rows[0].id, role: "admin", name: "Shop admin", companyId: c.rows[0].id });
    }
  }
  myEmails.push(`owner${RUN}@shop.in`, `b${RUN}@mill.in`);
  const sa = await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'Platform owner', 'super_admin', NULL, true) RETURNING id`,
    [`owner-${RUN}`],
  );
  cookies.owner = sessionCookie({ userId: sa.rows[0].id, role: "super_admin", name: "Platform owner", companyId: null });
});

after(async () => {
  server?.close();
  await pool?.end();
});

const H = 60 * 60 * 1000;
let noticeId = 0;

test("only the platform owner can manage notices", async () => {
  assert.equal((await call("admin", "GET", "/subscriptions/notices")).status, 403);
  assert.equal((await call("admin", "POST", "/subscriptions/notices", { title: "x", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + H).toISOString() })).status, 403);
  const bad = await call("owner", "POST", "/subscriptions/notices", { title: "x", startsAt: new Date(Date.now() + 2 * H).toISOString(), endsAt: new Date(Date.now() + H).toISOString() });
  assert.equal(bad.status, 400, "end before start is refused");
});

test("saving a notice emails every customer once, one address per email", async () => {
  const start = new Date(Date.now() + 3 * H);
  const r = await call("owner", "POST", "/subscriptions/notices", {
    title: "Server upgrade", message: "Provider maintenance", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 2 * H).toISOString(), emailNow: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  noticeId = r.body.notice.id;
  assert.ok(r.body.notice.announcedAt);
  assert.equal(r.body.notice.remindedAt, null, "reminder still to come");
  assert.deepEqual(mailsTo(/Scheduled maintenance/), [...myEmails].sort(), "each address once, duplicates and case folded");
  const list = await call("owner", "GET", "/subscriptions/notices");
  assert.ok(list.body.notices.some((n: any) => n.id === noticeId));
});

test("the banner shows for everyone, logged in or not", async () => {
  const pub = await call(null, "GET", "/system/notice-banner");
  assert.equal(pub.status, 200);
  assert.equal(pub.body.notice?.id, noticeId);
  assert.equal(pub.body.notice.message, "Provider maintenance");
});

test("reminder an hour before and back-online after the window, each exactly once", async () => {
  const n = (await pool.query(`SELECT starts_at, ends_at FROM platform_notices WHERE id = $1`, [noticeId])).rows[0];
  const starts = new Date(n.starts_at).getTime();
  const ends = new Date(n.ends_at).getTime();

  await notices.runDueNoticeEmails(new Date(starts - 2 * H));
  assert.equal(mailsTo(/Reminder/).length, 0, "too early");
  await notices.runDueNoticeEmails(new Date(starts - 30 * 60 * 1000));
  await notices.runDueNoticeEmails(new Date(starts - 20 * 60 * 1000));
  assert.deepEqual(mailsTo(/Reminder/), [...myEmails].sort(), "one reminder each");

  await notices.runDueNoticeEmails(new Date(starts + H));
  assert.equal(mailsTo(/back online/).length, 0, "not while it is running");
  await notices.runDueNoticeEmails(new Date(ends + 60 * 1000));
  await notices.runDueNoticeEmails(new Date(ends + 2 * 60 * 1000));
  assert.deepEqual(mailsTo(/back online/), [...myEmails].sort(), "one back-online each");
});

test("a cancelled notice sends nothing more and leaves the banner", async () => {
  const start = new Date(Date.now() + 2 * H);
  const r = await call("owner", "POST", "/subscriptions/notices", {
    title: "Later", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + H).toISOString(), emailNow: false,
  });
  assert.equal(r.body.emailed, null);
  assert.equal((await call("owner", "POST", `/subscriptions/notices/${r.body.notice.id}/cancel`)).status, 200);
  const before = sentMail.length;
  await notices.runDueNoticeEmails(new Date(start.getTime() - 30 * 60 * 1000));
  await notices.runDueNoticeEmails(new Date(start.getTime() + 2 * H));
  assert.equal(sentMail.length, before);
  const banner = await call(null, "GET", "/system/notice-banner");
  assert.notEqual(banner.body.notice?.id, r.body.notice.id);
});

test("the watchdog list needs the token", async () => {
  assert.equal((await call(null, "GET", "/system/notify-list")).status, 404);
  assert.equal((await call(null, "GET", "/system/notify-list", undefined, { "x-watchdog-token": "wrong" })).status, 404);
  const ok = await call(null, "GET", "/system/notify-list", undefined, { "x-watchdog-token": "w".repeat(24) });
  assert.equal(ok.status, 200);
  for (const e of myEmails) assert.ok(ok.body.emails.includes(e));
  assert.equal(ok.body.emails.filter((e: string) => e === myEmails[0]).length, 1);
});
