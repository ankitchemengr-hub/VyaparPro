// Configurable document-number generation (invoice / order / quotation).
//
// A series is assembled from enabled tokens joined by `separator`:
//   [prefix] [year] [month] [paddedSeq]
// The sequence resets according to `resetRule` (never/daily/monthly/yearly/fiscal).
//
// `generateSeriesNumber` MUST be called with a pg client that is already inside a
// transaction — it does SELECT ... FOR UPDATE on the series row so concurrent
// callers cannot hand out duplicate numbers.

export type SeriesType = "invoice" | "order" | "quotation";

interface SeriesRow {
  seriesType: SeriesType;
  prefix: string;
  includeYear: boolean;
  includeMonth: boolean;
  yearFormat: string; // calendar | fiscal
  separator: string;
  padding: number;
  startNumber: number;
  nextNumber: number;
  resetRule: string; // never | daily | monthly | yearly | fiscal
  periodKey: string | null;
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
  };
}

// Indian fiscal year runs Apr 1 -> Mar 31, labelled "2024-25".
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
    case "daily":
      return `${y}${m}${day}`;
    case "monthly":
      return `${y}${m}`;
    case "yearly":
      return `${y}`;
    case "fiscal":
      return fiscalYearLabel(d);
    default:
      return "ALL";
  }
}

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

const DEFAULTS: Record<SeriesType, Omit<SeriesRow, "seriesType" | "nextNumber" | "periodKey">> = {
  invoice: { prefix: "INV", includeYear: true, includeMonth: true, yearFormat: "calendar", separator: "/", padding: 0, startNumber: 1, resetRule: "monthly" },
  order: { prefix: "ORD", includeYear: true, includeMonth: true, yearFormat: "calendar", separator: "-", padding: 5, startNumber: 1, resetRule: "monthly" },
  quotation: { prefix: "QTN", includeYear: true, includeMonth: true, yearFormat: "calendar", separator: "/", padding: 4, startNumber: 1, resetRule: "monthly" },
};

// Lazily create a sensible default config row the first time a series is used.
// For invoices we seed nextNumber from the legacy invoice_sequence table so the
// running counter is preserved (avoids duplicate invoice_no on cutover).
async function ensureDefaultSeries(client: any, seriesType: SeriesType, companyId: number): Promise<void> {
  const now = new Date();
  const d = DEFAULTS[seriesType];
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
       (company_id, series_type, prefix, include_year, include_month, year_format, separator, padding, start_number, next_number, reset_rule, period_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (company_id, series_type) DO NOTHING`,
    [companyId, seriesType, d.prefix, d.includeYear, d.includeMonth, d.yearFormat, d.separator, d.padding, d.startNumber, nextNumber, d.resetRule, periodKey],
  );
}

export async function generateSeriesNumber(client: any, seriesType: SeriesType, companyId: number): Promise<string> {
  const now = new Date();

  let res = await client.query(`SELECT * FROM number_series WHERE series_type = $1 AND company_id = $2 FOR UPDATE`, [seriesType, companyId]);
  if (res.rows.length === 0) {
    await ensureDefaultSeries(client, seriesType, companyId);
    res = await client.query(`SELECT * FROM number_series WHERE series_type = $1 AND company_id = $2 FOR UPDATE`, [seriesType, companyId]);
  }

  const row = mapRow(res.rows[0]);
  const periodKey = computePeriodKey(row.resetRule, now);
  const seq = row.periodKey !== periodKey ? row.startNumber : row.nextNumber;

  await client.query(
    `UPDATE number_series SET next_number = $1, period_key = $2 WHERE series_type = $3 AND company_id = $4`,
    [seq + 1, periodKey, seriesType, companyId],
  );

  return buildNumber(row, seq, now);
}

// Preview what the next number for a series would look like, without consuming it.
export function previewNumber(row: SeriesRow, d: Date = new Date()): string {
  const periodKey = computePeriodKey(row.resetRule, d);
  const seq = row.periodKey !== periodKey ? row.startNumber : row.nextNumber;
  return buildNumber(row, seq, d);
}

// Same as previewNumber but accepts a raw DB row (snake_case) — convenient for routes.
export function previewSeriesFromRow(r: any, d: Date = new Date()): string {
  return previewNumber(mapRow(r), d);
}
