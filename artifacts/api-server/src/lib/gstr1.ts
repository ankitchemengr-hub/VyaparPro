// GSTR-1 for a period, from GST sale invoices and the sales returns against
// them, in the sections of the return and as the JSON the GST portal takes
// (Returns → GSTR-1 → Prepare offline → Upload):
//
//   b2b    invoices to a registered buyer (valid GSTIN on the invoice)
//   b2cl   unregistered, inter-state, invoice value above ₹1 lakh (₹2.5 lakh before Aug 2024)
//   b2cs   every other unregistered sale, by place of supply and rate
//   cdnr   credit notes (sales returns) to registered buyers
//   cdnur  credit notes on a B2CL invoice; other unregistered returns reduce b2cs
//   nil    0 % lines (nil rated)
//   hsn    HSN summary, B2B and B2C apart, net of returns
//   doc_issue  invoice and credit note number series, with cancelled bills
//
// A line's taxable value is qty × rate − discount, as billing works it out;
// freight and the bill discount (after Grand Total) are outside it. Whether a
// bill is inter-state is read from the tax it was saved with (IGST or CGST +
// SGST), so the return always matches the printed bill. Bill lines don't keep
// an HSN of their own (invoice_items.hsn_code is left empty), so it comes from the item.
import { pool } from "@workspace/db";

const IST = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman and Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
const squash = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");
const CODE_BY_STATE = new Map<string, string>(Object.entries(STATE_CODES).map(([c, s]) => [squash(s), c]));
for (const [alias, code] of [["orissa", "21"], ["pondicherry", "34"], ["jandk", "01"], ["newdelhi", "07"], ["damananddiu", "26"], ["dadraandnagarhaveli", "26"], ["uttaranchal", "05"], ["andamanandnicobar", "35"]] as const) {
  CODE_BY_STATE.set(alias, code);
}
export function stateCode(name: unknown): string | null {
  const s = String(name ?? "").trim();
  if (/^\d{2}$/.test(s) && STATE_CODES[s]) return s;
  return CODE_BY_STATE.get(squash(s.replace(/^\d{2}\s*[-–]\s*/, ""))) ?? null;
}

export const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;

// Our units → the portal's UQC list (Unit Quantity Code).
const UQC: Record<string, string> = {
  qty: "NOS", nos: "NOS", no: "NOS", pcs: "PCS", pc: "PCS", piece: "PCS", kg: "KGS", kgs: "KGS", gm: "GMS", gms: "GMS", g: "GMS",
  ltr: "LTR", l: "LTR", liter: "LTR", litre: "LTR", ml: "MLT", mtr: "MTR", m: "MTR", meter: "MTR", box: "BOX", bag: "BAG", bags: "BAG",
  btl: "BTL", bottle: "BTL", can: "CAN", ctn: "CTN", carton: "CTN", doz: "DOZ", dozen: "DOZ", drum: "DRM", drm: "DRM", set: "SET", pair: "PRS",
  prs: "PRS", roll: "ROL", rol: "ROL", pkt: "PAC", pack: "PAC", pac: "PAC", bundle: "BUN", bun: "BUN", ton: "TON", tonne: "TON",
  qtl: "QTL", quintal: "QTL", sqft: "SQF", sqm: "SQM", unit: "UNT", unt: "UNT", tub: "TBS", jar: "JAR", bucket: "OTH",
};
export const uqcOf = (unit: unknown) => UQC[String(unit ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? "OTH";

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

interface Tax { txval: number; iamt: number; camt: number; samt: number; csamt: number }
const zero = (): Tax => ({ txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
function add(t: Tax, o: Tax, sign = 1) {
  t.txval += sign * o.txval; t.iamt += sign * o.iamt; t.camt += sign * o.camt; t.samt += sign * o.samt; t.csamt += sign * o.csamt;
}
const round = (t: Tax): Tax => ({ txval: r2(t.txval), iamt: r2(t.iamt), camt: r2(t.camt), samt: r2(t.samt), csamt: r2(t.csamt) });
function lineTax(txval: number, rt: number, cess: number, inter: boolean): Tax {
  const tax = (txval * rt) / 100;
  return { txval, iamt: inter ? tax : 0, camt: inter ? 0 : tax / 2, samt: inter ? 0 : tax / 2, csamt: (txval * cess) / 100 };
}

interface Doc {
  id: number; no: string; date: string; party: string; gstin: string | null; pos: string; posName: string;
  inter: boolean; value: number; byRate: Map<number, Tax>; section: "b2b" | "b2cl" | "b2cs";
}

export interface Gstr1 {
  gstin: string; fp: string; from: string; to: string;
  warnings: string[];
  summary: { section: string; label: string; count: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }[];
  b2b: { gstin: string; party: string; no: string; date: string; value: number; pos: string; rate: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }[];
  b2cl: { no: string; date: string; value: number; pos: string; rate: number; txval: number; iamt: number; csamt: number }[];
  b2cs: { pos: string; type: "INTRA" | "INTER"; rate: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }[];
  cdn: { section: "cdnr" | "cdnur"; gstin: string | null; party: string; no: string; date: string; invoiceNo: string; value: number; pos: string; rate: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }[];
  nil: { type: string; amount: number }[];
  hsn: { table: "B2B" | "B2C"; hsn: string; desc: string; uqc: string; qty: number; rate: number; txval: number; iamt: number; camt: number; samt: number; csamt: number }[];
  docs: { doc: "Invoices for outward supply" | "Credit note"; from: string; to: string; total: number; cancelled: number; net: number }[];
  json: Record<string, unknown>;
}

// The return's period: a month, or a quarter (QRMP) — fp is its last month.
export function gstr1Period(from: string, to: string): string {
  return `${to.slice(5, 7)}${to.slice(0, 4)}`;
}

export async function buildGstr1(companyId: number, from: string, to: string): Promise<Gstr1> {
  const warnings: string[] = [];
  const settings = await pool.query(`SELECT config FROM print_settings WHERE company_id = $1`, [companyId]);
  const gstin = String(settings.rows[0]?.config?.gstin ?? "").trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) warnings.push("Company GSTIN is missing or invalid — set it in Settings → Printing (GSTIN). The JSON needs it.");
  const homeCode = gstin.slice(0, 2);

  const [lines, invoices, returnLines, returns] = await Promise.all([
    pool.query(
      `SELECT ii.invoice_id, ii.id AS item_id, COALESCE(NULLIF(ii.hsn_code, ''), pr.hsn_code) AS hsn_code, ii.product_name, ii.unit, ii.qty, ii.rate, ii.discount_amt, ii.tax_pct, ii.cess_pct
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = ii.company_id
       LEFT JOIN products pr ON pr.id = ii.product_id AND pr.company_id = ii.company_id
       WHERE i.company_id = $1 AND i.invoice_type = 'gst' AND i.status = 'saved' AND ${IST("i.invoice_date")} BETWEEN $2::date AND $3::date
       ORDER BY ii.invoice_id, ii.id`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT i.id, i.invoice_no, ${IST("i.invoice_date")}::text AS day, i.status, i.customer_gstin, i.place_of_supply, i.igst, i.cgst, i.grand_total,
              COALESCE(NULLIF(i.customer_name, ''), e.name, 'Cash customer') AS party, e.gstin AS entity_gstin
       FROM invoices i LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
       WHERE i.company_id = $1 AND i.invoice_type = 'gst' AND i.status IN ('saved', 'cancelled') AND ${IST("i.invoice_date")} BETWEEN $2::date AND $3::date
       ORDER BY i.invoice_date, i.id`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT sri.return_id, sri.qty, sri.unit, sri.tax_pct, sri.amount, sri.product_name, COALESCE(NULLIF(ii.hsn_code, ''), pr.hsn_code) AS hsn_code, ii.cess_pct
       FROM sales_return_items sri
       JOIN sales_returns sr ON sr.id = sri.return_id AND sr.company_id = sri.company_id
       JOIN invoices i ON i.id = sr.invoice_id AND i.company_id = sr.company_id
       LEFT JOIN invoice_items ii ON ii.id = sri.invoice_item_id AND ii.company_id = sri.company_id
       LEFT JOIN products pr ON pr.id = sri.product_id AND pr.company_id = sri.company_id
       WHERE sr.company_id = $1 AND sr.status = 'saved' AND i.invoice_type = 'gst' AND ${IST("sr.return_date")} BETWEEN $2::date AND $3::date
       ORDER BY sri.return_id, sri.id`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT sr.id, sr.return_no, ${IST("sr.return_date")}::text AS day, sr.status, sr.grand_total, sr.invoice_no,
              ${IST("i.invoice_date")}::text AS inv_day, i.customer_gstin, i.place_of_supply, i.igst, i.cgst, i.grand_total AS inv_total,
              COALESCE(NULLIF(sr.customer_name, ''), NULLIF(i.customer_name, ''), 'Cash customer') AS party, e.gstin AS entity_gstin
       FROM sales_returns sr
       JOIN invoices i ON i.id = sr.invoice_id AND i.company_id = sr.company_id AND i.invoice_type = 'gst'
       LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
       WHERE sr.company_id = $1 AND sr.status IN ('saved', 'cancelled') AND ${IST("sr.return_date")} BETWEEN $2::date AND $3::date
       ORDER BY sr.return_date, sr.id`,
      [companyId, from, to],
    ),
  ]);

  // Bill-level facts shared by invoices and the returns made against them.
  const missingPos = new Set<string>();
  const badGstin = new Set<string>();
  function partyOf(row: any, label: string) {
    const raw = String(row.customer_gstin || row.entity_gstin || "").trim().toUpperCase();
    const valid = GSTIN_RE.test(raw) && raw !== gstin;
    if (raw && !valid) badGstin.add(`${label} (${raw})`);
    let pos = stateCode(row.place_of_supply);
    if (!pos) { missingPos.add(`${label}: "${row.place_of_supply ?? ""}"`); pos = homeCode || "97"; }
    const inter = n(row.igst) > 0 || (n(row.cgst) === 0 && !!homeCode && pos !== homeCode);
    return { gstin: valid ? raw : null, pos, inter };
  }
  const b2clLimit = (day: string) => (day >= "2024-08-01" ? 100000 : 250000);

  const docs = new Map<number, Doc>();
  for (const i of invoices.rows) {
    if (i.status !== "saved") continue;
    const p = partyOf(i, `Invoice ${i.invoice_no}`);
    const value = r2(n(i.grand_total));
    docs.set(i.id, {
      id: i.id, no: i.invoice_no, date: i.day, party: i.party, gstin: p.gstin, pos: p.pos, posName: STATE_CODES[p.pos] ?? p.pos,
      inter: p.inter, value, byRate: new Map(),
      section: p.gstin ? "b2b" : p.inter && value > b2clLimit(i.day) ? "b2cl" : "b2cs",
    });
  }

  const nil = new Map<string, number>();
  const nilKey = (registered: boolean, inter: boolean) => `${inter ? "INTR" : "INTRA"}${registered ? "B2B" : "B2C"}`;
  const hsn = new Map<string, { table: "B2B" | "B2C"; hsn: string; desc: string; uqc: string; qty: number; rate: number } & Tax>();
  const noHsn = new Set<string>();
  function hsnAdd(registered: boolean, code: unknown, desc: string, unit: unknown, qty: number, rate: number, t: Tax, sign: number) {
    const h = String(code ?? "").replace(/\s/g, "");
    if (!/^\d{4,8}$/.test(h)) noHsn.add(desc);
    const table = registered ? "B2B" : "B2C";
    const uqc = uqcOf(unit);
    const k = `${table}|${h}|${uqc}|${rate}`;
    let row = hsn.get(k);
    if (!row) hsn.set(k, (row = { table, hsn: h || "—", desc, uqc, qty: 0, rate, ...zero() }));
    row.qty += sign * qty;
    add(row, t, sign);
  }

  for (const l of lines.rows) {
    const d = docs.get(l.invoice_id);
    if (!d) continue;
    const txval = n(l.qty) * n(l.rate) - n(l.discount_amt);
    const rt = n(l.tax_pct);
    const t = lineTax(txval, rt, n(l.cess_pct), d.inter);
    hsnAdd(!!d.gstin, l.hsn_code, l.product_name, l.unit, n(l.qty), rt, t, 1);
    if (rt === 0) { const k = nilKey(!!d.gstin, d.inter); nil.set(k, (nil.get(k) ?? 0) + txval); continue; }
    let slot = d.byRate.get(rt);
    if (!slot) d.byRate.set(rt, (slot = zero()));
    add(slot, t);
  }

  // Credit notes, from the return lines (amount includes tax).
  const cdnDocs = new Map<number, { row: any; p: ReturnType<typeof partyOf>; section: "cdnr" | "cdnur" | "b2cs"; byRate: Map<number, Tax> }>();
  for (const r of returns.rows) {
    if (r.status !== "saved") continue;
    const p = partyOf(r, `Return ${r.return_no}`);
    const section = p.gstin ? "cdnr" : p.inter && n(r.inv_total) > b2clLimit(r.inv_day) ? "cdnur" : "b2cs";
    cdnDocs.set(r.id, { row: r, p, section, byRate: new Map() });
  }
  for (const l of returnLines.rows) {
    const c = cdnDocs.get(l.return_id);
    if (!c) continue;
    const rt = n(l.tax_pct);
    const cess = n(l.cess_pct);
    const txval = n(l.amount) / (1 + (rt + cess) / 100);
    const t = lineTax(txval, rt, cess, c.p.inter);
    hsnAdd(!!c.p.gstin, l.hsn_code, l.product_name, l.unit, n(l.qty), rt, t, -1);
    if (rt === 0) { const k = nilKey(!!c.p.gstin, c.p.inter); nil.set(k, (nil.get(k) ?? 0) - txval); continue; }
    let slot = c.byRate.get(rt);
    if (!slot) c.byRate.set(rt, (slot = zero()));
    add(slot, t);
  }

  // ── Section rows ──
  const out: Gstr1 = { gstin, fp: gstr1Period(from, to), from, to, warnings, summary: [], b2b: [], b2cl: [], b2cs: [], cdn: [], nil: [], hsn: [], docs: [], json: {} };
  const b2csMap = new Map<string, { pos: string; type: "INTRA" | "INTER"; rate: number } & Tax>();
  const b2csAdd = (pos: string, inter: boolean, rate: number, t: Tax, sign: number) => {
    const k = `${pos}|${inter ? "INTER" : "INTRA"}|${rate}`;
    let row = b2csMap.get(k);
    if (!row) b2csMap.set(k, (row = { pos, type: inter ? "INTER" : "INTRA", rate, ...zero() }));
    add(row, t, sign);
  };
  const posLabel = (code: string) => `${code}-${STATE_CODES[code] ?? ""}`;

  for (const d of docs.values()) {
    for (const [rate, t0] of [...d.byRate].sort((a, b) => a[0] - b[0])) {
      const t = round(t0);
      if (d.section === "b2b") out.b2b.push({ gstin: d.gstin!, party: d.party, no: d.no, date: d.date, value: d.value, pos: posLabel(d.pos), rate, ...t });
      else if (d.section === "b2cl") out.b2cl.push({ no: d.no, date: d.date, value: d.value, pos: posLabel(d.pos), rate, txval: t.txval, iamt: t.iamt, csamt: t.csamt });
      else b2csAdd(d.pos, d.inter, rate, t0, 1);
    }
  }
  for (const c of cdnDocs.values()) {
    for (const [rate, t0] of [...c.byRate].sort((a, b) => a[0] - b[0])) {
      if (c.section === "b2cs") { b2csAdd(c.p.pos, c.p.inter, rate, t0, -1); continue; }
      out.cdn.push({
        section: c.section, gstin: c.p.gstin, party: c.row.party, no: c.row.return_no, date: c.row.day, invoiceNo: c.row.invoice_no,
        value: r2(n(c.row.grand_total)), pos: posLabel(c.p.pos), rate, ...round(t0),
      });
    }
  }
  out.b2cs = [...b2csMap.values()].map((r) => ({ ...r, ...round(r), pos: posLabel(r.pos) }))
    .filter((r) => r.txval !== 0).sort((a, b) => a.pos.localeCompare(b.pos) || a.rate - b.rate);
  out.nil = [...nil].map(([type, amount]) => ({ type, amount: r2(amount) })).filter((x) => x.amount !== 0);
  out.hsn = [...hsn.values()].map((h) => ({ ...h, ...round(h), qty: r3(h.qty) }))
    .sort((a, b) => a.table.localeCompare(b.table) || a.hsn.localeCompare(b.hsn) || a.rate - b.rate);

  // Document series: the bill number without its running number at the end.
  function series(rows: { no: string; status: string }[], doc: Gstr1["docs"][number]["doc"]) {
    const groups = new Map<string, { nums: { no: string; n: number }[]; cancelled: number }>();
    for (const r of rows) {
      const m = String(r.no).match(/^(.*?)(\d+)$/);
      const prefix = m ? m[1] : r.no;
      let g = groups.get(prefix);
      if (!g) groups.set(prefix, (g = { nums: [], cancelled: 0 }));
      g.nums.push({ no: r.no, n: m ? Number(m[2]) : 0 });
      if (r.status === "cancelled") g.cancelled++;
    }
    for (const g of groups.values()) {
      g.nums.sort((a, b) => a.n - b.n);
      out.docs.push({ doc, from: g.nums[0].no, to: g.nums[g.nums.length - 1].no, total: g.nums.length, cancelled: g.cancelled, net: g.nums.length - g.cancelled });
    }
  }
  series(invoices.rows.map((i: any) => ({ no: i.invoice_no, status: i.status })), "Invoices for outward supply");
  series(returns.rows.map((r: any) => ({ no: r.return_no, status: r.status })), "Credit note");

  // ── Summary ──
  const sum = (rows: Partial<Tax>[]) => {
    const t = zero();
    for (const r of rows) add(t, { txval: r.txval ?? 0, iamt: r.iamt ?? 0, camt: r.camt ?? 0, samt: r.samt ?? 0, csamt: r.csamt ?? 0 });
    return round(t);
  };
  const cdnr = out.cdn.filter((c) => c.section === "cdnr"), cdnur = out.cdn.filter((c) => c.section === "cdnur");
  out.summary = [
    { section: "b2b", label: "4A B2B invoices", count: new Set(out.b2b.map((r) => r.no)).size, ...sum(out.b2b) },
    { section: "b2cl", label: "5 B2C Large invoices", count: new Set(out.b2cl.map((r) => r.no)).size, ...sum(out.b2cl) },
    { section: "b2cs", label: "7 B2C Small (net of returns)", count: out.b2cs.length, ...sum(out.b2cs) },
    { section: "cdnr", label: "9B Credit notes — registered", count: new Set(cdnr.map((r) => r.no)).size, ...sum(cdnr) },
    { section: "cdnur", label: "9B Credit notes — unregistered", count: new Set(cdnur.map((r) => r.no)).size, ...sum(cdnur) },
    { section: "nil", label: "8 Nil rated", count: out.nil.length, ...sum(out.nil.map((x) => ({ txval: x.amount }))) },
  ];

  if (missingPos.size) warnings.push(`Place of supply not recognised, taken as your own state: ${[...missingPos].slice(0, 5).join("; ")}${missingPos.size > 5 ? ` and ${missingPos.size - 5} more` : ""}`);
  if (badGstin.size) warnings.push(`GSTIN on the bill is not valid, reported as B2C: ${[...badGstin].slice(0, 5).join("; ")}${badGstin.size > 5 ? ` and ${badGstin.size - 5} more` : ""}`);
  if (noHsn.size) warnings.push(`HSN missing or shorter than 4 digits: ${[...noHsn].slice(0, 5).join(", ")}${noHsn.size > 5 ? ` and ${noHsn.size - 5} more` : ""} — fix it on the item (Inventory) and on the bill.`);

  out.json = portalJson(out, docs, cdnDocs);
  return out;
}

// The JSON the GST portal's GSTR-1 upload takes (same shape as the offline tool's).
function portalJson(g: Gstr1, docs: Map<number, Doc>, cdnDocs: Map<number, { row: any; p: { gstin: string | null; pos: string; inter: boolean }; section: string; byRate: Map<number, Tax> }>) {
  const itms = (byRate: Map<number, Tax>, interOnly = false) =>
    [...byRate].sort((a, b) => a[0] - b[0]).map(([rt, t0], i) => {
      const t = round(t0);
      return { num: i + 1, itm_det: interOnly ? { txval: t.txval, rt, iamt: t.iamt, csamt: t.csamt } : { txval: t.txval, rt, iamt: t.iamt, camt: t.camt, samt: t.samt, csamt: t.csamt } };
    });

  const b2bBy = new Map<string, any[]>();
  const b2clBy = new Map<string, any[]>();
  for (const d of docs.values()) {
    if (!d.byRate.size) continue;
    if (d.section === "b2b") {
      if (!b2bBy.has(d.gstin!)) b2bBy.set(d.gstin!, []);
      b2bBy.get(d.gstin!)!.push({ inum: d.no, idt: ddmmyyyy(d.date), val: d.value, pos: d.pos, rchrg: "N", inv_typ: "R", itms: itms(d.byRate) });
    } else if (d.section === "b2cl") {
      if (!b2clBy.has(d.pos)) b2clBy.set(d.pos, []);
      b2clBy.get(d.pos)!.push({ inum: d.no, idt: ddmmyyyy(d.date), val: d.value, itms: itms(d.byRate, true) });
    }
  }
  const cdnrBy = new Map<string, any[]>();
  const cdnur: any[] = [];
  for (const c of cdnDocs.values()) {
    if (c.section === "b2cs" || !c.byRate.size) continue;
    const nt = { ntty: "C", nt_num: c.row.return_no, nt_dt: ddmmyyyy(c.row.day), val: r2(n(c.row.grand_total)), pos: c.p.pos };
    if (c.section === "cdnr") {
      if (!cdnrBy.has(c.p.gstin!)) cdnrBy.set(c.p.gstin!, []);
      cdnrBy.get(c.p.gstin!)!.push({ ...nt, rchrg: "N", inv_typ: "R", itms: itms(c.byRate) });
    } else {
      cdnur.push({ ...nt, typ: "B2CL", itms: itms(c.byRate, true) });
    }
  }
  const hsnRows = (table: "B2B" | "B2C") => g.hsn.filter((h) => h.table === table).map((h, i) => ({
    num: i + 1, hsn_sc: h.hsn === "—" ? "" : h.hsn, desc: h.desc.slice(0, 30), uqc: h.uqc, qty: h.qty, rt: h.rate,
    txval: h.txval, iamt: h.iamt, camt: h.camt, samt: h.samt, csamt: h.csamt,
  }));

  const json: Record<string, unknown> = { gstin: g.gstin, fp: g.fp, version: "GST3.2.1", hash: "hash" };
  if (b2bBy.size) json.b2b = [...b2bBy].map(([ctin, inv]) => ({ ctin, inv }));
  if (b2clBy.size) json.b2cl = [...b2clBy].map(([pos, inv]) => ({ pos, inv }));
  if (g.b2cs.length) {
    json.b2cs = g.b2cs.map((r) => {
      const base = { sply_ty: r.type, pos: r.pos.slice(0, 2), typ: "OE", rt: r.rate, txval: r.txval, csamt: r.csamt };
      return r.type === "INTER" ? { ...base, iamt: r.iamt } : { ...base, camt: r.camt, samt: r.samt };
    });
  }
  if (cdnrBy.size) json.cdnr = [...cdnrBy].map(([ctin, nt]) => ({ ctin, nt }));
  if (cdnur.length) json.cdnur = cdnur;
  if (g.nil.length) {
    json.nil = { inv: ["INTRB2B", "INTRAB2B", "INTRB2C", "INTRAB2C"].filter((t) => g.nil.some((x) => x.type === t))
      .map((t) => ({ sply_ty: t, nil_amt: g.nil.find((x) => x.type === t)!.amount, expt_amt: 0, ngsup_amt: 0 })) };
  }
  const hb2b = hsnRows("B2B"), hb2c = hsnRows("B2C");
  if (hb2b.length || hb2c.length) json.hsn = { ...(hb2b.length ? { hsn_b2b: hb2b } : {}), ...(hb2c.length ? { hsn_b2c: hb2c } : {}) };
  const docDet = [
    { doc_num: 1, doc: "Invoices for outward supply" as const },
    { doc_num: 5, doc: "Credit note" as const },
  ].map(({ doc_num, doc }) => ({
    doc_num,
    docs: g.docs.filter((d) => d.doc === doc).map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.net })),
  })).filter((d) => d.docs.length);
  if (docDet.length) json.doc_issue = { doc_det: docDet };
  return json;
}
