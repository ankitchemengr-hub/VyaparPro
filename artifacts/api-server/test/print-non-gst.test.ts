// Print settings: GST and Non-GST bills each keep their own settings and logo
// (`billLogo`, `nonGst`), saved and returned beside the generated fields.
// Real Express app against a THROWAWAY database (TEST_DATABASE_URL).

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
process.env.SESSION_SECRET = "print-non-gst-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 100000);
const cookies: Record<string, string> = {};

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(who: string, method: string, body?: unknown) {
  const res = await fetch(`${base}/api/print-settings`, {
    method,
    headers: { cookie: cookies[who], ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  for (const tag of ["a", "b"]) {
    const c = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Print ${tag} ${RUN}`]);
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'Admin', 'admin', $2, true) RETURNING id`,
      [`print-${tag}-${RUN}`, c.rows[0].id],
    );
    cookies[tag] = sessionCookie({ userId: u.rows[0].id, role: "admin", name: "Admin", companyId: c.rows[0].id });
  }
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await pool?.end();
});

const GST_LOGO = "data:image/png;base64,R1NU";
const NON_GST_LOGO = "data:image/png;base64,Tk9O";

test("GST and Non-GST bills keep their own logo and settings", async () => {
  const saved = await call("a", "PUT", {
    billLogo: GST_LOGO,
    showQr: true,
    nonGst: { enabled: true, billLogo: NON_GST_LOGO, companyName: "Shop Cash", showQr: false, terms: ["Cash only."], defaultTemplate: "a5-compact" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const got = (await call("a", "GET")).body;
  assert.equal(got.billLogo, GST_LOGO);
  assert.equal(got.showQr, true);
  assert.equal(got.nonGst.enabled, true);
  assert.equal(got.nonGst.billLogo, NON_GST_LOGO);
  assert.equal(got.nonGst.companyName, "Shop Cash");
  assert.equal(got.nonGst.showQr, false);
  assert.deepEqual(got.nonGst.terms, ["Cash only."]);
  assert.equal(got.nonGst.defaultTemplate, "a5-compact");

  // Saving only the GST side leaves the Non-GST settings as they were.
  await call("a", "PUT", { footerNote: "Thank you" });
  const again = (await call("a", "GET")).body;
  assert.equal(again.footerNote, "Thank you");
  assert.equal(again.nonGst.companyName, "Shop Cash");

  // Turning Non-GST settings off keeps them for later.
  await call("a", "PUT", { nonGst: { ...again.nonGst, enabled: false } });
  assert.equal((await call("a", "GET")).body.nonGst.enabled, false);

  // Another company sees none of it.
  const other = (await call("b", "GET")).body;
  assert.equal(other.billLogo, undefined);
  assert.equal(other.nonGst, undefined);
});

test("an oversized logo is refused", async () => {
  const huge = "data:image/png;base64," + "A".repeat(2_100_000);
  assert.equal((await call("a", "PUT", { billLogo: huge })).status, 400);
  assert.equal((await call("a", "PUT", { nonGst: { enabled: true, billLogo: huge } })).status, 400);
});
