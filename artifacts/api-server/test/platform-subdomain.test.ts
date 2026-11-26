// A customer without a domain of their own gets abc.<our zone>: on our own
// server (Caddy on-demand TLS) it goes live straight away, reserved names are
// refused, and Caddy only gets certificates for domains a company has added.
// Our zone here is localtest.me (public wildcard DNS → 127.0.0.1).
// Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "platform-subdomain-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
process.env.ERP_APPLICATION_URL = "https://app.localtest.me";
process.env.CADDY_ON_DEMAND_TLS = "true";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
let lib: typeof import("../src/lib/custom-domains");
const RUN = Math.floor(Math.random() * 90000);
let companyId = 0;

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  lib = await import("../src/lib/custom-domains");
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const c = await pool.query(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Subdomain ${RUN}`]);
  companyId = c.rows[0].id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("our own names and nested subdomains are refused", () => {
  for (const d of ["www.localtest.me", "app.localtest.me", "erp.localtest.me", "localtest.me", "a.b.localtest.me"]) {
    assert.throws(() => lib.normalizeDomain(d), lib.DomainError, d);
  }
  assert.equal(lib.normalizeDomain(`https://Shop${RUN}.localtest.me/login`), `shop${RUN}.localtest.me`);
  assert.equal(lib.normalizeDomain("erp.myshop.com"), "erp.myshop.com");
});

test("a subdomain of our zone goes live at once, and only added domains get a certificate", async () => {
  const domain = `shop${RUN}.localtest.me`;
  const ask = (d: string) => fetch(`${base}/api/internal/tls-ask?domain=${encodeURIComponent(d)}`).then((r) => r.status);
  assert.equal(await ask(domain), 404, "not added yet");

  const state = await lib.requestDomain(companyId, domain);
  assert.equal(state.automatic, true);
  assert.equal(state.active?.domain, domain, JSON.stringify(state));
  assert.equal(state.pending, null);
  assert.equal(await lib.companyIdForHost(domain), companyId);

  assert.equal(await ask(domain), 200);
  assert.equal(await ask(`other${RUN}.localtest.me`), 404);
  assert.equal(await ask(""), 404);
});
