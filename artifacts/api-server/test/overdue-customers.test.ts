// Dashboard "Overdue Customers": the Khatabook balance is matched against the
// customer's sale bills newest-first, and whatever isn't covered by bills from
// the last N days is overdue. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "overdue-customers-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 800000 + RUN * 2;
const B = A + 1;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function get(who: string, p: string) {
  const res = await fetch(base + "/api" + p, { headers: { cookie: cookies[who] } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function customer(name: string, balance: number, companyId = A) {
  return (await pool.query(
    `INSERT INTO entities (company_id, type, name, mobile, outstanding_balance) VALUES ($1, 'customer', $2, '99', $3) RETURNING id`,
    [companyId, name, balance],
  )).rows[0].id as number;
}

let billNo = 0;
async function bill(customerId: number, daysAgo: number, total: number, extra: { status?: string; type?: string; companyId?: number } = {}) {
  await pool.query(
    `INSERT INTO invoices (company_id, invoice_no, invoice_date, invoice_type, customer_id, grand_total, balance_due, status)
     VALUES ($1, $2, NOW() - make_interval(days => $3), $4, $5, $6, $6, $7)`,
    [extra.companyId ?? A, `OD-${RUN}-${++billNo}`, daysAgo, extra.type ?? "gst", customerId, total, extra.status ?? "saved"],
  );
}

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Overdue Test ${tag} ${RUN}`]);
    for (const role of tag === "A" ? ["admin", "store"] : ["admin"]) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
        [`od-${role}-${tag}-${RUN}`, role, role, cid],
      );
      cookies[`${role}${tag}`] = sessionCookie({ userId: u.rows[0].id, username: `od-${role}-${tag}-${RUN}`, role, name: role, entityId: null, companyId: cid });
    }
  }

  // Old bill 1000 (40 days) + new bill 500 (5 days), 300 paid on account → balance 1200.
  ids.mixed = await customer("Mixed", 1200);
  await bill(ids.mixed, 40, 1000);
  await bill(ids.mixed, 5, 500);
  // Cancelled bills and quotations never count.
  await bill(ids.mixed, 60, 9999, { status: "cancelled" });
  await bill(ids.mixed, 70, 9999, { type: "quotation" });

  // Only a recent bill pending → not overdue.
  ids.recent = await customer("Recent", 800);
  await bill(ids.recent, 3, 800);

  // Opening balance with no bills at all.
  ids.opening = await customer("Opening", 2000);

  // Fully paid old bill.
  ids.paid = await customer("Paid", 0);
  await bill(ids.paid, 50, 700);

  // Another company's overdue customer must not show up in A.
  ids.other = await customer("Other Co", 5000, B);
  await bill(ids.other, 90, 5000, { companyId: B });
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("only the part older than 15 days is overdue, biggest first", async () => {
  const r = await get("adminA", "/dashboard/overdue-customers?days=15");
  assert.equal(r.status, 200);
  assert.equal(r.body.days, 15);
  const names = r.body.customers.map((c: any) => c.name);
  assert.deepEqual(names, ["Opening", "Mixed"]);

  const mixed = r.body.customers[1];
  assert.equal(mixed.balance, 1200);
  assert.equal(mixed.overdue, 700, "500 of the balance is the 5-day-old bill; the other 700 is the 40-day-old one");
  assert.equal(mixed.oldestDays, 40);
  assert.equal(mixed.hasOpeningBalance, false);

  const opening = r.body.customers[0];
  assert.equal(opening.overdue, 2000);
  assert.equal(opening.oldestDays, null);
  assert.equal(opening.hasOpeningBalance, true);

  assert.equal(r.body.totalOverdue, 2700);
});

test("a shorter window makes recent bills overdue too", async () => {
  const r = await get("adminA", "/dashboard/overdue-customers?days=2");
  const byName = Object.fromEntries(r.body.customers.map((c: any) => [c.name, c]));
  assert.equal(byName.Mixed.overdue, 1200);
  assert.equal(byName.Recent.overdue, 800);
  assert.equal(byName.Paid, undefined);
});

test("bad days falls back to 15; only admin/accountant; another company sees none of it", async () => {
  assert.equal((await get("adminA", "/dashboard/overdue-customers?days=abc")).body.days, 15);
  assert.equal((await get("storeA", "/dashboard/overdue-customers")).status, 403);
  const b = await get("adminB", "/dashboard/overdue-customers");
  assert.deepEqual(b.body.customers.map((c: any) => c.name), ["Other Co"]);
});
