import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, pool } from "@workspace/db";
import {
  UpdateAppSettingsBody,
  UpdateNumberSeriesParams,
  UpdateNumberSeriesBody,
  UpdatePrintSettingsBody,
} from "@workspace/api-zod";
import { buildFromFormatString, computePeriodKey, type SeriesType, SERIES_TYPE_DEFAULTS } from "../lib/number-series";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const ALL_SERIES_TYPES: SeriesType[] = [
  "invoice", "gst_invoice", "bill_of_supply", "proforma_invoice",
  "quotation", "sale_return", "delivery_challan", "payment_receipt",
  "sale_order", "purchase_order", "purchase_invoice", "purchase_return",
  "order",
];

const DEFAULT_TEMPLATE_KEY = "default_invoice_template";

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
  const d = SERIES_TYPE_DEFAULTS[r.series_type as SeriesType] ?? SERIES_TYPE_DEFAULTS.invoice;
  const fmtStr: string = r.format_string ?? d.formatString;
  const nextNum = Number(r.next_number ?? 1);
  const padding = Number(r.padding ?? d.padding);
  return {
    seriesType: r.series_type,
    prefix: r.prefix ?? d.prefix,
    includeYear: r.include_year ?? d.includeYear,
    includeMonth: r.include_month ?? d.includeMonth,
    yearFormat: r.year_format ?? d.yearFormat,
    separator: r.separator ?? d.separator,
    padding,
    startNumber: Number(r.start_number ?? d.startNumber),
    nextNumber: nextNum,
    resetRule: r.reset_rule ?? d.resetRule,
    periodKey: r.period_key ?? null,
    formatString: fmtStr,
    preview: buildFromFormatString(fmtStr, nextNum, new Date(), padding),
  };
}

// GET /settings — app settings (default invoice template).
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

// GET /print-settings
router.get("/print-settings", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const companyId = getCompanyId(req);
  res.json(await resolvePrintSettings(companyId));
});

// PUT /print-settings
router.put("/print-settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdatePrintSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);

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

  const out = ALL_SERIES_TYPES.map((t) => {
    const d = SERIES_TYPE_DEFAULTS[t];
    const existing = byType.get(t);
    if (existing) return mapSeries(existing);
    return mapSeries({
      series_type: t,
      prefix: d.prefix,
      include_year: d.includeYear,
      include_month: d.includeMonth,
      year_format: d.yearFormat,
      separator: d.separator,
      padding: d.padding,
      start_number: d.startNumber,
      next_number: d.startNumber,
      reset_rule: d.resetRule,
      period_key: null,
      format_string: d.formatString,
    });
  });
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
  const d = SERIES_TYPE_DEFAULTS[seriesType];
  const b = body.data;
  const session = (req as any).session;
  const companyId = getCompanyId(req);

  // Compute the current period key so the saved nextNumber takes effect immediately
  // (rather than being overridden by a reset when the series is first used).
  const resetRule = b.resetRule ?? d.resetRule;
  const periodKey = computePeriodKey(resetRule, new Date());

  await pool.query(
    `INSERT INTO number_series
       (company_id, series_type, prefix, include_year, include_month, year_format, separator, padding,
        start_number, next_number, reset_rule, format_string, period_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
       format_string = EXCLUDED.format_string,
       period_key = EXCLUDED.period_key,
       updated_at = NOW()`,
    [
      companyId,
      seriesType,
      b.prefix ?? d.prefix,
      b.includeYear ?? d.includeYear,
      b.includeMonth ?? d.includeMonth,
      b.yearFormat ?? d.yearFormat,
      b.separator ?? d.separator,
      b.padding ?? d.padding,
      b.startNumber ?? d.startNumber,
      b.nextNumber ?? d.startNumber,
      resetRule,
      b.formatString ?? d.formatString,
      periodKey,
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

  const r = await pool.query(
    `SELECT * FROM number_series WHERE company_id = $1 AND series_type = $2`,
    [companyId, seriesType],
  );
  res.json(mapSeries(r.rows[0]));
});

// GET /role-permissions
router.get("/role-permissions", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const companyId = getCompanyId(req);
  const r = await pool.query(`SELECT role, feature, allowed FROM role_permissions WHERE company_id = $1`, [companyId]);
  res.json(r.rows.map((row: any) => ({ role: row.role, feature: row.feature, allowed: row.allowed })));
});

// PUT /role-permissions
router.put("/role-permissions", requireAdmin, async (req, res): Promise<void> => {
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) { res.status(400).json({ error: "permissions must be an array" }); return; }
  const companyId = getCompanyId(req);
  for (const p of permissions) {
    await pool.query(
      `INSERT INTO role_permissions (company_id, role, feature, allowed)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, role, feature) DO UPDATE SET allowed = EXCLUDED.allowed`,
      [companyId, p.role, p.feature, p.allowed],
    );
  }
  const r = await pool.query(`SELECT role, feature, allowed FROM role_permissions WHERE company_id = $1`, [companyId]);
  res.json(r.rows.map((row: any) => ({ role: row.role, feature: row.feature, allowed: row.allowed })));
});

export default router;
