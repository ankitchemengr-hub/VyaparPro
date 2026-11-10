// Stock Investment: money collected for each item comes back as its FIFO cost,
// plus a % of its profit (fast items more), turned into an order qty at the
// last purchase rate. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "stock-investment-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 700000 + RUN * 2;
const B = A + 1;
const cookies: Record<string, string> = {};
const ids: Record<string, number> = {};

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}

async function call(who: string, method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method,
    headers: { cookie: cookies[who], ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
async function ok(who: string, method: string, p: string, body?: unknown) {
  const r = await call(who, method, p, body);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const purchase = (productId: number, vendorId: number, qty: number, rate: number, date: string) => ok("adminA", "POST", "/purchases", {
  billType: "non_gst", billDate: date, vendorId, placeOfSupply: "Maharashtra",
  items: [{ productId, qty, unit: "QTY", rate }],
});
const sale = (productId: number, qty: number, rate: number, date: string) => ok("adminA", "POST", "/invoices", {
  invoiceType: "non_gst", invoiceDate: date, customerId: ids.customer, placeOfSupply: "Maharashtra",
  items: [{ productId, qty, unit: "QTY", rate, mrp: rate }],
});
const collect = (inv: any) => ok("adminA", "POST", "/account-transactions", {
  accountId: ids.account, direction: "in", amount: Number(inv.grandTotal), mode: "cash",
  partyEntityId: ids.customer, invoiceId: inv.id,
});

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Invest Test ${tag} ${RUN}`]);
    for (const role of tag === "A" ? ["admin", "accountant"] : ["admin"]) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
        [`si-${role}-${tag}-${RUN}`, `${role} ${tag}`, role, cid],
      );
      cookies[`${role}${tag}`] = sessionCookie({ userId: u.rows[0].id, username: `si-${role}-${tag}-${RUN}`, role, name: role, entityId: null, companyId: cid });
    }
  }
  const product = async (name: string, price: number) => (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, $2, 'G', 'T', $3, 'QTY', $4) RETURNING id`,
    [A, name, `${name}-${RUN}`, price],
  )).rows[0].id;
  ids.oil = await product("Oil", 100);
  ids.soap = await product("Soap", 50);
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust', '91') RETURNING id`, [A])).rows[0].id;
  ids.v1 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Supplier One', '81') RETURNING id`, [A])).rows[0].id;
  ids.v2 = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Supplier Two', '82') RETURNING id`, [A])).rows[0].id;
  ids.account = (await ok("adminA", "POST", "/accounts", { name: "Cash", type: "cash", openingBalance: 100000 })).id;

  await purchase(ids.oil, ids.v1, 10, 100, "2026-03-01");
  await purchase(ids.oil, ids.v2, 10, 120, "2026-03-05");
  await purchase(ids.soap, ids.v1, 10, 50, "2026-03-02");
  await collect(await sale(ids.oil, 12, 150, "2026-03-10"));
  await collect(await sale(ids.soap, 2, 60, "2026-03-11"));
  await sale(ids.oil, 4, 150, "2026-03-12"); // unpaid — that money isn't in yet
});

after(async () => {
  server?.close();
  await pool?.end();
});

const item = (rep: any, id: number) => rep.items.find((i: any) => i.productId === id);
const MARCH = "/stock-investment?from=2026-03-01&to=2026-03-31";

test("collected money comes back as FIFO cost plus a % of profit, ordered at the last rate", async () => {
  const rep = await ok("adminA", "GET", MARCH);
  const oil = item(rep, ids.oil);
  const soap = item(rep, ids.soap);

  // Oil: the 12 paid = 10 @100 + 2 @120; the 4 unpaid don't count.
  assert.equal(oil.collected, 1800);
  assert.equal(oil.moneyBack, 1240);
  assert.equal(oil.profit, 560);
  assert.equal(oil.speed, "fast", "top 20% by money collected");
  assert.equal(oil.pct, 10);
  assert.equal(oil.extra, 56);
  assert.equal(oil.invest, 1296);
  assert.equal(oil.lastRate, 120);
  assert.equal(oil.lastSupplier, "Supplier Two");
  assert.equal(oil.orderQty, 10.8);

  assert.equal(soap.speed, "normal");
  assert.equal(soap.moneyBack, 100);
  assert.equal(soap.extra, 1);
  assert.equal(soap.invest, 101);
  assert.equal(soap.orderQty, 2.02);

  assert.equal(rep.items[0].productId, ids.oil, "fast items first");
  assert.equal(rep.totals.invest, 1397);
  assert.equal(rep.totals.pendingFromCustomers, 600);
});

test("the period limits which sales count", async () => {
  const rep = await ok("adminA", "GET", "/stock-investment?from=2026-03-11&to=2026-03-31");
  assert.equal(item(rep, ids.oil), undefined, "the only oil sale in range is unpaid");
  // Alone in the period, soap is now the top seller, so it gets the fast %.
  assert.equal(item(rep, ids.soap).speed, "fast");
  assert.equal(item(rep, ids.soap).invest, 102);
});

test("owner sets the % and an item's speed", async () => {
  await ok("adminA", "PUT", "/stock-investment/settings", { fastPct: 20, normalPct: 0 });
  let rep = await ok("adminA", "GET", MARCH);
  assert.equal(item(rep, ids.oil).extra, 112);
  assert.equal(item(rep, ids.soap).invest, 100);

  await ok("adminA", "PUT", "/stock-investment/settings", { speed: { productId: ids.soap, speed: "fast" } });
  rep = await ok("adminA", "GET", MARCH);
  assert.equal(item(rep, ids.soap).speed, "fast");
  assert.equal(item(rep, ids.soap).speedSetByOwner, true);
  assert.equal(item(rep, ids.soap).extra, 4);

  await ok("adminA", "PUT", "/stock-investment/settings", { speed: { productId: ids.soap, speed: null } });
  rep = await ok("adminA", "GET", MARCH);
  assert.equal(item(rep, ids.soap).speed, "normal");

  assert.equal((await call("adminA", "PUT", "/stock-investment/settings", { fastPct: 150 })).status, 400);
});

test("admin only, and each company sees only its own items", async () => {
  assert.equal((await call("accountantA", "GET", MARCH)).status, 403);
  assert.equal((await call("accountantA", "PUT", "/stock-investment/settings", { fastPct: 1 })).status, 403);
  const other = await ok("adminB", "GET", MARCH);
  assert.equal(other.items.length, 0);
});
