// Cheque register (clear books the payment, bounce takes it back), godowns
// (transfers move stock between main and godowns without touching the
// total) and batches (what is left of each batch, earliest expiry sold
// first). Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "cgb-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 600000 + RUN;
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

const one = async (sql: string, params: any[] = []) => (await pool.query(sql, params)).rows[0];

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `CGB Test ${RUN}`]);
  for (const role of ["admin", "accountant"]) {
    const u = await one(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-cgb-${RUN}`, `${role} cgb`, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.id, username: `${role}-cgb-${RUN}`, role, name: `${role} cgb`, entityId: null, companyId: A });
  }
  ids.bank = (await one(`INSERT INTO accounts (company_id, name, type, current_balance) VALUES ($1, 'SBI', 'bank', 1000) RETURNING id`, [A])).id;
  ids.cust = (await one(`INSERT INTO entities (company_id, type, name, mobile, outstanding_balance) VALUES ($1, 'customer', 'Cheque Cust', '9111111111', 4000) RETURNING id`, [A])).id;
  ids.inv = (await one(
    `INSERT INTO invoices (company_id, invoice_no, invoice_type, customer_id, customer_name, invoice_date, grand_total, amount_paid, balance_due, status)
     VALUES ($1, 'CQ-INV-1', 'non_gst', $2, 'Cheque Cust', '2026-10-01', 4000, 0, 4000, 'saved') RETURNING id`, [A, ids.cust])).id;
  ids.oil = (await one(`INSERT INTO products (company_id, name, item_code, unit, current_stock, "group", brand) VALUES ($1, 'Engine Oil 1L', $2, 'LTR', 100, 'General', 'General') RETURNING id`, [A, `EO-${RUN}`])).id;
  ids.pur = (await one(`INSERT INTO purchases (company_id, bill_no, vendor_name, bill_date, grand_total, status) VALUES ($1, $2, 'Oil Co', '2026-09-01', 0, 'saved') RETURNING id`, [A, `PB-${RUN}`])).id;
  ids.pi1 = (await one(`INSERT INTO purchase_items (company_id, purchase_id, product_id, product_name, qty, unit, rate, amount) VALUES ($1, $2, $3, 'Engine Oil 1L', 60, 'LTR', 100, 6000) RETURNING id`, [A, ids.pur, ids.oil])).id;
  ids.pi2 = (await one(`INSERT INTO purchase_items (company_id, purchase_id, product_id, product_name, qty, unit, rate, amount) VALUES ($1, $2, $3, 'Engine Oil 1L', 50, 'LTR', 100, 5000) RETURNING id`, [A, ids.pur, ids.oil])).id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("cheque: clear books the receipt against the bill, bounce takes it back", async () => {
  assert.equal((await call("accountant", "POST", "/cheques", { direction: "received", entityId: ids.cust, chequeNo: "1", chequeDate: "2026-10-10", amount: 1 })).status, 403);
  const add = await call("admin", "POST", "/cheques", {
    direction: "received", entityId: ids.cust, chequeNo: "004512", bankName: "HDFC", chequeDate: "2026-10-20", amount: 4000, invoiceId: ids.inv,
  });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  const list = await call("accountant", "GET", "/cheques");
  assert.equal(list.body.cheques[0].partyName, "Cheque Cust");
  assert.equal(list.body.summary.receivedPending, 4000);

  const clear = await call("admin", "POST", `/cheques/${add.body.id}/clear`, { accountId: ids.bank, date: "2026-10-21" });
  assert.equal(clear.status, 200, JSON.stringify(clear.body));
  assert.equal((await one(`SELECT balance_due::float AS d FROM invoices WHERE id = $1`, [ids.inv])).d, 0);
  assert.equal((await one(`SELECT outstanding_balance::float AS b FROM entities WHERE id = $1`, [ids.cust])).b, 0);
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.bank])).b, 5000);
  assert.deepEqual(await one(`SELECT mode, (created_at AT TIME ZONE 'Asia/Kolkata')::date::text AS d FROM account_transactions WHERE company_id = $1`, [A]), { mode: "cheque", d: "2026-10-21" });

  const bounce = await call("admin", "POST", `/cheques/${add.body.id}/bounce`, { reason: "Funds insufficient" });
  assert.equal(bounce.status, 200, JSON.stringify(bounce.body));
  assert.equal((await one(`SELECT balance_due::float AS d FROM invoices WHERE id = $1`, [ids.inv])).d, 4000);
  assert.equal((await one(`SELECT outstanding_balance::float AS b FROM entities WHERE id = $1`, [ids.cust])).b, 4000);
  assert.equal((await one(`SELECT current_balance::float AS b FROM accounts WHERE id = $1`, [ids.bank])).b, 1000);
  assert.equal((await one(`SELECT status, bounce_reason FROM cheques WHERE id = $1`, [add.body.id])).status, "bounced");

  // Re-presented: back to pending, then deletable only while not cleared.
  assert.equal((await call("admin", "POST", `/cheques/${add.body.id}/undo`)).status, 200);
  assert.equal((await one(`SELECT status FROM cheques WHERE id = $1`, [add.body.id])).status, "pending");
  assert.equal((await call("admin", "DELETE", `/cheques/${add.body.id}`)).status, 200);
});

test("godowns: transfers move stock, total untouched, no overdraw", async () => {
  const g = await call("admin", "POST", "/godowns", { name: "Back Godown" });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  assert.equal((await call("admin", "POST", "/godowns", { name: "back godown" })).status, 409);
  assert.equal((await call("admin", "POST", "/godowns", { name: "Main" })).status, 400);

  const t = await call("admin", "POST", "/godowns/transfer", { fromGodownId: 0, toGodownId: g.body.id, items: [{ productId: ids.oil, qty: 30 }] });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  const over = await call("admin", "POST", "/godowns/transfer", { fromGodownId: g.body.id, toGodownId: 0, items: [{ productId: ids.oil, qty: 31 }] });
  assert.equal(over.status, 400);
  const tooMuch = await call("admin", "POST", "/godowns/transfer", { fromGodownId: 0, toGodownId: g.body.id, items: [{ productId: ids.oil, qty: 71 }] });
  assert.equal(tooMuch.status, 400);

  const stock = (await call("accountant", "GET", "/godowns/stock")).body.find((s: any) => s.productId === ids.oil);
  assert.deepEqual({ total: stock.total, main: stock.main, g: stock.godowns[g.body.id] }, { total: 100, main: 70, g: 30 });
  assert.equal((await one(`SELECT current_stock::float AS s FROM products WHERE id = $1`, [ids.oil])).s, 100);
  assert.equal((await call("admin", "PUT", `/godowns/${g.body.id}`, { name: "Back Godown", isActive: false })).status, 400);
  const hist = await call("accountant", "GET", "/godowns/transfers");
  assert.deepEqual([hist.body[0].from, hist.body[0].to, hist.body[0].qty], ["Main", "Back Godown", 30]);
});

test("batches: entered on a purchase bill and as opening; stock sits in the latest expiry", async () => {
  const save = await call("admin", "POST", "/batches", {
    purchaseId: ids.pur,
    items: [
      { purchaseItemId: ids.pi1, batchNo: "B-OLD", expiryDate: "2026-11-20" },
      { purchaseItemId: ids.pi2, batchNo: "B-NEW", expiryDate: "2027-06-30", mfgDate: "2026-06-01" },
    ],
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  assert.equal(save.body.saved, 2);
  // Saving the bill again replaces, never doubles.
  await call("admin", "POST", "/batches", { purchaseId: ids.pur, items: [{ purchaseItemId: ids.pi1, batchNo: "B-OLD", expiryDate: "2026-11-20" }] });
  const bill = await call("accountant", "GET", `/batches/purchase/${ids.pur}`);
  assert.deepEqual(bill.body.items.map((i: any) => i.batch?.batchNo), ["B-OLD", "B-NEW"]);

  const bad = await call("admin", "POST", "/batches", { items: [{ productId: ids.oil, batchNo: "X", qty: 5, mfgDate: "2027-01-01", expiryDate: "2026-01-01" }] });
  assert.equal(bad.status, 400);

  // 100 in stock: B-NEW (50, latest expiry) full, B-OLD (60) has the other 50.
  const r = await call("accountant", "GET", "/batches");
  const by = Object.fromEntries(r.body.batches.map((b: any) => [b.batchNo, b]));
  assert.equal(by["B-NEW"].left, 50);
  assert.equal(by["B-OLD"].left, 50);
  assert.ok(["soon", "later", "expired", "ok"].includes(by["B-OLD"].state));

  await pool.query(`UPDATE products SET current_stock = 40 WHERE id = $1`, [ids.oil]);
  const r2 = await call("accountant", "GET", "/batches");
  const by2 = Object.fromEntries(r2.body.batches.map((b: any) => [b.batchNo, b.left]));
  assert.deepEqual([by2["B-NEW"], by2["B-OLD"]], [40, 0]);
});
