// Login code (email OTP) for accounts whose login isn't an email: add an
// email from My Account, confirm it, then a new device needs the code sent
// there. Needs TEST_DATABASE_URL.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database");
process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET = "login-code-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
delete process.env.AUTH_OTP_DISABLED;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
process.env.BREVO_API_KEY = "test-key";
process.env.SMTP_FROM = "Test <noreply@example.com>";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

// Fake Brevo: keep every email, pass everything else through.
const sent: { to: string; subject: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  if (String(input).startsWith("https://api.brevo.com/")) {
    const body = JSON.parse(init.body);
    sent.push({ to: body.to[0].email, subject: body.subject });
    return new Response("{}", { status: 201 });
  }
  return realFetch(input, init);
}) as typeof fetch;
const lastCode = (to: string) => {
  const m = [...sent].reverse().find((x) => x.to === to);
  return m?.subject.match(/(\d{6})/)?.[1];
};

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 700000 + RUN;
const USER = `owner-${RUN}`;
const PW = "owner-password-1";
const EMAIL = `owner${RUN}@example.com`;

// One "device": its own cookie jar.
function device() {
  const jar = new Map<string, string>();
  return async (method: string, p: string, body?: unknown) => {
    const res = await realFetch(base + "/api" + p, {
      method,
      headers: {
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v) jar.set(k, v); else jar.delete(k);
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const { hashPassword } = await import("../src/lib/password");
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Login Code ${RUN}`]);
  await pool.query(
    `INSERT INTO subscriptions (company_id, plan_name, subscription_start_date, subscription_end_date, subscription_amount, payment_status, subscription_status)
     VALUES ($1, 'Test', NOW() - interval '1 day', NOW() + interval '30 days', 0, 'paid', 'active')`,
    [A],
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, $2, 'Owner', 'admin', $3, true)`,
    [USER, hashPassword(PW), A],
  );
  await pool.query(
    `INSERT INTO users (username, password_hash, name, role, company_id, is_active, login_otp_required, email_verified_at)
     VALUES ($1, $2, 'Signup', 'admin', $3, true, true, NOW())`,
    [`signup${RUN}@example.com`, hashPassword(PW), A],
  );
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("turn on login codes with an email, then a new device needs the code", async () => {
  const phone = device();
  assert.equal((await phone("POST", "/auth/login", { username: USER, password: PW })).status, 200, "no code before it is on");

  let st = await phone("GET", "/auth/login-code");
  assert.deepEqual(st.body, { enabled: false, email: null, canTurnOff: false });

  assert.equal((await phone("POST", "/auth/login-code", { email: EMAIL, password: "wrong" })).status, 400);
  assert.equal((await phone("POST", "/auth/login-code", { email: "not-an-email", password: PW })).status, 400);

  const start = await phone("POST", "/auth/login-code", { email: EMAIL, password: PW });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const code = lastCode(EMAIL);
  assert.ok(code, "code emailed to the new address");
  assert.equal((await phone("POST", "/auth/login-code/verify", { challengeId: start.body.challengeId, code: "000000" === code ? "111111" : "000000" })).status, 400);
  const ok = await phone("POST", "/auth/login-code/verify", { challengeId: start.body.challengeId, code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));

  st = await phone("GET", "/auth/login-code");
  assert.equal(st.body.enabled, true);
  assert.equal(st.body.canTurnOff, true);
  assert.notEqual(st.body.email, EMAIL, "email is masked");

  // Same phone (trusted while turning it on): straight in.
  assert.equal((await phone("POST", "/auth/login", { username: USER, password: PW })).status, 200);

  // A new laptop: password alone isn't enough.
  const laptop = device();
  const login = await laptop("POST", "/auth/login", { username: USER, password: PW });
  assert.equal(login.status, 202, JSON.stringify(login.body));
  assert.equal(login.body.challenge, "email_code");
  assert.equal((await laptop("GET", "/brands")).status, 401, "not signed in until the code is entered");
  const lc = lastCode(EMAIL);
  assert.ok(lc, "login code goes to the added email, not the username");
  const verified = await laptop("POST", "/auth/login/verify", { challengeId: login.body.challengeId, code: lc });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal((await laptop("GET", "/brands")).status, 200);

  // Turning it off needs the password.
  assert.equal((await phone("POST", "/auth/login-code/disable", { password: "wrong" })).status, 400);
  assert.equal((await phone("POST", "/auth/login-code/disable", { password: PW })).status, 200);
  const tablet = device();
  assert.equal((await tablet("POST", "/auth/login", { username: USER, password: PW })).status, 200, "no code once off");
});

test("website-signup accounts keep their codes on", async () => {
  const d = device();
  const login = await d("POST", "/auth/login", { username: `signup${RUN}@example.com`, password: PW });
  assert.equal(login.status, 202);
  const code = lastCode(`signup${RUN}@example.com`);
  assert.equal((await d("POST", "/auth/login/verify", { challengeId: login.body.challengeId, code })).status, 200);
  const st = await d("GET", "/auth/login-code");
  assert.equal(st.body.enabled, true);
  assert.equal(st.body.canTurnOff, false);
  assert.equal((await d("POST", "/auth/login-code/disable", { password: PW })).status, 400);
  assert.equal((await d("POST", "/auth/login-code", { email: "x@example.com", password: PW })).status, 400);
});
