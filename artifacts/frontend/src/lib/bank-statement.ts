// Reads a bank statement in the browser — Excel / CSV (by its header row) or
// a text PDF (by the position of each word on the page) — into plain rows
// for Bank Reconciliation. Nothing leaves the browser until the user imports.

export interface StatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  ref: string;
  debit: number;
  credit: number;
  balance: number | null;
  // Withdrawal / deposit could not be told apart for sure — shown for a check.
  unsure?: boolean;
}

export interface ParsedStatement {
  rows: StatementRow[];
  skipped: number;
}

export class StatementPasswordError extends Error {
  constructor(public wrong: boolean) { super(wrong ? "Wrong password" : "This PDF needs a password"); }
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// Indian statements write day first: 03/10/2026, 03-10-26, 03 Oct 2026, 03-OCT-26.
export function parseStatementDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Excel date cells can land a few minutes before local midnight
    // (old timezone offsets) — the nearest day is the one meant.
    const d = new Date(v.getTime() + 12 * 3600_000);
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  const s = String(v ?? "").trim().toUpperCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})\b/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\-/ ]?([A-Z]{3,4})[A-Z]*[\-/ ,]*(\d{2}|\d{4})\b/);
  if (m && MONTHS[m[2]]) return ymd(+m[3], MONTHS[m[2]], +m[1]);
  m = s.match(/^([A-Z]{3,4})[A-Z]* (\d{1,2}),? (\d{4})\b/);
  if (m && MONTHS[m[1]]) return ymd(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

const AMOUNT_RE = /^\(?-?₹?\s?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\)?(?:\s*(?:CR|DR)\.?)?$|^\(?-?₹?\d+(?:\.\d{1,2})?\)?(?:\s*(?:CR|DR)\.?)?$/i;

// "1,23,456.78", "500.00 Cr", "(250.00)" → number (sign kept for Dr / brackets).
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const raw = String(v ?? "").trim();
  if (!raw || raw === "-" || !AMOUNT_RE.test(raw)) return null;
  const neg = /^\(.*\)$/.test(raw.replace(/\s*(CR|DR)\.?$/i, "")) || raw.startsWith("-") || /DR\.?$/i.test(raw);
  const n = Number(raw.replace(/[₹,()\s]/g, "").replace(/(CR|DR)\.?$/i, "").replace(/^-/, ""));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// With a running balance, the change from one line to the next says whether
// money came in or went out — more reliable than column positions.
function fixDirections(rows: StatementRow[]): void {
  const flip = (r: StatementRow) => { const t = r.debit; r.debit = r.credit; r.credit = t; };
  const fits = (prev: number, r: StatementRow, sign: 1 | -1) =>
    Math.abs(round2(prev + sign * (r.credit - r.debit)) - (r.balance as number)) < 0.011;
  // Oldest first or newest first: whichever order the balances agree with.
  for (const order of [1, -1] as const) {
    const seq = order === 1 ? rows : [...rows].reverse();
    let agree = 0, total = 0;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i].balance == null || seq[i - 1].balance == null) continue;
      total++;
      if (fits(seq[i - 1].balance as number, seq[i], 1)) agree++;
      else {
        const t = { ...seq[i], debit: seq[i].credit, credit: seq[i].debit };
        if (fits(seq[i - 1].balance as number, t, 1)) agree++;
      }
    }
    if (total && agree / total >= 0.8) {
      for (let i = 1; i < seq.length; i++) {
        const r = seq[i];
        if (r.balance == null || seq[i - 1].balance == null) continue;
        if (fits(seq[i - 1].balance as number, r, 1)) { r.unsure = false; continue; }
        flip(r);
        r.unsure = !fits(seq[i - 1].balance as number, r, 1);
        if (r.unsure) flip(r);
      }
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Excel / CSV

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z/ ]+/g, " ").replace(/\s+/g, " ").trim();

type Cols = { date: number; desc: number[]; ref: number; debit: number; credit: number; amount: number; drcr: number; balance: number };

function findColumns(header: unknown[]): Cols | null {
  const h = header.map(norm);
  const find = (re: RegExp, not?: RegExp) => h.findIndex((c) => re.test(c) && !(not && not.test(c)));
  let date = find(/^(txn|tran|transaction|trans)\.? ?date|^date$|^posting date|^txn dt|^tran dt/);
  if (date < 0) date = find(/date/, /value/);
  if (date < 0) date = find(/date/);
  const desc = h.map((c, i) => (/narration|description|particulars|remarks|details|transaction details/.test(c) ? i : -1)).filter((i) => i >= 0);
  const ref = find(/ref|chq|cheque|utr|instrument/);
  const debit = find(/withdrawal|debit|^dr$|paid out|^withdrawals/);
  const credit = find(/deposit|credit|^cr$|paid in|^deposits/);
  const amount = find(/^amount|^txn amount|transaction amount/);
  const drcr = find(/^type$|dr ?\/ ?cr|cr ?\/ ?dr|debit ?\/ ?credit/);
  const balance = find(/balance/);
  if (date < 0 || !((debit >= 0 && credit >= 0) || amount >= 0)) return null;
  return { date, desc, ref, debit, credit, amount, drcr, balance };
}

export async function parseSpreadsheet(file: File): Promise<ParsedStatement> {
  const XLSX = await import("xlsx");
  // raw: CSV and the HTML ".xls" many banks send stay text — their
  // "01/10/2026" would otherwise be read month-first. Real Excel date cells
  // still come as dates.
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true, raw: true });
  let best: ParsedStatement = { rows: [], skipped: 0 };
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: "", blankrows: false });
    let headerAt = -1;
    let cols: Cols | null = null;
    for (let i = 0; i < Math.min(grid.length, 40); i++) {
      cols = findColumns(grid[i]);
      if (cols) { headerAt = i; break; }
    }
    if (!cols) continue;
    const rows: StatementRow[] = [];
    let skipped = 0;
    for (const line of grid.slice(headerAt + 1)) {
      const date = parseStatementDate(line[cols.date]);
      const desc = cols.desc.map((i) => String(line[i] ?? "").trim()).filter(Boolean).join(" ");
      if (!date) {
        // A narration wrapped onto the next row belongs to the line above.
        const anyAmount = [cols.debit, cols.credit, cols.amount].some((i) => i >= 0 && parseAmount(line[i]));
        if (rows.length && desc && !anyAmount) rows[rows.length - 1].description += ` ${desc}`;
        else if (line.some((c) => String(c ?? "").trim())) skipped++;
        continue;
      }
      let debit = 0, credit = 0;
      if (cols.debit >= 0 && cols.credit >= 0) {
        debit = Math.abs(parseAmount(line[cols.debit]) ?? 0);
        credit = Math.abs(parseAmount(line[cols.credit]) ?? 0);
      } else {
        const a = parseAmount(line[cols.amount]) ?? 0;
        const t = cols.drcr >= 0 ? norm(line[cols.drcr]) : "";
        const isDebit = /^(dr|d|debit|withdrawal)/.test(t) || (!t && a < 0) || /DR\.?$/i.test(String(line[cols.amount]));
        if (isDebit) debit = Math.abs(a); else credit = Math.abs(a);
      }
      if ((debit > 0) === (credit > 0)) { skipped++; continue; }
      rows.push({
        date, description: desc, ref: cols.ref >= 0 ? String(line[cols.ref] ?? "").trim() : "",
        debit: round2(debit), credit: round2(credit),
        balance: cols.balance >= 0 ? parseAmount(line[cols.balance]) : null,
      });
    }
    if (rows.length > best.rows.length) best = { rows, skipped };
  }
  fixDirections(best.rows);
  return best;
}

// ---------------------------------------------------------------------------
// PDF

type Word = { s: string; x: number; r: number };

export async function parsePdf(file: File, password?: string): Promise<ParsedStatement> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  let doc: any;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password }).promise;
  } catch (e: any) {
    if (e?.name === "PasswordException") throw new StatementPasswordError(e.code === 2);
    throw e;
  }

  // Every page as lines of words, top to bottom, left to right.
  const lines: Word[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const byY: Array<{ y: number; words: Word[] }> = [];
    for (const it of content.items as any[]) {
      const s = String(it.str ?? "").trim();
      if (!s) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = byY.find((r) => Math.abs(r.y - y) <= 2.5);
      if (!row) { row = { y, words: [] }; byY.push(row); }
      row.words.push({ s, x, r: x + (it.width ?? 0) });
    }
    byY.sort((a, b) => b.y - a.y);
    for (const r of byY) lines.push(r.words.sort((a, b) => a.x - b.x));
  }
  if (!lines.length) throw new Error("No text in this PDF — it looks like a scanned copy. Download the statement as Excel/CSV or a text PDF from net banking.");

  // Column positions from the header line, when there is one.
  let colDebit: number | null = null, colCredit: number | null = null, colBalance: number | null = null;
  for (const l of lines) {
    const t = l.map((w) => w.s.toLowerCase());
    const at = (re: RegExp) => { const i = t.findIndex((s) => re.test(s)); return i >= 0 ? (l[i].x + l[i].r) / 2 : null; };
    const d = at(/withdrawal|debit|^dr\.?$/), c = at(/deposit|credit|^cr\.?$/), b = at(/balance/);
    if (d != null && c != null && b != null && t.some((s) => /date/.test(s))) { colDebit = d; colCredit = c; colBalance = b; break; }
  }

  const rows: StatementRow[] = [];
  let skipped = 0;
  let lastRow: StatementRow | null = null;
  let since = 0;
  let opening: number | null = null;
  for (const l of lines) {
    // Date at the start: one word ("03/10/2026") or split ("03", "Oct", "2026").
    // Some banks print a serial number before it.
    let date: string | null = null;
    let used = 0;
    const serial = /^\d{1,4}$/.test(l[0]?.s ?? "") && l.length > 1 && !/^[A-Za-z]{3}/.test(l[1].s) ? 1 : 0;
    for (let n = 1; n <= 3 && serial + n <= l.length && !date; n++) {
      date = parseStatementDate(l.slice(serial, serial + n).map((w) => w.s).join(" "));
      if (date) used = serial + n;
    }
    const words = l.slice(used);
    const amounts: Array<{ v: number; mid: number; cr: boolean | null }> = [];
    const text: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1]?.s ?? "";
      const withMark = /^(cr|dr)\.?$/i.test(next) ? `${w.s} ${next}` : w.s;
      const v = /\d\.\d{1,2}\b|\d,\d{3}/.test(w.s) || /^\d+\.\d{2}$/.test(w.s) ? parseAmount(withMark) : null;
      if (v != null && words.slice(i + 1).every((x) => parseAmount(x.s) != null || /^(cr|dr)\.?$/i.test(x.s))) {
        amounts.push({ v: Math.abs(v), mid: (w.x + w.r) / 2, cr: /cr\.?$/i.test(withMark) ? true : /dr\.?$/i.test(withMark) || v < 0 ? false : null });
        if (withMark !== w.s) i++;
      } else if (!parseStatementDate(w.s)) {
        text.push(w.s);
      }
    }
    if (!date) {
      const ob: RegExpMatchArray | null = opening == null ? l.map((w) => w.s).join(" ").match(/(?:opening balance|balance b\/?f|brought forward)\D{0,15}?([\d,]+\.\d{1,2})\s*(cr|dr)?/i) : null;
      if (ob) {
        opening = (parseAmount(ob[1]) ?? 0) * (/dr/i.test(ob[2] ?? "") ? -1 : 1);
        continue;
      }
      // Narration running onto the next line(s).
      if (lastRow && !amounts.length && since < 3 && text.length && !/page|statement|balance|total/i.test(text.join(" "))) {
        lastRow.description += ` ${text.join(" ")}`;
        since++;
      }
      continue;
    }
    since = 0;
    if (!amounts.length) { skipped++; lastRow = null; continue; }
    let debit = 0, credit = 0, balance: number | null = null, unsure = false;
    if (colDebit != null && colCredit != null && colBalance != null) {
      for (const a of amounts) {
        const dist = [Math.abs(a.mid - colDebit), Math.abs(a.mid - colCredit), Math.abs(a.mid - colBalance)];
        const k = dist.indexOf(Math.min(...dist));
        if (k === 2) balance = a.cr === false ? -a.v : a.v;
        else if (k === 0) debit = a.v;
        else credit = a.v;
      }
    } else {
      const amt = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
      if (amounts.length >= 2) {
        const b = amounts[amounts.length - 1];
        balance = b.cr === false ? -b.v : b.v;
      }
      if (amounts.length >= 3 && amounts[0].v > 0 && amounts[1].v > 0) {
        // Withdrawal and deposit columns both printed (one of them 0.00).
        debit = amounts[0].v; credit = amounts[1].v;
        if (debit && credit) { credit = 0; unsure = true; }
      } else if (amt.cr === true) credit = amt.v;
      else if (amt.cr === false) debit = amt.v;
      else { credit = amt.v; unsure = true; }
    }
    if ((debit > 0) === (credit > 0)) { skipped++; lastRow = null; continue; }
    const desc = text.join(" ");
    const ref = (desc.match(/\b(?:UTR|REF|CHQ)[:\s#-]*([A-Z0-9]{6,})/i)?.[1]) ?? "";
    lastRow = { date, description: desc, ref, debit: round2(debit), credit: round2(credit), balance, unsure };
    rows.push(lastRow);
  }
  // "Opening balance" style lines are not transactions.
  const real = rows.filter((r) => !/^(opening|closing) balance|^balance (b\/f|c\/f|brought|carried)/i.test(r.description.trim()));
  fixDirections(real);
  // The first line has no line before it — the opening balance tells.
  const first = real[0];
  if (first?.unsure && opening != null && first.balance != null) {
    const amt = first.credit || first.debit;
    if (Math.abs(round2(opening + amt) - first.balance) < 0.011) { first.credit = amt; first.debit = 0; first.unsure = false; }
    else if (Math.abs(round2(opening - amt) - first.balance) < 0.011) { first.debit = amt; first.credit = 0; first.unsure = false; }
  }
  return { rows: real, skipped: skipped + (rows.length - real.length) };
}

export async function parseStatementFile(file: File, password?: string): Promise<ParsedStatement> {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return parsePdf(file, password);
  return parseSpreadsheet(file);
}
