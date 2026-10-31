// node --test test.mjs — the watchdog against a fake ERP and fake Brevo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { check } from "./worker.js";

function setup() {
  const kv = new Map();
  const mails = [];
  const world = { up: true, notice: null, emails: ["a@x.in", "b@y.in"] };
  let writes = 0;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.endsWith("/api/healthz")) {
      if (!world.up) throw new Error("connection refused");
      return Response.json({ status: "ok" });
    }
    if (url.endsWith("/api/system/notify-list")) {
      assert.equal(init.headers["x-watchdog-token"], "t".repeat(20));
      return Response.json({ emails: world.emails, notice: world.notice });
    }
    if (url === "https://api.brevo.com/v3/smtp/email") {
      mails.push(JSON.parse(init.body));
      return new Response("{}", { status: 201 });
    }
    throw new Error(`unexpected ${url}`);
  };
  const env = {
    ERP_URL: "https://erp.test", WATCHDOG_TOKEN: "t".repeat(20), BREVO_API_KEY: "k",
    SENDER_EMAIL: "support@erp.test", OWNER_EMAIL: "owner@erp.test", DOWN_MINUTES: "10",
    STATE: {
      get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
      put: async (k, v) => { writes++; kv.set(k, v); },
    },
  };
  return { env, mails, world, writes: () => writes };
}

const MIN = 60_000;
const customerMails = (mails) => mails.filter((m) => m.messageVersions);
const recipients = (m) => m.messageVersions.map((v) => v.to[0].email);

test("down 10 minutes → customers told once; back up → told once; quiet minutes write nothing", async () => {
  const { env, mails, world, writes } = setup();
  const t0 = Date.parse("2026-11-01T10:00:00Z");
  await check(env, t0); // up: fetches the list
  const w = writes();
  await check(env, t0 + MIN);
  assert.equal(writes(), w, "nothing changed → no KV write");

  world.up = false;
  for (let m = 2; m <= 11; m++) await check(env, t0 + m * MIN);
  assert.equal(customerMails(mails).length, 0, "not before 10 minutes");
  await check(env, t0 + 12 * MIN);
  assert.equal(customerMails(mails).length, 1);
  assert.deepEqual(recipients(customerMails(mails)[0]), ["a@x.in", "b@y.in"], "one message per address");
  assert.match(customerMails(mails)[0].subject, /technical problem/);
  for (let m = 13; m <= 30; m++) await check(env, t0 + m * MIN);
  assert.equal(customerMails(mails).length, 1, "only one outage email");

  world.up = true;
  await check(env, t0 + 31 * MIN);
  await check(env, t0 + 32 * MIN);
  assert.equal(customerMails(mails).length, 2);
  assert.match(customerMails(mails)[1].subject, /back online/);
  assert.equal(mails.filter((m) => m.to?.[0]?.email === "owner@erp.test").length, 2, "owner told down and up");
});

test("a short blip emails nobody", async () => {
  const { env, mails, world } = setup();
  const t0 = Date.parse("2026-11-01T10:00:00Z");
  await check(env, t0);
  world.up = false;
  for (let m = 1; m <= 5; m++) await check(env, t0 + m * MIN);
  world.up = true;
  await check(env, t0 + 6 * MIN);
  assert.equal(mails.length, 0);
});

test("down inside an announced maintenance window → owner only", async () => {
  const { env, mails, world } = setup();
  const t0 = Date.parse("2026-11-01T10:00:00Z");
  world.notice = { startsAt: new Date(t0 + 60 * MIN).toISOString(), endsAt: new Date(t0 + 180 * MIN).toISOString() };
  await check(env, t0);
  world.up = false;
  for (let m = 60; m <= 75; m++) await check(env, t0 + m * MIN);
  world.up = true;
  await check(env, t0 + 181 * MIN);
  assert.equal(customerMails(mails).length, 0, "customers already knew");
  assert.equal(mails.length, 2, "owner told down and up");
});
