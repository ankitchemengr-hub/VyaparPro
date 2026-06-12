import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, pool } from "@workspace/db";
import {
  UpdateAppSettingsBody,
  UpdateNumberSeriesParams,
  UpdateNumberSeriesBody,
  UpdatePrintSettingsBody,
} from "@workspace/api-zod";
import { previewSeriesFromRow, type SeriesType } from "../lib/number-series";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const SERIES_TYPES: SeriesType[] = ["invoice", "order", "quotation"];
const DEFAULT_TEMPLATE_KEY = "default_invoice_template";

// Complete default print configuration. A company with no saved row (or a row
// missing some keys) still resolves to a full, typed PrintSettings object.
const DEFAULT_PRINT_SETTINGS = {
  defaultTemplate: "a5-compact",
  copies: 1,
  copyLabels: true,
  colorMode: "color",
  showLogo: true,
  showQr: true,
  showBankDetails: false,
  showSignature: true,
  showAmountInWords: true,
  showHsn: true,
  showLtrColumn: true,
  showBoxColumn: true,
  showTerms: true,
  fillerRows: true,
  companyName: "",
  addressLine: "",
  contact: "",
  email: "",
  gstin: "",
  footerNote: "",
  terms: [
    "Goods once sold will not be taken back.",
    "Interest @ 24% p.a. on overdue bills.",
    "Subject to Solapur jurisdiction.",
  ],
  bankName: "",
  bankAccount: "",
  bankIfsc: "",
  bankBranch: "",
  upiId: "",
  printerA4: "",
  printerA5: "",
  thermalWidth: "72mm",
} as const;

async function resolvePrintSettings(companyId: number): Promise<Record<string, unknown>> {
  const r = await pool.query(`SELECT config FROM print_settings WHERE company_id = $1`, [companyId]);
  const stored = (r.rows[0]?.config ?? {}) as Record<string, unknown>;
  return { ...DEFAULT_PRINT_SETTINGS, ...stored };
}

async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!current || !current.isActive || current.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

function mapSeries(r: any) {
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
    preview: previewSeriesFromRow(r),
  };
}

const SERIES_DEFAULTS: Record<SeriesType, any> = {
  invoice: { prefix: "INV", include_year: true, include_month: true, year_format: "calendar", separator: "/", padding: 0, start_number: 1, next_number: 1, reset_rule: "monthly", period_key: null },
  order: { prefix: "ORD", include_year: true, include_month: true, year_format: "calendar", separator: "-", padding: 5, start_number: 1, next_number: 1, reset_rule: "monthly", period_key: null },
  quotation: { prefix: "QTN", include_year: true, include_month: true, year_format: "calendar", separator: "/", padding: 4, start_number: 1, next_number: 1, reset_rule: "monthly", period_key: null },
};

// GET /settings — app settings (default invoice template). Available to any logged-in user
// so the frontend can pick the correct print layout.
router.get("/settings", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const companyId = getCompanyId(req);
  const r = await pool.query(`SELECT value FROM app_settings WHERE company_id = $1 AND key = $2`, [companyId, DEFAULT_TEMPLATE_KEY]);
  res.json({ defaultInvoiceTemplate: r.rows[0]?.value ?? null });
});

// PUT /settings — update app settings (admin only).
router.put("/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAppSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);
  if (parsed.data.defaultInvoiceTemplate !== undefined) {
    await pool.query(
      `INSERT INTO app_settings (company_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [companyId, DEFAULT_TEMPLATE_KEY, parsed.data.defaultInvoiceTemplate],
    );
    await pool.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, 'settings_updated', $2, $3, $4, $5)`,
      [
        companyId,
        `Default invoice template set to ${parsed.data.defaultInvoiceTemplate}`,
        session?.userId ?? 1,
        session?.name ?? "Unknown",
        JSON.stringify({ defaultInvoiceTemplate: parsed.data.defaultInvoiceTemplate }),
      ],
    );
  }
  const r = await pool.query(`SELECT value FROM app_settings WHERE company_id = $1 AND key = $2`, [companyId, DEFAULT_TEMPLATE_KEY]);
  res.json({ defaultInvoiceTemplate: r.rows[0]?.value ?? null });
});

// GET /print-settings — per-company invoice print config (merged with defaults).
// Available to any logged-in user so the frontend can render the chosen template.
router.get("/print-settings", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const companyId = getCompanyId(req);
  res.json(await resolvePrintSettings(companyId));
});

// PUT /print-settings — update per-company print config (admin only).
router.put("/print-settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdatePrintSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);

  // Merge the incoming partial over whatever is already stored, then persist the
  // full config object so future default changes never clobber saved values.
  const current = await pool.query(`SELECT config FROM print_settings WHERE company_id = $1`, [companyId]);
  const merged = {
    ...DEFAULT_PRINT_SETTINGS,
    ...((current.rows[0]?.config ?? {}) as Record<string, unknown>),
    ...parsed.data,
  };

  await pool.query(
    `INSERT INTO print_settings (company_id, config) VALUES ($1, $2)
     ON CONFLICT (company_id) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()`,
    [companyId, JSON.stringify(merged)],
  );
  await pool.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
     VALUES ($1, 'print_settings_updated', $2, $3, $4, $5)`,
    [
      companyId,
      "Invoice print settings updated",
      session?.userId ?? 1,
      session?.name ?? "Unknown",
      JSON.stringify(parsed.data),
    ],
  );

  res.json(merged);
});

// GET /number-series — list all configured document series (admin only).
router.get("/number-series", requireAdmin, async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const r = await pool.query(`SELECT * FROM number_series WHERE company_id = $1`, [companyId]);
  const byType = new Map<string, any>(r.rows.map((row) => [row.series_type, row]));
  // Surface a row for every known series type, even if not yet persisted.
  const out = SERIES_TYPES.map((t) => mapSeries(byType.get(t) ?? { series_type: t, ...SERIES_DEFAULTS[t] }));
  res.json(out);
});

// PUT /number-series/:seriesType — update a series config (admin only).
router.put("/number-series/:seriesType", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateNumberSeriesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid series type" });
    return;
  }
  const body = UpdateNumberSeriesBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid input", details: body.error.issues });
    return;
  }
  const seriesType = params.data.seriesType as SeriesType;
  const d = SERIES_DEFAULTS[seriesType];
  const b = body.data;
  const session = (req as any).session;
  const companyId = getCompanyId(req);

  // Upsert the full row, falling back to defaults for any unspecified field.
  await pool.query(
    `INSERT INTO number_series
       (company_id, series_type, prefix, include_year, include_month, year_format, separator, padding, start_number, next_number, reset_rule)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (company_id, series_type) DO UPDATE SET
       prefix = EXCLUDED.prefix,
       include_year = EXCLUDED.include_year,
       include_month = EXCLUDED.include_month,
       year_format = EXCLUDED.year_format,
       separator = EXCLUDED.separator,
       padding = EXCLUDED.padding,
       start_number = EXCLUDED.start_number,
       next_number = EXCLUDED.next_number,
       reset_rule = EXCLUDED.reset_rule,
       updated_at = NOW()`,
    [
      companyId,
      seriesType,
      b.prefix ?? d.prefix,
      b.includeYear ?? d.include_year,
      b.includeMonth ?? d.include_month,
      b.yearFormat ?? d.year_format,
      b.separator ?? d.separator,
      b.padding ?? d.padding,
      b.startNumber ?? d.start_number,
      b.nextNumber ?? d.next_number,
      b.resetRule ?? d.reset_rule,
    ],
  );

  await pool.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
     VALUES ($1, 'number_series_updated', $2, $3, $4, $5)`,
    [
      companyId,
      `Number series '${seriesType}' updated`,
      session?.userId ?? 1,
      session?.name ?? "Unknown",
      JSON.stringify(b),
    ],
  );

  const r = await pool.query(`SELECT * FROM number_series WHERE company_id = $1 AND series_type = $2`, [companyId, seriesType]);
  res.json(mapSeries(r.rows[0]));
});

export default router;
