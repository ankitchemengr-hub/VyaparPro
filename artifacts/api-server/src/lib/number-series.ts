// Configurable document-number generation.
//
// Two modes:
//   1. Format-string mode: a template like "REC/MM/SEQ" with token substitution.
//      Tokens: SEQ, YY, YYYY, MM, MMM, FY.
//   2. Structured mode (legacy): prefix + year + month + paddedSeq joined by separator.
//
// generateSeriesNumber MUST be called with a pg client already inside a transaction —
// it does SELECT ... FOR UPDATE so concurrent callers cannot hand out duplicate numbers.

export type SeriesType =
  | "invoice" | "order" | "quotation"
  | "gst_invoice" | "bill_of_supply" | "proforma_invoice"
  | "sale_return" | "delivery_challan" | "payment_receipt"
  | "sale_order" | "purchase_order" | "purchase_invoice" | "purchase_return";

interface SeriesRow {
  seriesType: SeriesType;
  prefix: string;
  includeYear: boolean;
  includeMonth: boolean;
  yearFormat: string;
  separator: string;
  padding: number;
  startNumber: number;
  nextNumber: number;
  resetRule: string;
  periodKey: string | null;
  formatString: string | null;
}

function mapRow(r: any): SeriesRow {
  return {
    seriesType: r.series_type,
    prefix: r.prefix ?? "",
    includeYear: r.include_year ?? true,
    includeMonth: r.include_month ?? true,
    yearFormat: r.year_format ?? "calendar",
    separator: r.separator ?? "/",
    padding: Number(r.padding ?? 0),
    startNumber: Number(r.start_number ?? 1),
    nextNumber: Number(r.next_number ?? 1),
    resetRule: r.reset_rule ?? "monthly",
    periodKey: r.period_key ?? null,
    formatString: r.format_string ?? null,
  };
}

export function fiscalYearLabel(d: Date): string {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

export function computePeriodKey(resetRule: string, d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  switch (resetRule) {
    case "daily":   return `${y}${m}${day}`;
    case "monthly": return `${y}${m}`;
    case "yearly":  return `${y}`;
    case "fiscal":  return fiscalYearLabel(d);
    default:        return "ALL";
  }
}

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// Build a number from a format-string template like "REC/MM/SEQ" or "INV/YYYY/MM/SEQ".
// Tokens (in substitution order to avoid partial matches):
//   YYYY → 4-digit year   YY → 2-digit year
//   MMM  → month abbrev   MM → 2-digit month
//   FY   → fiscal year label (e.g. 26-27)
//   SEQ  → sequence number (optionally zero-padded by `padding`)
export function buildFromFormatString(
  formatStr: string,
  seq: number,
  d: Date,
  padding = 0,
): string {
  const y4  = String(d.getFullYear());
  const y2  = y4.slice(-2);
  const mm  = String(d.getMonth() + 1).padStart(2, "0");
  const mmm = MONTH_ABBR[d.getMonth()];
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const fy  = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  const seqStr = padding > 0 ? String(seq).padStart(padding, "0") : String(seq);

  return formatStr
    .replace(/YYYY/g, y4)
    .replace(/YY/g,   y2)
    .replace(/MMM/g,  mmm)
    .replace(/MM/g,   mm)
    .replace(/FY/g,   fy)
    .replace(/SEQ/g,  seqStr);
}

// Build using the legacy structured approach.
function buildNumber(row: SeriesRow, seq: number, d: Date): string {
  const parts: string[] = [];
  if (row.prefix) parts.push(row.prefix);
  if (row.includeYear) {
    parts.push(row.yearFormat === "fiscal" ? fiscalYearLabel(d) : String(d.getFullYear()));
  }
  if (row.includeMonth) parts.push(String(d.getMonth() + 1).padStart(2, "0"));
  const seqStr = row.padding > 0 ? String(seq).padStart(row.padding, "0") : String(seq);
  parts.push(seqStr);
  return parts.join(row.separator || "/");
}

// Format-string defaults for every known series type.
// Existing types (invoice/order/quotation) carry a format_string as well so the
// settings UI can display and edit them uniformly.
interface TypeDefault {
  formatString: string;
  resetRule: string;
  // Legacy structured fields (kept for backward-compat / initial row creation)
  prefix: string;
  includeYear: boolean;
  includeMonth: boolean;
  yearFormat: string;
  separator: string;
  padding: number;
  startNumber: number;
}

export const SERIES_TYPE_DEFAULTS: Record<SeriesType, TypeDefault> = {
  invoice:          { formatString: "INV/YYYY/MM/SEQ", resetRule: "monthly",  prefix: "INV", includeYear: true,  includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
  order:            { formatString: "ORD/YYYY/MM/SEQ", resetRule: "monthly",  prefix: "ORD", includeYear: true,  includeMonth: true,  yearFormat: "calendar", separator: "-", padding: 5, startNumber: 1 },
  quotation:        { formatString: "QTN/YYYY/MM/SEQ", resetRule: "monthly",  prefix: "QTN", includeYear: true,  includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 4, startNumber: 1 },
  gst_invoice:      { formatString: "GST/MM/SEQ",      resetRule: "monthly",  prefix: "GST", includeYear: false, includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
  bill_of_supply:   { formatString: "BILL-SEQ",         resetRule: "never",    prefix: "BILL",includeYear: false, includeMonth: false, yearFormat: "calendar", separator: "-", padding: 3, startNumber: 1 },
  proforma_invoice: { formatString: "PRO-SEQ",          resetRule: "never",    prefix: "PRO", includeYear: false, includeMonth: false, yearFormat: "calendar", separator: "-", padding: 0, startNumber: 1 },
  sale_return:      { formatString: "CR/MM/SEQ",        resetRule: "monthly",  prefix: "CR",  includeYear: false, includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
  delivery_challan: { formatString: "DEL-SEQ",          resetRule: "never",    prefix: "DEL", includeYear: false, includeMonth: false, yearFormat: "calendar", separator: "-", padding: 3, startNumber: 1 },
  payment_receipt:  { formatString: "REC/MM/SEQ",       resetRule: "monthly",  prefix: "REC", includeYear: false, includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
  sale_order:       { formatString: "SO-SEQ",           resetRule: "never",    prefix: "SO",  includeYear: false, includeMonth: false, yearFormat: "calendar", separator: "-", padding: 3, startNumber: 1 },
  purchase_order:   { formatString: "PO/MM/SEQ",        resetRule: "monthly",  prefix: "PO",  includeYear: false, includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
  purchase_invoice: { formatString: "PINV/MM/SEQ",      resetRule: "monthly",  prefix: "PINV",includeYear: false, includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
  purchase_return:  { formatString: "PR/MM/SEQ",        resetRule: "monthly",  prefix: "PR",  includeYear: false, includeMonth: true,  yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1 },
};

async function ensureDefaultSeries(client: any, seriesType: SeriesType, companyId: number): Promise<void> {
  const now = new Date();
  const d = SERIES_TYPE_DEFAULTS[seriesType];
  let nextNumber = d.startNumber;
  let periodKey = computePeriodKey(d.resetRule, now);

  if (seriesType === "invoice") {
    const r = await client.query(
      `SELECT last_number FROM invoice_sequence WHERE month = $1 AND year = $2 AND company_id = $3`,
      [now.getMonth() + 1, now.getFullYear(), companyId],
    );
    const last = Number(r.rows[0]?.last_number ?? 0);
    nextNumber = last + 1;
    periodKey = computePeriodKey("monthly", now);
  }

  await client.query(
    `INSERT INTO number_series
       (company_id, series_type, prefix, include_year, include_month, year_format, separator,
        padding, start_number, next_number, reset_rule, period_key, format_string)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (company_id, series_type) DO NOTHING`,
    [
      companyId, seriesType,
      d.prefix, d.includeYear, d.includeMonth, d.yearFormat, d.separator,
      d.padding, d.startNumber, nextNumber, d.resetRule, periodKey, d.formatString,
    ],
  );
}

export async function generateSeriesNumber(
  client: any,
  seriesType: SeriesType,
  companyId: number,
): Promise<string> {
  const now = new Date();

  let res = await client.query(
    `SELECT * FROM number_series WHERE series_type = $1 AND company_id = $2 FOR UPDATE`,
    [seriesType, companyId],
  );
  if (res.rows.length === 0) {
    await ensureDefaultSeries(client, seriesType, companyId);
    res = await client.query(
      `SELECT * FROM number_series WHERE series_type = $1 AND company_id = $2 FOR UPDATE`,
      [seriesType, companyId],
    );
  }

  const row = mapRow(res.rows[0]);
  const periodKey = computePeriodKey(row.resetRule, now);
  const seq = row.periodKey !== periodKey ? row.startNumber : row.nextNumber;

  await client.query(
    `UPDATE number_series SET next_number = $1, period_key = $2 WHERE series_type = $3 AND company_id = $4`,
    [seq + 1, periodKey, seriesType, companyId],
  );

  if (row.formatString) {
    return buildFromFormatString(row.formatString, seq, now, row.padding);
  }
  return buildNumber(row, seq, now);
}

export function previewNumber(row: SeriesRow, d: Date = new Date()): string {
  const periodKey = computePeriodKey(row.resetRule, d);
  const seq = row.periodKey !== periodKey ? row.startNumber : row.nextNumber;
  if (row.formatString) {
    return buildFromFormatString(row.formatString, seq, d, row.padding);
  }
  return buildNumber(row, seq, d);
}

export function previewSeriesFromRow(r: any, d: Date = new Date()): string {
  return previewNumber(mapRow(r), d);
}
