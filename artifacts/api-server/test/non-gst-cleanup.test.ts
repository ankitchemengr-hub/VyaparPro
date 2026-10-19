// End-to-end tests for Settings → Data Management → Non-GST Data Cleanup.
//
// Runs the real Express app against a THROWAWAY database (TEST_DATABASE_URL —
// never point this at a real one; every run adds two test companies). Bills
// are created through the real POST /invoices, /purchases and
// /account-transactions routes so their stock / ledger / payment effects are
// genuine, then every report, dashboard and balance is snapshotted before and
// after delete and restore and must match exactly.
//
//   TEST_DATABASE_URL=postgres://... node test/run.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("Set TEST_DATABASE_URL to a throwaway database");
process.env.DATABASE_URL = TEST_DB;
process.env.SESSION_SECRET = "non-gst-cleanup-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
// The production bundle provides these via build.mjs's esbuild banner.
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let cleanup: typeof import("../src/lib/non-gst-cleanup");
let server: Server;
let base = "";

const RUN = Math.floor(Math.random() * 100000);
const A = 900000 + RUN * 2; // company A
const B = A + 1; // company B — must never be affected by A
const ids: Record<string, number> = {};
const cookies: Record<string, string> = {};

// Same format cookie-parser expects for a signed cookie.
function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(base + "/api" + path, {
    method,
    headers: { cookie: cookies[who], ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function ok(who: string, method: string, path: string, body?: unknown) {
  const r = await call(who, method, path, body);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const FROM = "2026-01-01";
const TO = "2026-01-31";

async function sale(who: string, type: "gst" | "non_gst", date: string, opts: { productId: number; customerId: number; eWayBillNo?: string; qty?: number }) {
  const inv = await ok(who, "POST", "/invoices", {
    invoiceType: type,
    invoiceDate: date,
    customerId: opts.customerId,
    placeOfSupply: "Maharashtra",
    ...(opts.eWayBillNo ? { eWayBillNo: opts.eWayBillNo } : {}),
    items: [{ productId: opts.productId, qty: opts.qty ?? 2, unit: "QTY", rate: 500, mrp: 600, taxPct: type === "gst" ? 18 : 0 }],
  });
  return inv;
}

async function payInFull(who: string, invoice: any, customerId: number, accountId: number) {
  await ok(who, "POST", "/account-transactions", {
    accountId, direction: "in", amount: Number(invoice.grandTotal), mode: "cash",
    partyEntityId: customerId, invoiceId: invoice.id,
  });
}

async function purchase(who: string, type: "gst" | "non_gst", date: string, productId: number, vendorId: number, qty = 100) {
  return ok(who, "POST", "/purchases", {
    billType: type, billDate: date, vendorId, placeOfSupply: "Maharashtra",
    items: [{ productId, qty, unit: "QTY", rate: 100, taxPct: type === "gst" ? 18 : 0 }],
  });
}

// Every financial figure the spec says must not move.
async function financialSnapshot(company: "A" | "B") {
  const who = company === "A" ? "adminA" : "adminB";
  const cid = company === "A" ? A : B;
  const q = `from=${FROM}&to=${TO}`;
  const sumBy = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + Number(r[k]), 0) * 100) / 100;
  const salesAll = await ok(who, "GET", `/reports/sales?${q}&type=all`);
  const salesNonGst = await ok(who, "GET", `/reports/sales?${q}&type=non_gst`);
  const salesGst = await ok(who, "GET", `/reports/sales?${q}&type=gst`);
  const billWise = await ok(who, "GET", `/reports/bill-wise-profit?${q}`);
  const purchaseRows = await ok(who, "GET", `/purchases/report?fromDate=${FROM}&toDate=${TO}`);
  const purchaseNonGst = await ok(who, "GET", `/purchases/report?fromDate=${FROM}&toDate=${TO}&billType=non_gst`);
  const db = async (sql: string) => (await pool.query(sql, [cid])).rows;
  return {
    profitLoss: await ok(who, "GET", `/reports/profit-loss?${q}`),
    salesTotals: salesAll.totals,
    otherSalesTotals: salesNonGst.totals,
    gstSalesTotals: salesGst.totals,
    itemWise: await ok(who, "GET", `/reports/sales/item-wise?${q}`),
    customerWise: await ok(who, "GET", `/reports/sales/customer-wise?${q}`),
    billWiseTotals: billWise.totals,
    tax: await ok(who, "GET", `/reports/tax?${q}`),
    purchaseReport: { lines: purchaseRows.length, amount: sumBy(purchaseRows, "amount") },
    otherPurchaseReport: { lines: purchaseNonGst.length, amount: sumBy(purchaseNonGst, "amount") },
    dashboardSummary: await ok(who, "GET", `/dashboard/summary`),
    financeOverview: await ok(who, "GET", `/dashboard/finance-overview`),
    litersSold: await ok(who, "GET", `/dashboard/liters-sold`),
    litersBalance: await ok(who, "GET", `/dashboard/liters-balance`),
    topProducts: await ok(who, "GET", `/dashboard/top-products`),
    stock: await db(`SELECT id, current_stock FROM products WHERE company_id = $1 ORDER BY id`),
    stockMovements: await db(`SELECT product_id, type, quantity, reference_type, reference_id FROM stock_movements WHERE company_id = $1 ORDER BY id`),
    ledger: await db(`SELECT entity_id, debit, credit, balance, type, reference_id FROM ledger_entries WHERE company_id = $1 ORDER BY id`),
    partyBalances: await db(`SELECT id, outstanding_balance FROM entities WHERE company_id = $1 ORDER BY id`),
    payments: await db(`SELECT receipt_no, invoice_id, allocated_amount FROM payment_allocations WHERE company_id = $1 ORDER BY id`),
    cashBook: await db(`SELECT account_id, direction, amount FROM account_transactions WHERE company_id = $1 ORDER BY id`),
    expenses: await db(`SELECT amount, invoice_id FROM expenses WHERE company_id = $1 ORDER BY id`),
  };
}

async function deletedState(table: "invoices" | "purchases", company: number) {
  const { rows } = await pool.query(`SELECT id, deleted_at IS NOT NULL AS deleted FROM ${table} WHERE company_id = $1 ORDER BY id`, [company]);
  return Object.fromEntries(rows.map((r: any) => [r.id, r.deleted]));
}

const key = () => randomUUID();

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  cleanup = await import("../src/lib/non-gst-cleanup");
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Cleanup Test ${tag} ${RUN}`]);
    const users = tag === "A" ? ["admin", "accountant"] : ["admin"];
    for (const role of users) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
        [`${role}-${tag}-${RUN}`, `${role} ${tag}`, role, cid],
      );
      const name = `${role}${tag}`;
      ids[name] = u.rows[0].id;
      cookies[name] = sessionCookie({ userId: u.rows[0].id, username: `${role}-${tag}-${RUN}`, role, name: `${role} ${tag}`, entityId: null, companyId: cid });
    }
    const p = await pool.query(
      `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil 1L', 'Oil', 'Test', $2, 'QTY', 100) RETURNING id`,
      [cid, `OIL-${tag}-${RUN}`],
    );
    ids[`product${tag}`] = p.rows[0].id;
    const c = await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust ${tag}', '90000000${tag === "A" ? 1 : 2}') RETURNING id`, [cid]);
    ids[`customer${tag}`] = c.rows[0].id;
    const v = await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Vend ${tag}', '80000000${tag === "A" ? 1 : 2}') RETURNING id`, [cid]);
    ids[`vendor${tag}`] = v.rows[0].id;
    const acc = await ok(`admin${tag}`, "POST", "/accounts", { name: `Cash ${tag}`, type: "cash", openingBalance: 0 });
    ids[`account${tag}`] = acc.id;
  }

  // Company A
  ids.NP1 = (await purchase("adminA", "non_gst", "2026-01-05", ids.productA, ids.vendorA)).id;
  ids.GP1 = (await purchase("adminA", "gst", "2026-01-05", ids.productA, ids.vendorA)).id;
  ids.NP2 = (await purchase("adminA", "non_gst", "2026-01-06", ids.productA, ids.vendorA)).id;
  const ns1 = await sale("adminA", "non_gst", "2026-01-10", { productId: ids.productA, customerId: ids.customerA });
  await payInFull("adminA", ns1, ids.customerA, ids.accountA);
  ids.NS1 = ns1.id; // paid non-GST → eligible
  ids.NS2 = (await sale("adminA", "non_gst", "2026-01-11", { productId: ids.productA, customerId: ids.customerA })).id; // unpaid → excluded
  const gs1 = await sale("adminA", "gst", "2026-01-10", { productId: ids.productA, customerId: ids.customerA });
  await payInFull("adminA", gs1, ids.customerA, ids.accountA);
  ids.GS1 = gs1.id; // paid GST → never touched
  const ns3 = await sale("adminA", "non_gst", "2026-01-12", { productId: ids.productA, customerId: ids.customerA, eWayBillNo: "EWB123" });
  await payInFull("adminA", ns3, ids.customerA, ids.accountA);
  ids.NS3 = ns3.id; // paid but has E-Way Bill → excluded

  // Company B: a paid non-GST sale in the same period
  ids.BP1 = (await purchase("adminB", "non_gst", "2026-01-05", ids.productB, ids.vendorB)).id;
  const bs1 = await sale("adminB", "non_gst", "2026-01-10", { productId: ids.productB, customerId: ids.customerB });
  await payInFull("adminB", bs1, ids.customerB, ids.accountB);
  ids.BS1 = bs1.id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

let snapA0: any;
let snapB0: any;
let salesJobId = 0;

test("preview picks only paid, verified Non-GST sales of this company and explains exclusions", async () => {
  snapA0 = await financialSnapshot("A");
  snapB0 = await financialSnapshot("B");
  const p = await ok("adminA", "GET", `/non-gst-cleanup/sales/preview?from=${FROM}&to=${TO}`);
  assert.deepEqual(p.eligible.map((r: any) => r.id), [ids.NS1]);
  assert.equal(p.eligibleCount, 1);
  const reasons = Object.fromEntries(p.excluded.map((r: any) => [r.id, r.reason]));
  assert.match(reasons[ids.NS2], /Unpaid balance/);
  assert.equal(reasons[ids.NS3], "Has an E-Way Bill");
  const all = [...p.eligible, ...p.excluded].map((r: any) => r.id);
  assert.ok(!all.includes(ids.GS1), "GST sale must never be listed");
  assert.ok(!all.includes(ids.BS1), "other tenant's bill must never be listed");
  assert.ok(p.linkedRecords.stockMovements >= 1 && p.linkedRecords.ledgerEntries >= 1);
});

test("non-admins cannot reach the cleanup feature", async () => {
  const r = await call("accountantA", "GET", `/non-gst-cleanup/sales/preview?from=${FROM}&to=${TO}`);
  assert.equal(r.status, 403);
  const d = await call("accountantA", "POST", `/non-gst-cleanup/sales/delete`, { from: FROM, to: TO, idempotencyKey: key(), confirm: "DELETE" });
  assert.equal(d.status, 403);
});

test("delete requires explicit confirmation", async () => {
  const r = await call("adminA", "POST", `/non-gst-cleanup/sales/delete`, { from: FROM, to: TO, idempotencyKey: key() });
  assert.equal(r.status, 400);
  assert.equal((await deletedState("invoices", A))[ids.NS1], false);
});

test("Non-GST Sales delete affects only eligible Non-GST sales; GST, purchases and other tenants untouched", async () => {
  const idem = key();
  const { job } = await ok("adminA", "POST", `/non-gst-cleanup/sales/delete`, { from: FROM, to: TO, idempotencyKey: idem, confirm: "DELETE" });
  salesJobId = job.id;
  assert.equal(job.status, "succeeded");
  assert.equal(job.processedCount, 1);
  assert.equal(job.excludedCount, 2);

  const inv = await deletedState("invoices", A);
  assert.equal(inv[ids.NS1], true);
  assert.equal(inv[ids.NS2], false);
  assert.equal(inv[ids.NS3], false);
  assert.equal(inv[ids.GS1], false);
  assert.ok(Object.values(await deletedState("purchases", A)).every((d) => d === false), "no purchase touched");
  assert.ok(Object.values(await deletedState("invoices", B)).every((d) => d === false), "company B untouched");

  // Same confirmation replayed → same job, nothing runs twice.
  const again = await ok("adminA", "POST", `/non-gst-cleanup/sales/delete`, { from: FROM, to: TO, idempotencyKey: idem, confirm: "DELETE" });
  assert.equal(again.duplicate, true);
  assert.equal(again.job.id, salesJobId);

  const audit = await pool.query(`SELECT * FROM audit_log WHERE company_id = $1 AND action = 'non_gst_sales_deleted'`, [A]);
  assert.equal(audit.rowCount, 1);
  assert.equal(JSON.parse(audit.rows[0].metadata).jobId, salesJobId);
});

test("deleted sale disappears from lists and from non-admins; admin can still open it", async () => {
  const list = await ok("adminA", "GET", `/invoices`);
  assert.ok(!list.some((i: any) => i.id === ids.NS1));
  assert.ok(list.some((i: any) => i.id === ids.GS1));
  assert.equal((await call("accountantA", "GET", `/invoices/${ids.NS1}`)).status, 404);
  const adminView = await ok("adminA", "GET", `/invoices/${ids.NS1}`);
  assert.ok(adminView.deletedAt);
  const edit = await call("adminA", "PATCH", `/invoices/${ids.NS1}`, { dueDate: "2026-02-01" });
  assert.equal(edit.status, 409);

  const register = await ok("accountantA", "GET", `/reports/sales?from=${FROM}&to=${TO}&type=non_gst`);
  const masked = register.items.filter((i: any) => i.deleted);
  assert.equal(masked.length, 1);
  assert.equal(masked[0].id, null);
  assert.equal(masked[0].invoiceNo, "Deleted bill");
});

test("Non-GST Purchase delete affects only eligible Non-GST purchases and honours legal hold", async () => {
  assert.equal(await cleanup.setLegalHold(A, "purchase", [ids.NP2], true, { userId: ids.adminA, name: "admin A" }), 1);
  const p = await ok("adminA", "GET", `/non-gst-cleanup/purchase/preview?from=${FROM}&to=${TO}`);
  assert.deepEqual(p.eligible.map((r: any) => r.id), [ids.NP1]);
  assert.deepEqual(p.excluded.map((r: any) => [r.id, r.reason]), [[ids.NP2, "Under legal hold"]]);

  const salesBefore = await deletedState("invoices", A);
  const { job } = await ok("adminA", "POST", `/non-gst-cleanup/purchase/delete`, { from: FROM, to: TO, idempotencyKey: key(), confirm: "DELETE" });
  assert.equal(job.processedCount, 1);
  const pur = await deletedState("purchases", A);
  assert.equal(pur[ids.NP1], true);
  assert.equal(pur[ids.NP2], false);
  assert.equal(pur[ids.GP1], false);
  assert.deepEqual(await deletedState("invoices", A), salesBefore, "sales untouched by purchase cleanup");

  assert.ok(!(await ok("adminA", "GET", `/purchases`)).some((r: any) => r.id === ids.NP1));
  assert.equal((await call("accountantA", "GET", `/purchases/${ids.NP1}`)).status, 404);
});

test("P&L, Sales, Other Sales, Purchase, Other Purchase, COGS, stock, ledgers and dashboard are unchanged after delete", async () => {
  assert.deepEqual(await financialSnapshot("A"), snapA0);
  assert.deepEqual(await financialSnapshot("B"), snapB0);
});

test("a failed job rolls back completely", async () => {
  const ns4 = await sale("adminA", "non_gst", "2026-01-20", { productId: ids.productA, customerId: ids.customerA });
  await payInFull("adminA", ns4, ids.customerA, ids.accountA);
  ids.NS4 = ns4.id;
  const result = await cleanup.runDelete({
    companyId: A, category: "sales", range: { from: FROM, to: TO }, trigger: "manual",
    idempotencyKey: `test-fail-${key()}`, operator: { userId: ids.adminA, name: "admin A" },
    afterBatch: async () => { throw new Error("simulated crash mid-job"); },
  });
  assert.equal(result.job!.status, "failed");
  assert.match(result.job!.error!, /simulated crash/);
  assert.equal((await deletedState("invoices", A))[ids.NS4], false);
  const items = await pool.query(`SELECT 1 FROM non_gst_cleanup_job_items WHERE job_id = $1`, [result.job!.id]);
  assert.equal(items.rowCount, 0);
});

test("Sales and Purchase schedules run independently and apply the same rules", async () => {
  await ok("adminA", "PUT", `/non-gst-cleanup/sales/settings`, { enabled: true, frequency: "daily", minAgeDays: 0 });
  await ok("adminA", "PUT", `/non-gst-cleanup/purchase/settings`, { enabled: false, frequency: "monthly", minAgeDays: 0 });
  await cleanup.setLegalHold(A, "purchase", [ids.NP2], false, { userId: ids.adminA, name: "admin A" });
  await pool.query(`UPDATE non_gst_cleanup_settings SET next_run_at = NOW() - INTERVAL '1 minute' WHERE company_id = $1 AND category = 'sales'`, [A]);

  await cleanup.runDueSchedules();

  const inv = await deletedState("invoices", A);
  assert.equal(inv[ids.NS4], true, "scheduled sales run deleted the eligible bill");
  assert.equal(inv[ids.NS2], false, "scheduled run still skips unpaid bills");
  assert.equal(inv[ids.GS1], false);
  assert.equal((await deletedState("purchases", A))[ids.NP2], false, "disabled purchase schedule did nothing");

  const jobs = await ok("adminA", "GET", `/non-gst-cleanup/sales/jobs`);
  assert.equal(jobs[0].trigger, "scheduled");
  assert.equal(jobs[0].status, "succeeded");
  assert.deepEqual(await ok("adminA", "GET", `/non-gst-cleanup/purchase/jobs`).then((j: any[]) => j.filter((x) => x.trigger === "scheduled")), []);
  const s = await ok("adminA", "GET", `/non-gst-cleanup/sales/settings`);
  assert.ok(new Date(s.nextRunAt) > new Date(), "next run moved forward");
  assert.equal(s.lastJob.id, jobs[0].id);

  // Running again before the next due time does nothing.
  await cleanup.runDueSchedules();
  assert.equal((await ok("adminA", "GET", `/non-gst-cleanup/sales/jobs`))[0].id, jobs[0].id);
});

test("tenants are isolated", async () => {
  assert.equal((await call("adminB", "GET", `/non-gst-cleanup/sales/jobs/${salesJobId}`)).status, 404);
  assert.deepEqual(await ok("adminB", "GET", `/non-gst-cleanup/sales/jobs`), []);
  const p = await ok("adminB", "GET", `/non-gst-cleanup/sales/preview?from=${FROM}&to=${TO}`);
  assert.deepEqual([...p.eligible, ...p.excluded].map((r: any) => r.id), [ids.BS1]);
  const held = await cleanup.setLegalHold(B, "sales", [ids.NS2], true, { userId: ids.adminB, name: "admin B" });
  assert.equal(held, 0);
  assert.equal((await deletedState("invoices", A))[ids.NS1], true);
});

test("a delete is final: there is no restore", async () => {
  // No such routes any more (an unknown path falls through to a later 403 guard).
  const r = await call("adminA", "POST", `/non-gst-cleanup/sales/restore`, { ids: [ids.NS1], idempotencyKey: key() });
  assert.ok(r.status === 403 || r.status === 404, `restore must not exist, got ${r.status}`);
  const d = await call("adminA", "GET", `/non-gst-cleanup/sales/deleted`);
  assert.ok(d.status === 403 || d.status === 404, `deleted list must not exist, got ${d.status}`);
  assert.equal((await deletedState("invoices", A))[ids.NS1], true);
  assert.equal((await deletedState("purchases", A))[ids.NP1], true);
  assert.ok(!(await ok("adminA", "GET", `/invoices`)).some((i: any) => i.id === ids.NS1));
  // Company B's totals never moved at any point.
  assert.deepEqual(await financialSnapshot("B"), snapB0);
});
