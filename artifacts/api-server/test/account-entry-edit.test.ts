// Khatabook → supplier → edit a Payment Out: amount, mode and the account it
// was paid from. Moving it to another account gives the old account its money
// back and charges the new one; the supplier's balance and ledger line follow.
// Also: a receipt number with "/" (REC/11/4) is found when URL-encoded.
// Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "aee-test-secret";
delete process.env.DEFAULT_COMPANY_ID;
process.env.MULTI_COMPANY_MODE = "true";
process.env.FRONTEND_DIST = "./__no_frontend__";
(globalThis as any).require ??= createRequire(import.meta.url);
(globalThis as any).__dirname ??= path.dirname(fileURLToPath(import.meta.url));

let pool: any;
let server: Server;
let base = "";
const RUN = Math.floor(Math.random() * 90000);
const A = 900000 + RUN;
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
const bal = async (id: number) => Number((await one(`SELECT current_balance FROM accounts WHERE id = $1`, [id])).current_balance);

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `Entry Edit Test ${RUN}`]);
  for (const role of ["admin", "accountant"]) {
    const u = await one(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-aee-${RUN}`, `${role} aee`, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.id, username: `${role}-aee-${RUN}`, role, name: `${role} aee`, entityId: null, companyId: A });
  }
  // Receipt numbers come from the default series REC/MM/SEQ — they contain "/".
  ids.cash = (await one(`INSERT INTO accounts (company_id, name, type, current_balance) VALUES ($1, 'Cash', 'cash', 50000) RETURNING id`, [A])).id;
  ids.cc = (await one(`INSERT INTO accounts (company_id, name, type, current_balance) VALUES ($1, 'SBI CC', 'bank', 80000) RETURNING id`, [A])).id;
  ids.vendor = (await one(`INSERT INTO entities (company_id, type, name, mobile, outstanding_balance) VALUES ($1, 'vendor', 'Barshi Oils', '9333333333', -30000) RETURNING id`, [A])).id;
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("a Payment Out to a supplier: receipt found, entry readable", async () => {
  const pay = await call("admin", "POST", "/account-transactions", {
    accountId: ids.cash, direction: "out", amount: 10000, mode: "cash",
    partyName: "Barshi Oils", partyMobile: "9333333333", partyEntityId: ids.vendor,
  });
  assert.ok(pay.status < 300, JSON.stringify(pay.body));
  ids.txn = pay.body.id;
  ids.receipt = pay.body.receiptNo;
  assert.equal(await bal(ids.cash), 40000);

  const rc = await call("accountant", "GET", `/payment-receipts/${encodeURIComponent(pay.body.receiptNo)}`);
  assert.equal(rc.status, 200, `receipt ${pay.body.receiptNo}: ${JSON.stringify(rc.body)}`);
  assert.equal(rc.body.source, "cashbook");
  assert.equal(rc.body.direction, "out");

  const one1 = await call("accountant", "GET", `/account-transactions/${ids.txn}`);
  assert.equal(one1.status, 200);
  assert.equal(one1.body.accountId, ids.cash);
  assert.equal(one1.body.amount, 10000);
  assert.equal((await call("accountant", "GET", "/account-transactions/999999999")).status, 404);
});

test("editing moves it to another account and fixes the supplier's ledger", async () => {
  const vendorBefore = Number((await one(`SELECT outstanding_balance FROM entities WHERE id = $1`, [ids.vendor])).outstanding_balance);
  assert.equal((await call("accountant", "PATCH", `/account-transactions/${ids.txn}`, { amount: 12000, mode: "upi", accountId: ids.cc })).status, 403);

  const r = await call("admin", "PATCH", `/account-transactions/${ids.txn}`, {
    amount: 12000, mode: "bank_transfer", accountId: ids.cc, partyName: "Barshi Oils", partyMobile: "9333333333", notes: "NEFT",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await bal(ids.cash), 50000, "the old account gets its 10,000 back");
  assert.equal(await bal(ids.cc), 68000, "the CC account pays 12,000");

  const t = await one(`SELECT account_id, amount, mode FROM account_transactions WHERE id = $1`, [ids.txn]);
  assert.equal(t.account_id, ids.cc);
  assert.equal(Number(t.amount), 12000);
  const vendorAfter = Number((await one(`SELECT outstanding_balance FROM entities WHERE id = $1`, [ids.vendor])).outstanding_balance);
  assert.equal(vendorAfter - vendorBefore, -2000, "the supplier is owed 2,000 less");
  const led = await one(`SELECT description, credit, debit FROM ledger_entries WHERE entity_id = $1 AND reference_id = $2 AND type = 'payment'`, [ids.vendor, ids.txn]);
  assert.match(led.description, /\(bank_transfer\)/);
  assert.equal(Number(led.credit) + Number(led.debit), 12000);
  assert.equal((await call("admin", "GET", `/payment-receipts/${encodeURIComponent(ids.receipt as any)}`)).body.amount, 12000);
});

test("a move that would push the new account below 0 needs the admin's OK", async () => {
  const small = (await one(`INSERT INTO accounts (company_id, name, type, current_balance) VALUES ($1, 'Petty', 'cash', 100) RETURNING id`, [A])).id;
  const r = await call("admin", "PATCH", `/account-transactions/${ids.txn}`, { amount: 12000, mode: "cash", accountId: small });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Petty/);
  assert.equal(await bal(ids.cc), 68000, "nothing moved");
  const ok = await call("admin", "PATCH", `/account-transactions/${ids.txn}`, { amount: 12000, mode: "cash", accountId: small, allowNegative: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await bal(ids.cc), 80000);
  assert.equal(await bal(small), -11900);
});
