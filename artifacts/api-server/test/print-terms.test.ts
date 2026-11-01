// Default bill terms: companies that existed before the change keep the old
// "Subject to Solapur jurisdiction." line; new ones get no city. Real Express
// app against a THROWAWAY database (TEST_DATABASE_URL).

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
process.env.SESSION_SECRET = "print-terms-test-secret";
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

async function terms(who: string): Promise<string[]> {
  const res = await fetch(`${base}/api/print-settings`, { headers: { cookie: cookies[who] } });
  assert.equal(res.status, 200);
  return (await res.json()).terms;
}

before(async () => {
  ({ pool } = await import("@workspace/db"));
  // Created before bootstrap runs, as on the live server.
  for (const [tag, createdAt] of [["old", "2026-10-01T00:00:00Z"], ["new", "2026-11-05T00:00:00Z"]] as const) {
    const c = await pool.query(`INSERT INTO companies (name, created_at) VALUES ($1, $2) RETURNING id`, [`Terms ${tag} ${RUN}`, createdAt]);
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', 'Admin', 'admin', $2, true) RETURNING id`,
      [`terms-${tag}-${RUN}`, c.rows[0].id],
    );
    cookies[tag] = sessionCookie({ userId: u.rows[0].id, role: "admin", name: "Admin", companyId: c.rows[0].id });
  }
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("an existing company keeps its Solapur line; a new company gets no city", async () => {
  assert.ok((await terms("old")).includes("Subject to Solapur jurisdiction."));
  const fresh = await terms("new");
  assert.ok(!fresh.some((t) => /Solapur/.test(t)));
  assert.ok(fresh.includes("Goods once sold will not be taken back."));
});
