// Books & Audit: Trial Balance / P&L / Balance Sheet built from purchases,
// sales and Cash Book entries, the "Difference" line going to zero once the
// capital is entered, and Journal vouchers. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "books-test-secret";
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
const RANGE = "?from=2020-01-01&to=2099-12-31";
const TODAY = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

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
const tbRow = (tb: any, name: string) => tb.rows.find((r: any) => r.name === name);
const bsLine = (bs: any, side: "assets" | "liabilities", name: string) =>
  bs[side].flatMap((g: any) => g.lines).find((l: any) => l.name === name)?.amount;

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Books Test ${tag} ${RUN}`]);
    for (const role of tag === "A" ? ["admin", "accountant", "store"] : ["admin"]) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
        [`${role}-${tag}-${RUN}`, `${role} ${tag}`, role, cid],
      );
      cookies[`${role}${tag}`] = sessionCookie({ userId: u.rows[0].id, username: `${role}-${tag}-${RUN}`, role, name: role, entityId: null, companyId: cid });
    }
  }
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 100) RETURNING id`,
    [A, `OIL-${RUN}`],
  )).rows[0].id;
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Cust', '91') RETURNING id`, [A])).rows[0].id;
  ids.vendor = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Supplier', '81') RETURNING id`, [A])).rows[0].id;
  ids.account = (await ok("adminA", "POST", "/accounts", { name: "Cash", type: "cash", openingBalance: 10000 })).id;

  // Buy 10 @ 100, sell 4 @ 150 and get paid, pay the supplier 500.
  await ok("adminA", "POST", "/purchases", {
    billType: "non_gst", billDate: TODAY, vendorId: ids.vendor, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 10, unit: "QTY", rate: 100 }],
  });
  const inv = await ok("adminA", "POST", "/invoices", {
    invoiceType: "non_gst", invoiceDate: TODAY, customerId: ids.customer, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 4, unit: "QTY", rate: 150, mrp: 150 }],
  });
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: Number(inv.grandTotal), mode: "cash", partyEntityId: ids.customer, invoiceId: inv.id,
  });
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "out", amount: 500, mode: "cash", partyEntityId: ids.vendor,
  });
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("trial balance shows every ledger and the opening cash as a difference", async () => {
  const tb = await ok("adminA", "GET", `/books/trial-balance${RANGE}`);
  assert.equal(tbRow(tb, "Cash").debit, 10100);
  assert.equal(tbRow(tb, "Purchases").debit, 1000);
  assert.equal(tbRow(tb, "Sales").credit, 600);
  assert.equal(tbRow(tb, "Sundry Creditors (suppliers)").credit, 500);
  assert.equal(tbRow(tb, "Sundry Debtors (customers)"), undefined, "customer has paid in full");
  assert.equal(tb.difference, 10000, "opening cash has no capital against it yet");
  assert.equal(tb.totals.debit, tb.totals.credit);
});

test("profit & loss uses cost of goods sold", async () => {
  const pl = await ok("adminA", "GET", `/books/profit-loss${RANGE}`);
  assert.equal(pl.sales, 600);
  assert.equal(pl.costOfGoodsSold, 400);
  assert.equal(pl.grossProfit, 200);
  assert.equal(pl.netProfit, 200);
});

test("entering the capital balances the Trial Balance and the Balance Sheet", async () => {
  const { ledgers } = await ok("adminA", "GET", "/books/ledgers");
  const capital = ledgers.find((l: any) => l.name === "Capital Account");
  assert.ok(capital, "Capital Account is created for a new company");
  ids.capital = capital.id;
  await ok("adminA", "PATCH", `/books/ledgers/${capital.id}`, { name: "Capital Account", group: "capital", openingBalance: 10000 });

  const tb = await ok("adminA", "GET", `/books/trial-balance${RANGE}`);
  assert.equal(tb.difference, 0);
  assert.equal(tbRow(tb, "Capital Account").credit, 10000);

  const bs = await ok("adminA", "GET", `/books/balance-sheet${RANGE}`);
  assert.equal(bsLine(bs, "assets", "Stock in hand"), 600);
  assert.equal(bsLine(bs, "assets", "Cash"), 10100);
  assert.equal(bsLine(bs, "liabilities", "Sundry Creditors (suppliers)"), 500);
  assert.equal(bsLine(bs, "liabilities", "Capital Account"), 10000);
  assert.equal(bs.profit.total, 200);
  assert.equal(bs.difference, 0);
  assert.equal(bs.total, 10700);
});

test("a Journal moves both statements and must balance", async () => {
  const furniture = await ok("adminA", "POST", "/books/ledgers", { name: "Furniture", group: "fixed_assets", openingBalance: 1000 });
  await ok("adminA", "PATCH", `/books/ledgers/${ids.capital}`, { name: "Capital Account", group: "capital", openingBalance: 11000 });
  const { ledgers } = await ok("adminA", "GET", "/books/ledgers");
  const dep = ledgers.find((l: any) => l.name === "Depreciation").id;

  const bad = await call("accountantA", "POST", "/books/vouchers", {
    date: "2026-05-01", lines: [{ ledgerId: dep, debit: 50 }, { ledgerId: furniture.id, credit: 40 }],
  });
  assert.equal(bad.status, 400);

  const jv = await ok("accountantA", "POST", "/books/vouchers", {
    date: "2026-05-01", narration: "Depreciation", lines: [{ ledgerId: dep, debit: 50 }, { ledgerId: furniture.id, credit: 50 }],
  });
  assert.match(jv.voucherNo, /^JV-\d+$/);

  const pl = await ok("adminA", "GET", `/books/profit-loss${RANGE}`);
  assert.equal(pl.netProfit, 150);
  const bs = await ok("adminA", "GET", `/books/balance-sheet${RANGE}`);
  assert.equal(bsLine(bs, "assets", "Furniture"), 950);
  assert.equal(bs.difference, 0);
  const tb = await ok("adminA", "GET", `/books/trial-balance${RANGE}`);
  assert.equal(tb.difference, 0);

  // Only an admin cancels; a cancelled voucher stops counting.
  assert.equal((await call("accountantA", "POST", `/books/vouchers/${jv.id}/cancel`)).status, 403);
  await ok("adminA", "POST", `/books/vouchers/${jv.id}/cancel`);
  assert.equal((await ok("adminA", "GET", `/books/profit-loss${RANGE}`)).netProfit, 200);
  const list = await ok("adminA", "GET", `/books/vouchers${RANGE}`);
  assert.equal(list.find((v: any) => v.id === jv.id).status, "cancelled");
});

test("another company can't post to these ledgers and store users can't open Books", async () => {
  const r = await call("adminB", "POST", "/books/vouchers", {
    date: "2026-05-01", lines: [{ ledgerId: ids.capital, debit: 10 }, { ledgerId: ids.capital, credit: 10 }],
  });
  assert.equal(r.status, 400);
  const bLedgers = await ok("adminB", "GET", "/books/ledgers");
  assert.ok(!bLedgers.ledgers.some((l: any) => l.id === ids.capital));
  assert.equal((await call("storeA", "GET", `/books/trial-balance${RANGE}`)).status, 403);
});

test("a Debit Note sends stock back, lowers the supplier's dues and keeps the books balanced", async () => {
  const bills = await ok("accountantA", "GET", "/purchase-returns/bills");
  assert.equal(bills.length, 1);
  const [item] = await ok("accountantA", "GET", `/purchase-returns/bills/${bills[0].id}/items`);
  assert.equal(item.returnableQty, 10);

  const tooMany = await call("accountantA", "POST", "/purchase-returns", { purchaseId: bills[0].id, items: [{ purchaseItemId: item.purchaseItemId, qty: 11 }] });
  assert.equal(tooMany.status, 400);

  const dn = await ok("accountantA", "POST", "/purchase-returns", {
    purchaseId: bills[0].id, reason: "Damaged", items: [{ purchaseItemId: item.purchaseItemId, qty: 2 }],
  });
  assert.equal(dn.grandTotal, 200);
  ids.debitNote = dn.id;
  const stock = async () => (await pool.query(`SELECT current_stock::float8 AS s FROM products WHERE id = $1`, [ids.product])).rows[0].s;
  const dues = async () => (await pool.query(`SELECT outstanding_balance::float8 AS b FROM entities WHERE id = $1`, [ids.vendor])).rows[0].b;
  assert.equal(await stock(), 4);
  assert.equal(await dues(), 300);

  const tb = await ok("adminA", "GET", `/books/trial-balance${RANGE}`);
  assert.equal(tbRow(tb, "Purchase Returns").credit, 200);
  assert.equal(tbRow(tb, "Sundry Creditors (suppliers)").credit, 300);
  assert.equal(tb.difference, 0);
  const bs = await ok("adminA", "GET", `/books/balance-sheet${RANGE}`);
  assert.equal(bsLine(bs, "assets", "Stock in hand"), 400);
  assert.equal(bs.difference, 0);

  const day = await ok("adminA", "GET", `/books/day-book${RANGE}`);
  for (const kind of ["sale", "purchase", "receipt", "payment", "debit_note"]) {
    assert.ok(day.some((r: any) => r.kind === kind), `day book has a ${kind}`);
  }

  // Only an admin cancels; cancelling restores stock and dues.
  assert.equal((await call("accountantA", "POST", `/purchase-returns/${dn.id}/cancel`)).status, 403);
  await ok("adminA", "POST", `/purchase-returns/${dn.id}/cancel`);
  assert.equal(await stock(), 6);
  assert.equal(await dues(), 500);
  const [again] = await ok("accountantA", "GET", `/purchase-returns/bills/${bills[0].id}/items`);
  assert.equal(again.returnableQty, 10);
});

test("a Contra transfer shows once in the Day Book and moves cash to bank", async () => {
  const bank = await ok("adminA", "POST", "/accounts", { name: "Bank", type: "bank", openingBalance: 0 });
  await ok("adminA", "POST", "/accounts/transfer", { fromAccountId: ids.account, toAccountId: bank.id, amount: 1000, notes: "Deposit" });
  const day = await ok("accountantA", "GET", `/books/day-book${RANGE}`);
  const contra = day.filter((r: any) => r.kind === "contra");
  assert.equal(contra.length, 1);
  assert.equal(contra[0].amount, 1000);
  const tb = await ok("adminA", "GET", `/books/trial-balance${RANGE}`);
  assert.equal(tbRow(tb, "Cash").debit, 9100);
  assert.equal(tbRow(tb, "Bank").debit, 1000);
  assert.equal(tb.difference, 0);
});
