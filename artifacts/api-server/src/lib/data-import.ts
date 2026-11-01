// Settings → Data Import: bring a new company's parties and items over from
// the software it used before (Vyapar, Busy, Marg, Hitech, Excel …). The
// browser reads the file and maps its columns; this checks each row and
// creates what is new. Only the starting position comes over — parties with
// their opening balance, items with their opening stock — not old bills.
//
// Existing records are never changed: a party or item already in the ERP is
// skipped, so importing the same file twice adds nothing the second time.
import type { PoolClient } from "pg";
import type { GstinDetails } from "./gstin-lookup";

export const MAX_ROWS = 5000;
// At most this many GSTIN lookups per import (each costs a provider credit).
export const MAX_GST_LOOKUPS = 200;

const n = (v: unknown) => { const x = Number(String(v ?? "").replace(/[,₹\s]/g, "")); return Number.isFinite(x) ? x : NaN; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const str = (v: unknown, max = 200) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const key = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

// "1,200.50", "1200 Cr", "-300", "Dr 50" → { amount, side }
function money(v: unknown): { amount: number; side: "dr" | "cr" | null } | null {
  const s = String(v ?? "").trim();
  if (!s) return { amount: 0, side: null };
  const side = /\bcr\.?\b/i.test(s) ? "cr" : /\bdr\.?\b/i.test(s) ? "dr" : null;
  const amount = n(s.replace(/\b(cr|dr)\.?\b/gi, ""));
  return Number.isNaN(amount) ? null : { amount, side };
}

const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;

function mobileOf(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const m = digits.length > 10 && (digits.startsWith("91") || digits.startsWith("0")) ? digits.slice(-10) : digits;
  return /^[6-9][0-9]{9}$/.test(m) || /^[0-9]{6,12}$/.test(m) ? m : null;
}

export interface RowResult { row: number; name: string; status: "new" | "exists" | "error"; reason?: string; detail?: string }

// ── Parties ──────────────────────────────────────────────────────────

export interface PartyRow {
  row: number; type?: string; name?: string; mobile?: string; gstin?: string; address?: string;
  city?: string; state?: string; pinCode?: string; openingBalance?: string; receivable?: string; payable?: string; creditLimit?: string;
}

// "Supplier", "Vendor", "Creditor", "Payable" … → vendor; else the default.
function partyType(v: unknown, fallback: "customer" | "vendor"): "customer" | "vendor" {
  const s = String(v ?? "").toLowerCase();
  if (/supp|vend|credit|payable|purchase/.test(s)) return "vendor";
  if (/cust|debt|receiv|buyer|sale|client/.test(s)) return "customer";
  return fallback;
}

export async function importParties(
  db: PoolClient, companyId: number,
  opts: {
    rows: PartyRow[]; defaultType: "customer" | "vendor"; pricingTier: "retail" | "wholesale"; asOn: string; dryRun: boolean; userId: number | null; userName: string | null;
    // Fills a new party's blank address, city, state and PIN from its GSTIN.
    lookup?: (gstin: string) => Promise<GstinDetails>;
  },
): Promise<{ results: RowResult[]; created: number; openingTotal: { customer: number; vendor: number }; gstFilled: number }> {
  const existing = await db.query(`SELECT type, name, mobile, gstin FROM entities WHERE company_id = $1 AND type IN ('customer', 'vendor')`, [companyId]);
  const seen = new Set<string>();
  const mark = (type: string, name: string, mobile: string, gstin: string) => {
    seen.add(`${type}|n|${key(name)}`);
    if (mobile) seen.add(`${type}|m|${mobile}`);
    if (gstin) seen.add(`${type}|g|${gstin}`);
  };
  const has = (type: string, name: string, mobile: string, gstin: string) =>
    seen.has(`${type}|n|${key(name)}`) || (!!mobile && seen.has(`${type}|m|${mobile}`)) || (!!gstin && seen.has(`${type}|g|${gstin}`));
  for (const e of existing.rows) mark(e.type, String(e.name), String(e.mobile ?? ""), String(e.gstin ?? "").toUpperCase());

  const results: RowResult[] = [];
  const toCreate: { r: RowResult; type: "customer" | "vendor"; name: string; mobile: string; gstin: string | null; address: string | null; city: string | null; state: string | null; pinCode: string | null; creditLimit: number | null; opening: number }[] = [];
  const openingTotal = { customer: 0, vendor: 0 };

  for (const p of opts.rows) {
    const name = str(p.name);
    const r: RowResult = { row: p.row, name: name || "(no name)", status: "new" };
    results.push(r);
    const type = partyType(p.type, opts.defaultType);
    const mobile = mobileOf(p.mobile);
    const gstin = str(p.gstin, 20).toUpperCase().replace(/\s/g, "");
    const fail = (reason: string) => { r.status = "error"; r.reason = reason; };
    if (!name) { fail("Name missing"); continue; }
    if (mobile === null) { fail(`Mobile "${str(p.mobile, 30)}" is not a phone number`); continue; }
    if (gstin && !GSTIN_RE.test(gstin)) { fail(`GSTIN "${gstin}" is not valid`); continue; }

    // Opening balance: one signed column (in the party's natural direction,
    // "Cr"/"Dr" flips it), or separate receivable / payable columns.
    const ob = money(p.openingBalance), rec = money(p.receivable), pay = money(p.payable);
    if (!ob || !rec || !pay) { fail("Opening balance is not a number"); continue; }
    const naturalSide = type === "customer" ? "dr" : "cr";
    let opening = ob.side && ob.side !== naturalSide ? -Math.abs(ob.amount) : ob.side ? Math.abs(ob.amount) : ob.amount;
    opening += type === "customer" ? Math.abs(rec.amount) - Math.abs(pay.amount) : Math.abs(pay.amount) - Math.abs(rec.amount);
    opening = r2(opening);
    const limit = money(p.creditLimit);
    if (!limit) { fail("Credit limit is not a number"); continue; }

    if (has(type, name, mobile, gstin)) { r.status = "exists"; r.reason = `${type === "vendor" ? "Supplier" : "Customer"} already in the ERP (same name, mobile or GSTIN)`; continue; }
    mark(type, name, mobile, gstin);
    r.detail = `${type === "vendor" ? "Supplier" : "Customer"}${opening ? ` · opening ₹${Math.abs(opening).toLocaleString("en-IN")} ${opening > 0 ? (type === "vendor" ? "payable" : "receivable") : "advance"}` : ""}`;
    openingTotal[type] = r2(openingTotal[type] + opening);
    toCreate.push({
      r, type, name, mobile, gstin: gstin || null,
      address: str(p.address, 500) || null, city: str(p.city, 100) || null, state: str(p.state, 100) || null,
      pinCode: str(p.pinCode, 10) || null, creditLimit: limit.amount > 0 ? r2(limit.amount) : null, opening,
    });
  }

  let gstFilled = 0;
  if (!opts.dryRun && opts.lookup) {
    const want = toCreate.filter((p) => p.gstin && (!p.address || !p.state || !p.pinCode)).slice(0, MAX_GST_LOOKUPS);
    for (let i = 0; i < want.length; i += 8) {
      await Promise.all(want.slice(i, i + 8).map(async (p) => {
        const d = await opts.lookup!(p.gstin!);
        if (!d.found) { if (!p.state && d.state) p.state = d.state; return; }
        p.address ||= d.address?.slice(0, 500) ?? null;
        p.city ||= d.city?.slice(0, 100) ?? null;
        p.state ||= d.state?.slice(0, 100) ?? null;
        p.pinCode ||= d.pinCode?.slice(0, 10) ?? null;
        gstFilled++;
      }));
    }
  }

  if (!opts.dryRun && toCreate.length) {
    // Codes from the company-wide entity code counter (see routes/entities.ts),
    // skipping any already typed in by hand.
    await db.query(
      `INSERT INTO entity_code_sequence (company_id, entity_type, last_number) VALUES ($1, 'all', 0) ON CONFLICT (company_id, entity_type) DO NOTHING`,
      [companyId],
    );
    const used = new Set((await db.query(`SELECT code FROM entities WHERE company_id = $1 AND code IS NOT NULL`, [companyId])).rows.map((x: any) => x.code));
    let last: number = (await db.query(`SELECT last_number FROM entity_code_sequence WHERE company_id = $1 AND entity_type = 'all' FOR UPDATE`, [companyId])).rows[0].last_number;
    const nextCode = () => { let c; do c = String(++last).padStart(4, "0"); while (used.has(c)); return c; };

    for (const p of toCreate) {
      const tier = p.type === "customer" ? opts.pricingTier : "retail";
      const e = await db.query(
        `INSERT INTO entities (company_id, type, name, mobile, code, gstin, address, city, state, pin_code, pricing_tier, credit_limit, outstanding_balance, customer_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'import') RETURNING id`,
        [companyId, p.type, p.name, p.mobile, nextCode(), p.gstin, p.address, p.city, p.state, p.pinCode, tier, p.creditLimit, p.opening],
      );
      // The opening balance shows in the party's khata as its first line.
      if (p.opening) {
        await db.query(
          `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_no, created_by_id, created_by_name)
           VALUES ($1, $2, $3::date, 'Opening balance (imported)', $4, $5, $6, 'opening', 'OPENING', $7, $8)`,
          [companyId, e.rows[0].id, opts.asOn, Math.max(p.opening, 0), Math.max(-p.opening, 0), p.opening, opts.userId, opts.userName],
        );
      }
    }
    await db.query(`UPDATE entity_code_sequence SET last_number = GREATEST(last_number, $2) WHERE company_id = $1 AND entity_type = 'all'`, [companyId, last]);
  }
  return { results, created: toCreate.length, openingTotal, gstFilled };
}

// ── Items ────────────────────────────────────────────────────────────

export interface ItemRow {
  row: number; name?: string; itemCode?: string; hsnCode?: string; taxRate?: string; unit?: string; group?: string; brand?: string;
  salePrice?: string; wholesalePrice?: string; purchasePrice?: string; mrp?: string; openingStock?: string; minStock?: string;
}

// The same short code the Add Product form suggests (pages/inventory.tsx).
function suggestItemCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9\s-]/g, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 3).map((w) => (/\d/.test(w) ? w : w.slice(0, 3))).join("-") || "ITEM";
}

const UNIT_MAP: Record<string, string> = {
  nos: "PCS", no: "PCS", pcs: "PCS", pc: "PCS", piece: "PCS", pieces: "PCS", qty: "QTY", kg: "KG", kgs: "KG", kilogram: "KG",
  ltr: "LTR", litre: "LTR", liter: "LTR", l: "LTR", box: "BOX", bag: "BAG", bags: "BAG", mtr: "MTR", meter: "MTR", gm: "GM", gms: "GM", set: "SET", pair: "PAIR",
};

export async function importItems(
  db: PoolClient, companyId: number,
  opts: { rows: ItemRow[]; dryRun: boolean; userId: number | null },
): Promise<{ results: RowResult[]; created: number; stockValue: number }> {
  const existing = await db.query(`SELECT name, item_code, deleted_at FROM products WHERE company_id = $1`, [companyId]);
  // Item codes are unique even against deleted items (products_company_item_code_uq).
  const codes = new Set<string>(existing.rows.map((p: any) => String(p.item_code).toLowerCase()));
  const names = new Set<string>(existing.rows.filter((p: any) => !p.deleted_at).map((p: any) => key(String(p.name))));

  const results: RowResult[] = [];
  const toCreate: any[] = [];
  let stockValue = 0;
  for (const it of opts.rows) {
    const name = str(it.name);
    const r: RowResult = { row: it.row, name: name || "(no name)", status: "new" };
    results.push(r);
    const fail = (reason: string) => { r.status = "error"; r.reason = reason; };
    if (!name) { fail("Item name missing"); continue; }
    const nums: Record<string, number> = {};
    let bad = "";
    for (const f of ["salePrice", "wholesalePrice", "purchasePrice", "mrp", "openingStock", "minStock"] as const) {
      const raw = String(it[f] ?? "").trim();
      const v = raw ? n(raw) : 0;
      if (Number.isNaN(v) || v < 0) { bad = `${f.replace(/[A-Z]/g, (c) => " " + c.toLowerCase())} "${raw}" is not a number`; break; }
      nums[f] = v;
    }
    if (bad) { fail(bad[0].toUpperCase() + bad.slice(1)); continue; }
    // "GST@18%", "18 %", "IGST 12", "Exempt" → 18 / 12 / 0
    const taxRaw = str(it.taxRate, 40);
    const taxMatch = taxRaw.match(/(\d+(?:\.\d+)?)/);
    const taxRate = taxMatch ? Number(taxMatch[1]) : 0;
    if (taxRaw && !taxMatch && !/exempt|nil|none|non/i.test(taxRaw)) { fail(`GST rate "${taxRaw}" not understood`); continue; }
    if (![0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40].includes(taxRate)) { fail(`GST rate ${taxRate}% is not a GST slab`); continue; }

    if (names.has(key(name))) { r.status = "exists"; r.reason = "Item with this name already in the ERP"; continue; }
    let itemCode = str(it.itemCode, 50);
    if (itemCode && codes.has(itemCode.toLowerCase())) { r.status = "exists"; r.reason = `Item code "${itemCode}" already in the ERP`; continue; }
    if (!itemCode) {
      const base = suggestItemCode(name);
      itemCode = base;
      for (let i = 2; codes.has(itemCode.toLowerCase()); i++) itemCode = `${base}-${i}`;
    }
    codes.add(itemCode.toLowerCase());
    names.add(key(name));

    const unitRaw = str(it.unit, 20);
    const unit = UNIT_MAP[unitRaw.toLowerCase().replace(/[^a-z]/g, "")] ?? (unitRaw.toUpperCase() || "QTY");
    const sale = r2(nums.salePrice);
    const stock = r3(nums.openingStock);
    const cost = r2(nums.purchasePrice);
    stockValue = r2(stockValue + stock * cost);
    r.detail = `${itemCode} · ₹${sale}${stock ? ` · stock ${stock} ${unit}` : ""}`;
    toCreate.push({
      name, itemCode, unit, taxRate, hsnCode: str(it.hsnCode, 12).replace(/\s/g, "") || null,
      group: str(it.group, 100) || "General", brand: str(it.brand, 100) || "General",
      retail: sale, wholesale: r2(nums.wholesalePrice || sale), purchase: cost, mrp: r2(nums.mrp || sale),
      stock, stockValue: r2(stock * cost), minStock: nums.minStock ? r3(nums.minStock) : null,
    });
  }

  if (!opts.dryRun) {
    for (const brand of new Set(toCreate.map((p) => p.brand))) {
      await db.query(`INSERT INTO brands (company_id, name) VALUES ($1, $2) ON CONFLICT (company_id, name) DO NOTHING`, [companyId, brand]);
    }
    for (const p of toCreate) {
      const ins = await db.query(
        `INSERT INTO products (company_id, name, "group", brand, item_code, unit, purchase_price, retail_price, wholesale_price, mrp,
                               current_stock, opening_stock, opening_stock_value, hsn_code, tax_rate, min_stock_threshold)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, $14, $15) RETURNING id`,
        [companyId, p.name, p.group, p.brand, p.itemCode, p.unit, p.purchase, p.retail, p.wholesale, p.mrp, p.stock, p.stockValue, p.hsnCode, p.taxRate, p.minStock],
      );
      if (p.stock > 0) {
        await db.query(
          `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, user_id) VALUES ($1, $2, 'inward', $3, 'Opening stock (imported)', $4)`,
          [companyId, ins.rows[0].id, p.stock, opts.userId ?? 1],
        );
      }
    }
  }
  return { results, created: toCreate.length, stockValue };
}
