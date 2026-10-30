// Books & Audit: the read-only GST Accountant / CA login, GST-only cash
// (receipts against GST invoices, supplier payments FIFO against GST bills),
// Tally XML export / import and the audit trail. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "books-tally-test-secret";
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
  return { status: res.status, body: json, headers: res.headers };
}
async function ok(who: string, method: string, p: string, body?: unknown) {
  const r = await call(who, method, p, body);
  assert.ok(r.status < 300, `${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

// A small Tally Prime export: a user-made sub-group under Fixed Assets,
// three ledgers and three vouchers.
const TALLY_XML = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><GROUP NAME="Furniture &amp; Fixtures" ACTION="Create"><PARENT>Fixed Assets</PARENT></GROUP></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Office Furniture" ACTION="Create"><PARENT>Furniture &amp; Fixtures</PARENT><OPENINGBALANCE>-25000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="HDFC Term Loan" ACTION="Create"><PARENT>Secured Loans</PARENT><OPENINGBALANCE>100000.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="Ramesh Traders" ACTION="Create"><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>-500.00</OPENINGBALANCE></LEDGER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20250410</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>7</VOUCHERNUMBER><NARRATION>Chairs bought on loan</NARRATION>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Furniture</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-5000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>HDFC Term Loan</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>5000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Journal" ACTION="Create"><DATE>20250411</DATE><VOUCHERTYPENAME>Journal</VOUCHERTYPENAME><VOUCHERNUMBER>8</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Ramesh Traders</LEDGERNAME><AMOUNT>-200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Office Furniture</LEDGERNAME><AMOUNT>200.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>
<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20250412</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-1</VOUCHERNUMBER>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Ramesh Traders</LEDGERNAME><AMOUNT>-100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>100.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER></TALLYMESSAGE>
</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  for (const [cid, tag] of [[A, "A"], [B, "B"]] as const) {
    await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [cid, `Tally Test ${tag} ${RUN}`]);
    for (const role of tag === "A" ? ["admin", "accountant", "gst_accountant"] : ["admin"]) {
      const u = await pool.query(
        `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
        [`${role}-t${tag}-${RUN}`, `${role} ${tag}`, role, cid],
      );
      cookies[`${role === "gst_accountant" ? "gst" : role}${tag}`] = sessionCookie({ userId: u.rows[0].id, username: `${role}-t${tag}-${RUN}`, role, name: `${role} ${tag}`, entityId: null, companyId: cid });
    }
  }
  ids.product = (await pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price) VALUES ($1, 'Oil 1L', 'Oil', 'T', $2, 'QTY', 100) RETURNING id`,
    [A, `OILT-${RUN}`],
  )).rows[0].id;
  ids.customer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Sharma & Sons', '91') RETURNING id`, [A])).rows[0].id;
  ids.vendor = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'Oil Mills', '81') RETURNING id`, [A])).rows[0].id;
  ids.account = (await ok("adminA", "POST", "/accounts", { name: "Cash", type: "cash", openingBalance: 10000 })).id;

  await ok("adminA", "POST", "/purchases", {
    billType: "gst", billDate: TODAY, vendorId: ids.vendor, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 10, unit: "QTY", rate: 100, taxPct: 18 }],
  });
  const inv = await ok("adminA", "POST", "/invoices", {
    invoiceType: "gst", invoiceDate: TODAY, customerId: ids.customer, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 4, unit: "QTY", rate: 150, mrp: 150, taxPct: 18 }],
  });
  ids.invoiceTotal = Number(inv.grandTotal);
  ids.gstInvoice = inv.id;
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: Number(inv.grandTotal), mode: "cash", partyEntityId: ids.customer, invoiceId: inv.id,
  });

  // The non-GST side, which none of the books may show: a ₹200 bill paid in
  // full, a ₹500 purchase, and one ₹1,400 supplier payment that clears the
  // GST bill (₹1,180) first and ₹220 of the non-GST one.
  const ng = await ok("adminA", "POST", "/invoices", {
    invoiceType: "non_gst", invoiceDate: TODAY, customerId: ids.customer, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 1, unit: "QTY", rate: 200, mrp: 200 }],
  });
  ids.nonGstInvoice = ng.id;
  ids.nonGstInvoiceNo = ng.invoiceNo;
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "in", amount: 200, mode: "cash", partyEntityId: ids.customer, invoiceId: ng.id,
  });
  await ok("adminA", "POST", "/purchases", {
    billType: "non_gst", billDate: TODAY, vendorId: ids.vendor, placeOfSupply: "Maharashtra",
    items: [{ productId: ids.product, qty: 5, unit: "QTY", rate: 100 }],
  });
  await ok("adminA", "POST", "/account-transactions", {
    accountId: ids.account, direction: "out", amount: 1400, mode: "cash", partyEntityId: ids.vendor,
  });
  // A Cash Book entry with no bill behind it at all.
  await ok("adminA", "POST", "/account-transactions", { accountId: ids.account, direction: "in", amount: 999, mode: "cash", partyName: "Walk-in" });
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("GST Accountant login reads every Books report but changes nothing", async () => {
  for (const p of ["/books/trial-balance", "/books/profit-loss", "/books/balance-sheet", "/books/day-book", "/books/vouchers", "/books/audit-trail"]) {
    await ok("gstA", "GET", `${p}${RANGE}`);
  }
  await ok("gstA", "GET", "/books/ledgers");
  const writes: [string, string, unknown][] = [
    ["POST", "/books/ledgers", { name: "X", group: "capital" }],
    ["POST", "/books/vouchers", { date: TODAY, lines: [] }],
    ["POST", "/books/tally/import", { xml: TALLY_XML, dryRun: true }],
    ["POST", "/accounts", { name: "Y", type: "cash" }],
  ];
  for (const [m, p, b] of writes) assert.equal((await call("gstA", m, p, b)).status, 403, `${m} ${p}`);
  for (const p of ["/products", "/users", "/accounts", "/khatabook"]) assert.equal((await call("gstA", "GET", p)).status, 403, `GET ${p}`);
});

test("only GST money: receipts on GST invoices, supplier payments FIFO onto GST bills", async () => {
  const day = await ok("gstA", "GET", `/books/day-book${RANGE}`);
  assert.deepEqual(day.map((r: any) => [r.kind, r.amount]).sort(),
    [["payment", 1180], ["purchase", 1180], ["receipt", ids.invoiceTotal], ["sale", ids.invoiceTotal]].sort());
  const tb = await ok("gstA", "GET", `/books/trial-balance${RANGE}`);
  // 10,000 opening + GST receipt − the GST part of the supplier payment.
  assert.equal(tb.rows.find((r: any) => r.name === "Cash").debit, 10000 + ids.invoiceTotal - 1180);
  assert.equal(tb.rows.find((r: any) => r.name === "Sundry Creditors (suppliers)"), undefined, "GST bill fully paid");
  const bs = await ok("gstA", "GET", `/books/balance-sheet${RANGE}`);
  const stock = bs.assets.flatMap((g: any) => g.lines).find((l: any) => l.name === "Stock in hand");
  assert.equal(stock.amount, 1000 - 400, "GST purchases − cost of GST sales");
  assert.equal(bs.difference, 10000, "only the opening cash is left unmatched");
});

test("Tally export: balanced vouchers and the ledgers they use", async () => {
  const r = await call("gstA", "GET", `/books/tally/export${RANGE}`);
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get("content-disposition")), /tally-2020-01-01-to-2099-12-31\.xml/);
  const xml: string = r.body;
  const vouchers = [...xml.matchAll(/<VOUCHER [^>]*VCHTYPE="([^"]+)"[\s\S]*?<\/VOUCHER>/g)];
  const types = vouchers.map((v) => v[1]).sort();
  assert.deepEqual(types, ["Payment", "Purchase", "Receipt", "Sales"]);
  assert.ok(!xml.includes(ids.nonGstInvoiceNo), "no non-GST invoice");
  assert.ok(!xml.includes("Walk-in") && !xml.includes("1400.00") && !xml.includes("200.00</AMOUNT>"), "no non-GST money");
  assert.match(vouchers.find((v) => v[1] === "Payment")![0], /<AMOUNT>-?1180\.00<\/AMOUNT>/);
  for (const v of vouchers) {
    const sum = [...v[0].matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((s, m) => s + Number(m[1]), 0);
    assert.ok(Math.abs(sum) < 0.005, `${v[1]} voucher balances (${sum})`);
  }
  const sale = vouchers.find((v) => v[1] === "Sales")![0];
  assert.match(sale, /<PARTYLEDGERNAME>Sharma &amp; Sons<\/PARTYLEDGERNAME>/);
  assert.match(sale, new RegExp(`<LEDGERNAME>Sharma &amp; Sons</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-${ids.invoiceTotal.toFixed(2)}</AMOUNT>`));
  assert.match(sale, /<LEDGERNAME>Output CGST<\/LEDGERNAME>/);
  assert.match(xml, /<LEDGER NAME="Sharma &amp; Sons"[^>]*>.*?<PARENT>Sundry Debtors<\/PARENT>/);
  assert.match(xml, /<LEDGER NAME="Oil Mills"[^>]*>.*?<PARENT>Sundry Creditors<\/PARENT>/);
  assert.match(xml, /<LEDGER NAME="Cash"[^>]*>.*?<PARENT>Cash-in-Hand<\/PARENT><OPENINGBALANCE>-10000\.00<\/OPENINGBALANCE>/);
  const trail = await ok("adminA", "GET", `/books/audit-trail${RANGE}&action=tally_exported`);
  assert.equal(trail.rows.length, 1);
  assert.equal(trail.rows[0].userName, "gst_accountant A");
});

test("Tally import: preview first, then ledgers and Journals between Books ledgers only", async () => {
  const preview = await ok("accountantA", "POST", "/books/tally/import", { xml: TALLY_XML, dryRun: true });
  assert.deepEqual(preview.ledgersCreated.map((l: any) => [l.name, l.group, l.openingBalance]).sort(),
    [["HDFC Term Loan", "loans", 100000], ["Office Furniture", "fixed_assets", 25000]]);
  assert.deepEqual(preview.ledgersSkipped, [{ name: "Ramesh Traders", reason: "Customer — kept in Customers" }]);
  assert.deepEqual(preview.journalsImported, [{ date: "2025-04-10", no: "7", total: 5000 }]);
  assert.equal(preview.journalsSkipped.length, 1);
  assert.match(preview.journalsSkipped[0].reason, /Ramesh Traders/);
  assert.deepEqual(preview.vouchersSkipped, [{ type: "Sales", count: 1 }]);
  const before = await ok("adminA", "GET", "/books/ledgers");
  assert.ok(!before.ledgers.some((l: any) => l.name === "Office Furniture"), "dry run saves nothing");

  const done = await ok("accountantA", "POST", "/books/tally/import", { xml: TALLY_XML, dryRun: false });
  assert.equal(done.journalsImported.length, 1);
  const { ledgers } = await ok("adminA", "GET", "/books/ledgers");
  assert.equal(ledgers.find((l: any) => l.name === "Office Furniture").balance, 30000);
  assert.equal(ledgers.find((l: any) => l.name === "HDFC Term Loan").balance, -105000);
  const vouchers = await ok("adminA", "GET", `/books/vouchers${RANGE}`);
  assert.equal(vouchers.length, 1);
  assert.match(vouchers[0].narration, /^Chairs bought on loan \[Tally #7\]$/);

  const again = await ok("accountantA", "POST", "/books/tally/import", { xml: TALLY_XML, dryRun: false });
  assert.equal(again.ledgersCreated.length, 0);
  assert.equal(again.journalsImported.length, 0);
  assert.ok(again.journalsSkipped.some((j: any) => j.reason === "Already imported"));

  assert.equal((await call("adminA", "POST", "/books/tally/import", { xml: "<hello/>" })).status, 400);
});

test("audit trail: filters, GST-only for the GST Accountant, one company never sees another's", async () => {
  for (const [id, no] of [[ids.gstInvoice, "GST-INV"], [ids.nonGstInvoice, "NONGST-INV"]] as const) {
    await pool.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, 'invoice_edited', $2, 1, 'admin A', $3)`,
      [A, `Invoice ${no} edited`, JSON.stringify({ invoiceId: id })],
    );
  }
  const asGst = await ok("gstA", "GET", `/books/audit-trail${RANGE}&action=invoice_edited`);
  assert.deepEqual(asGst.rows.map((r: any) => r.description), ["Invoice GST-INV edited"]);
  const asAdmin = await ok("adminA", "GET", `/books/audit-trail${RANGE}&action=invoice_edited`);
  assert.equal(asAdmin.rows.length, 2, "admin sees the full trail");

  const all = await ok("gstA", "GET", `/books/audit-trail${RANGE}`);
  assert.ok(all.actions.some((a: any) => a.action === "tally_imported"));
  // Both imports are logged, the second one with nothing new; newest first.
  const imported = await ok("gstA", "GET", `/books/audit-trail${RANGE}&action=tally_imported`);
  assert.deepEqual(imported.rows.map((r: any) => r.description),
    ["Tally XML imported: 0 ledgers, 0 Journals", "Tally XML imported: 2 ledgers, 1 Journals"]);
  assert.equal(imported.rows[0].userName, "accountant A");
  const search = await ok("gstA", "GET", `/books/audit-trail${RANGE}&q=${encodeURIComponent("2 ledgers")}`);
  assert.equal(search.rows.length, 1);
  assert.equal(search.total, 1);
  const other = await ok("adminB", "GET", `/books/audit-trail${RANGE}`);
  assert.ok(!other.rows.some((r: any) => /tally/i.test(r.action)));
});

test("a Tally export imports back: Journals and Books ledgers round-trip", async () => {
  const xml = (await call("adminA", "GET", `/books/tally/export${RANGE}`)).body;
  const r = await ok("adminB", "POST", "/books/tally/import", { xml, dryRun: false });
  assert.ok(r.ledgersCreated.some((l: any) => l.name === "Office Furniture" && l.group === "fixed_assets"));
  assert.equal(r.journalsImported.length, 1);
  assert.ok(r.ledgersSkipped.some((l: any) => l.name === "Sharma & Sons"));
  const { ledgers } = await ok("adminB", "GET", "/books/ledgers");
  // Opening as on 2020-01-01 is the original 25,000; the Journal adds 5,000.
  assert.equal(ledgers.find((l: any) => l.name === "Office Furniture").balance, 30000);
});
