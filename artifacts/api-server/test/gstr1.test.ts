// Books & Audit → GST Returns: GSTR-1 sections, HSN summary, document
// series and the portal JSON. Needs TEST_DATABASE_URL.

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
process.env.SESSION_SECRET = "gstr1-test-secret";
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
const ids: Record<string, any> = {};
const D = "2025-05-10";
const Q = "?from=2025-05-01&to=2025-05-31";
const BUYER = "27AAPFU0939F1ZV";

function sessionCookie(session: object): string {
  const val = JSON.stringify(session);
  const sig = createHmac("sha256", process.env.SESSION_SECRET!).update(val).digest("base64").replace(/=+$/, "");
  return `session=${encodeURIComponent(`s:${val}.${sig}`)}`;
}
async function call(who: string, method: string, p: string, body?: unknown) {
  const res = await fetch(base + "/api" + p, {
    method, headers: { cookie: cookies[who], ...(body ? { "content-type": "application/json" } : {}) },
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

before(async () => {
  const { ensureDatabaseReady } = await import("../src/lib/bootstrap");
  await ensureDatabaseReady();
  ({ pool } = await import("@workspace/db"));
  const app = (await import("../src/app")).default;
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`INSERT INTO companies (id, name) VALUES ($1, $2)`, [A, `GSTR1 Test ${RUN}`]);
  await pool.query(`INSERT INTO print_settings (company_id, config) VALUES ($1, $2)`, [A, JSON.stringify({ gstin: "27AAACR5055K1Z7" })]);
  for (const role of ["admin", "gst_accountant", "salesman"]) {
    const u = await pool.query(
      `INSERT INTO users (username, password_hash, name, role, company_id, is_active) VALUES ($1, 'x', $2, $3, $4, true) RETURNING id`,
      [`${role}-g1-${RUN}`, `${role} g1`, role, A],
    );
    cookies[role] = sessionCookie({ userId: u.rows[0].id, username: `${role}-g1-${RUN}`, role, name: `${role} g1`, entityId: null, companyId: A });
  }
  const prod = (name: string, hsn: string, unit: string) => pool.query(
    `INSERT INTO products (company_id, name, "group", brand, item_code, unit, hsn_code, current_stock) VALUES ($1, $2, 'G', 'B', $3, $4, $5, 1000) RETURNING id`,
    [A, name, `${name}-${RUN}`, unit, hsn]).then((r: any) => r.rows[0].id);
  ids.oil = await prod("Oil", "27101980", "LTR");
  ids.putty = await prod("Putty", "3214", "BAG");
  ids.rice = await prod("Rice", "", "KG");
  ids.dealer = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile, gstin) VALUES ($1, 'customer', 'Dealer', '1', $2) RETURNING id`, [A, BUYER])).rows[0].id;
  ids.walkin = (await pool.query(`INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'customer', 'Walk In', '2') RETURNING id`, [A])).rows[0].id;

  const inv = (body: any) => ok("admin", "POST", "/invoices", { invoiceType: "gst", invoiceDate: D, ...body });
  // B2B: 10 L oil @100 at 18 % + 2 bags putty @500 at 28 %, discount ₹100 on putty.
  ids.b2b = await inv({ customerId: ids.dealer, customerGstin: BUYER, placeOfSupply: "Maharashtra", items: [
    { productId: ids.oil, qty: 10, unit: "LTR", rate: 100, mrp: 100, taxPct: 18 },
    { productId: ids.putty, qty: 2, unit: "BAG", rate: 500, mrp: 500, taxPct: 28, discountAmt: 100 },
    { productId: ids.rice, qty: 5, unit: "KG", rate: 40, mrp: 40, taxPct: 0 },
  ] });
  // B2C small, intra-state.
  ids.b2cs = await inv({ customerId: ids.walkin, placeOfSupply: "Maharashtra", items: [{ productId: ids.oil, qty: 3, unit: "LTR", rate: 100, mrp: 100, taxPct: 18 }] });
  // B2C large: inter-state, over ₹1 lakh.
  ids.b2cl = await inv({ customerId: ids.walkin, placeOfSupply: "Gujarat", items: [{ productId: ids.oil, qty: 1000, unit: "LTR", rate: 100, mrp: 100, taxPct: 18 }] });
  // B2C small, inter-state, under ₹1 lakh.
  ids.b2csInter = await inv({ customerId: ids.walkin, placeOfSupply: "Gujarat", items: [{ productId: ids.oil, qty: 2, unit: "LTR", rate: 100, mrp: 100, taxPct: 18 }] });
  // Cancelled, and a non-GST bill — neither is reported (the cancelled one counts in the series).
  const cancelled = await inv({ customerId: ids.walkin, placeOfSupply: "Maharashtra", items: [{ productId: ids.oil, qty: 1, unit: "LTR", rate: 100, mrp: 100, taxPct: 18 }] });
  await ok("admin", "DELETE", `/invoices/${cancelled.id}`);
  await ok("admin", "POST", "/invoices", { invoiceType: "non_gst", invoiceDate: D, customerId: ids.walkin, placeOfSupply: "Maharashtra", items: [{ productId: ids.oil, qty: 50, unit: "LTR", rate: 100, mrp: 100 }] });
  // Returns: 2 L oil from the B2B bill, 1 L from the B2C small bill.
  const line = (i: any, pid: number) => i.items.find((x: any) => x.productId === pid).id;
  await ok("admin", "POST", "/sales-returns", { invoiceId: ids.b2b.id, items: [{ invoiceItemId: line(ids.b2b, ids.oil), productId: ids.oil, qty: 2 }] });
  await ok("admin", "POST", "/sales-returns", { invoiceId: ids.b2cs.id, items: [{ invoiceItemId: line(ids.b2cs, ids.oil), productId: ids.oil, qty: 1 }] });
  // Sales returns are dated today; move them into the period.
  await pool.query(`UPDATE sales_returns SET return_date = $2::date + interval '6 hours' WHERE company_id = $1`, [A, "2025-05-20"]);
});

after(async () => {
  server?.close();
  await pool?.end();
});

test("GSTR-1 sections", async () => {
  const g = await ok("gst_accountant", "GET", `/books/gstr1${Q}`);
  assert.equal(g.fp, "052025");
  assert.deepEqual(g.b2b.map((r: any) => [r.gstin, r.rate, r.txval, r.camt, r.samt, r.iamt]), [
    [BUYER, 18, 1000, 90, 90, 0],
    [BUYER, 28, 900, 126, 126, 0],
  ]);
  assert.deepEqual(g.b2cl.map((r: any) => [r.pos, r.rate, r.txval, r.iamt]), [["24-Gujarat", 18, 100000, 18000]]);
  // Intra ₹300 − ₹100 returned; inter ₹200.
  assert.deepEqual(g.b2cs.map((r: any) => [r.pos, r.type, r.rate, r.txval, r.camt, r.iamt]), [
    ["24-Gujarat", "INTER", 18, 200, 0, 36],
    ["27-Maharashtra", "INTRA", 18, 200, 18, 0],
  ]);
  assert.deepEqual(g.cdn.map((r: any) => [r.section, r.gstin, r.rate, r.txval, r.camt]), [["cdnr", BUYER, 18, 200, 18]]);
  assert.deepEqual(g.nil, [{ type: "INTRAB2B", amount: 200 }]);
  const hsn = Object.fromEntries(g.hsn.map((h: any) => [`${h.table} ${h.hsn} ${h.rate}`, [h.uqc, h.qty, h.txval]]));
  assert.deepEqual(hsn, {
    "B2B 27101980 18": ["LTR", 8, 800],
    "B2B 3214 28": ["BAG", 2, 900],
    "B2B — 0": ["KGS", 5, 200],
    "B2C 27101980 18": ["LTR", 1004, 100400],
  });
  assert.ok(g.warnings.some((w: string) => w.includes("HSN missing") && w.includes("Rice")));
  const inv = g.docs.find((d: any) => d.doc === "Invoices for outward supply");
  assert.deepEqual([inv.total, inv.cancelled, inv.net], [5, 1, 4]);
  assert.deepEqual(g.docs.find((d: any) => d.doc === "Credit note").total, 2);
});

test("GSTR-1 portal JSON", async () => {
  const r = await call("admin", "GET", `/books/gstr1/json${Q}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") ?? "", /GSTR1_27AAACR5055K1Z7_052025\.json/);
  const j = r.body;
  assert.equal(j.gstin, "27AAACR5055K1Z7");
  assert.equal(j.b2b[0].ctin, BUYER);
  const b2bInv = j.b2b[0].inv[0];
  assert.equal(b2bInv.idt, "10-05-2025");
  assert.equal(b2bInv.pos, "27");
  assert.equal(b2bInv.itms.length, 2);
  assert.deepEqual(j.b2cl[0].inv[0].itms[0].itm_det, { txval: 100000, rt: 18, iamt: 18000, csamt: 0 });
  assert.equal(j.b2cl[0].pos, "24");
  assert.deepEqual(j.b2cs.find((x: any) => x.sply_ty === "INTRA"), { sply_ty: "INTRA", pos: "27", typ: "OE", rt: 18, txval: 200, csamt: 0, camt: 18, samt: 18 });
  assert.equal(j.cdnr[0].nt[0].ntty, "C");
  assert.ok(j.hsn.hsn_b2b.length === 3 && j.hsn.hsn_b2c.length === 1);
  assert.deepEqual(j.nil.inv, [{ sply_ty: "INTRAB2B", nil_amt: 200, expt_amt: 0, ngsup_amt: 0 }]);
  assert.equal(j.doc_issue.doc_det[0].docs[0].cancel, 1);
});

test("GSTR-1 is for Books roles only", async () => {
  assert.equal((await call("salesman", "GET", `/books/gstr1${Q}`)).status, 403);
  assert.equal((await call("admin", "GET", "/books/gstr1?from=2025-01-01&to=2025-12-31")).status, 400);
});
