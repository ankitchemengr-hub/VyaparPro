import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { roleAllowed } from "../lib/role-guard";
import { logger } from "../lib/logger";
import {
  ruleFor, ruleFromRow,
  COMMISSION_METHODS, COMMISSION_BASES, DA_MODES, TA_MODES, ACTIVITY_BASES,
  type CommissionRule,
} from "../lib/commission";

// Commission → Settings (how each salesman earns commission and TA/DA),
// Commission → TA / DA (travel claims, the period statement and payments).
// Rules live in lib/commission.ts.

const router: IRouter = Router();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const role = (req: Request) => (req as any).session?.role as string | undefined;
const isStaff = (req: Request) => roleAllowed(role(req), ["admin", "accountant"]);
const isAdmin = (req: Request) => roleAllowed(role(req), ["admin"]);
const ownSalesmanId = (req: Request): number | null => {
  if (role(req) !== "salesman") return null;
  const id = Number((req as any).session?.entityId);
  return Number.isInteger(id) && id > 0 ? id : null;
};
function deny(res: Response, msg = "You don't have access to this.") {
  res.status(403).json({ error: msg });
}

// ── Settings ───────────────────────────────────────────────────────────────

router.get("/commissions/settings", async (req, res): Promise<void> => {
  if (!isStaff(req)) return deny(res);
  const companyId = getCompanyId(req);
  const [{ rows: settings }, { rows: salesmen }] = await Promise.all([
    pool.query(`SELECT * FROM commission_settings WHERE company_id = $1`, [companyId]),
    pool.query(`SELECT id, name FROM entities WHERE company_id = $1 AND type = 'salesman' ORDER BY name`, [companyId]),
  ]);
  const byId = new Map(settings.map((r) => [Number(r.salesman_id), r]));
  res.json({
    default: ruleFromRow(byId.get(0), 0, true),
    salesmen: salesmen.map((s) => ({
      id: s.id,
      name: s.name,
      rule: byId.has(Number(s.id)) ? ruleFromRow(byId.get(Number(s.id)), Number(s.id), false) : null,
    })),
  });
});

function parseRule(body: any): Omit<CommissionRule, "salesmanId" | "isDefault"> | string {
  const num = (v: unknown, name: string) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n >= 0 && n <= 1e7 ? n : `${name} must be 0 or more`;
  };
  if (!COMMISSION_METHODS.includes(body?.method)) return "Choose how commission is worked out";
  if (!COMMISSION_BASES.includes(body?.base ?? "without_gst")) return "Choose before or with GST";
  if (!DA_MODES.includes(body?.daMode ?? "none")) return "Choose how DA is paid";
  if (!TA_MODES.includes(body?.taMode ?? "none")) return "Choose how TA is paid";
  if (!ACTIVITY_BASES.includes(body?.daBasis ?? "invoices")) return "Choose what counts as a working day / order";
  const rate = num(body.rate, "Rate");
  const daAmount = num(body.daAmount, "DA amount");
  const taRate = num(body.taRate, "TA rate");
  for (const v of [rate, daAmount, taRate]) if (typeof v === "string") return v;
  if ((body.method === "invoice_percent") && (rate as number) > 100) return "Percent can't be more than 100";
  return {
    method: body.method, rate: rate as number, base: body.base ?? "without_gst",
    daMode: body.daMode ?? "none", daAmount: daAmount as number, daBasis: body.daBasis ?? "invoices",
    taMode: body.taMode ?? "none", taRate: taRate as number,
  };
}

// PUT /commissions/settings/:salesmanId — 0 = company default. Applies to bills
// from now on; commission already booked stays as it is.
router.put("/commissions/settings/:salesmanId", async (req, res): Promise<void> => {
  if (!isAdmin(req)) return deny(res, "Only an admin can change commission settings");
  const companyId = getCompanyId(req);
  const salesmanId = Number(req.params.salesmanId);
  if (!Number.isInteger(salesmanId) || salesmanId < 0) {
    res.status(400).json({ error: "Invalid salesman" });
    return;
  }
  if (salesmanId > 0) {
    const { rows } = await pool.query(`SELECT 1 FROM entities WHERE id = $1 AND company_id = $2 AND type = 'salesman'`, [salesmanId, companyId]);
    if (!rows[0]) {
      res.status(404).json({ error: "Salesman not found" });
      return;
    }
  }
  const rule = parseRule(req.body);
  if (typeof rule === "string") {
    res.status(400).json({ error: rule });
    return;
  }
  await pool.query(
    `INSERT INTO commission_settings (company_id, salesman_id, method, rate, base, da_mode, da_amount, da_basis, ta_mode, ta_rate, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (company_id, salesman_id) DO UPDATE SET
       method = EXCLUDED.method, rate = EXCLUDED.rate, base = EXCLUDED.base, da_mode = EXCLUDED.da_mode,
       da_amount = EXCLUDED.da_amount, da_basis = EXCLUDED.da_basis, ta_mode = EXCLUDED.ta_mode,
       ta_rate = EXCLUDED.ta_rate, updated_at = NOW()`,
    [companyId, salesmanId, rule.method, rule.rate, rule.base, rule.daMode, rule.daAmount, rule.daBasis, rule.taMode, rule.taRate],
  );
  res.json(await ruleFor(pool as any, companyId, salesmanId));
});

// DELETE /commissions/settings/:salesmanId — that salesman goes back to the default.
router.delete("/commissions/settings/:salesmanId", async (req, res): Promise<void> => {
  if (!isAdmin(req)) return deny(res, "Only an admin can change commission settings");
  const companyId = getCompanyId(req);
  const salesmanId = Number(req.params.salesmanId);
  if (!Number.isInteger(salesmanId) || salesmanId <= 0) {
    res.status(400).json({ error: "Invalid salesman" });
    return;
  }
  await pool.query(`DELETE FROM commission_settings WHERE company_id = $1 AND salesman_id = $2`, [companyId, salesmanId]);
  res.json(await ruleFor(pool as any, companyId, salesmanId));
});

// Product % (for the "each product's own %" method) and the per-liter rate.
router.get("/commissions/product-rates", async (req, res): Promise<void> => {
  if (!isStaff(req)) return deny(res);
  const companyId = getCompanyId(req);
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.item_code, p.commission_per_liter, COALESCE(r.percent, 0) AS percent
       FROM products p
       LEFT JOIN product_commission_rates r ON r.company_id = p.company_id AND r.product_id = p.id
      WHERE p.company_id = $1 AND COALESCE(p.not_for_sale, false) = false
      ORDER BY p.name`,
    [companyId],
  );
  res.json(rows.map((r) => ({
    productId: r.id, name: r.name, itemCode: r.item_code ?? null,
    perLiter: Number(r.commission_per_liter ?? 0), percent: Number(r.percent),
  })));
});

// PUT /commissions/product-rates { rates: [{ productId, percent?, perLiter? }] }
router.put("/commissions/product-rates", async (req, res): Promise<void> => {
  if (!isAdmin(req)) return deny(res, "Only an admin can change commission settings");
  const companyId = getCompanyId(req);
  const rates = Array.isArray(req.body?.rates) ? req.body.rates : null;
  if (!rates || rates.length === 0 || rates.length > 5000) {
    res.status(400).json({ error: "Send the rates to save" });
    return;
  }
  for (const r of rates) {
    const pct = r.percent == null ? null : Number(r.percent);
    const pl = r.perLiter == null ? null : Number(r.perLiter);
    if (!Number.isInteger(Number(r.productId)) || (pct != null && !(pct >= 0 && pct <= 100)) || (pl != null && !(pl >= 0))) {
      res.status(400).json({ error: "Percent must be 0–100 and per-liter 0 or more" });
      return;
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of rates) {
      const pid = Number(r.productId);
      const { rows } = await client.query(`SELECT 1 FROM products WHERE id = $1 AND company_id = $2`, [pid, companyId]);
      if (!rows[0]) continue;
      if (r.percent != null) {
        await client.query(
          `INSERT INTO product_commission_rates (company_id, product_id, percent) VALUES ($1, $2, $3)
           ON CONFLICT (company_id, product_id) DO UPDATE SET percent = EXCLUDED.percent`,
          [companyId, pid, Number(r.percent)],
        );
      }
      if (r.perLiter != null) {
        await client.query(`UPDATE products SET commission_per_liter = $1 WHERE id = $2 AND company_id = $3`, [Number(r.perLiter), pid, companyId]);
      }
    }
    await client.query("COMMIT");
    res.json({ saved: rates.length });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Saving product commission rates failed");
    res.status(500).json({ error: "Could not save — nothing was changed" });
  } finally {
    client.release();
  }
});

// ── Travel (TA) claims ─────────────────────────────────────────────────────

router.get("/commissions/travel-claims", async (req, res): Promise<void> => {
  const own = ownSalesmanId(req);
  if (!isStaff(req) && !own) return deny(res);
  const companyId = getCompanyId(req);
  const params: unknown[] = [companyId];
  let where = "c.company_id = $1";
  const sid = own ?? (Number(req.query.salesmanId) || null);
  if (sid) { params.push(sid); where += ` AND c.salesman_id = $${params.length}`; }
  for (const [k, op] of [["from", ">="], ["to", "<="]] as const) {
    const v = String(req.query[k] ?? "");
    if (v && DATE_RE.test(v)) { params.push(v); where += ` AND c.claim_date ${op} $${params.length}`; }
  }
  const { rows } = await pool.query(
    `SELECT c.*, c.claim_date::text AS day, e.name AS salesman_name FROM salesman_travel_claims c
       LEFT JOIN entities e ON e.id = c.salesman_id AND e.company_id = c.company_id
      WHERE ${where} ORDER BY c.claim_date DESC, c.id DESC LIMIT 1000`,
    params,
  );
  res.json(rows.map((r) => ({
    id: r.id, salesmanId: r.salesman_id, salesmanName: r.salesman_name ?? "",
    date: r.day,
    km: Number(r.km), amount: Number(r.amount), note: r.note ?? null,
  })));
});

router.post("/commissions/travel-claims", async (req, res): Promise<void> => {
  const own = ownSalesmanId(req);
  if (!isStaff(req) && !own) return deny(res);
  const companyId = getCompanyId(req);
  const salesmanId = own ?? Number(req.body?.salesmanId);
  const date = String(req.body?.date ?? "");
  const km = Number(req.body?.km ?? 0);
  const amount = Number(req.body?.amount ?? 0);
  if (!Number.isInteger(salesmanId) || salesmanId <= 0) {
    res.status(400).json({ error: "Choose the salesman" });
    return;
  }
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: "Enter the date" });
    return;
  }
  if (!(km >= 0) || !(amount >= 0) || (km === 0 && amount === 0)) {
    res.status(400).json({ error: "Enter km travelled or the amount spent" });
    return;
  }
  const { rows: sm } = await pool.query(`SELECT 1 FROM entities WHERE id = $1 AND company_id = $2 AND type = 'salesman'`, [salesmanId, companyId]);
  if (!sm[0]) {
    res.status(404).json({ error: "Salesman not found" });
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO salesman_travel_claims (company_id, salesman_id, claim_date, km, amount, note, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [companyId, salesmanId, date, km, amount, String(req.body?.note ?? "").slice(0, 300) || null, (req as any).session?.userId ?? null],
  );
  res.status(201).json({ id: rows[0].id });
});

router.delete("/commissions/travel-claims/:id", async (req, res): Promise<void> => {
  const own = ownSalesmanId(req);
  if (!isStaff(req) && !own) return deny(res);
  const companyId = getCompanyId(req);
  const params: unknown[] = [Number(req.params.id), companyId];
  let extra = "";
  if (own) { params.push(own); extra = " AND salesman_id = $3"; }
  const { rowCount } = await pool.query(`DELETE FROM salesman_travel_claims WHERE id = $1 AND company_id = $2${extra}`, params);
  if (!rowCount) {
    res.status(404).json({ error: "Claim not found" });
    return;
  }
  res.sendStatus(204);
});

// ── TA / DA statement for a period ─────────────────────────────────────────

function monthsInRange(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
}

// GET /commissions/allowances?from&to[&salesmanId]
router.get("/commissions/allowances", async (req, res): Promise<void> => {
  const own = ownSalesmanId(req);
  if (!isStaff(req) && !own) return deny(res);
  const companyId = getCompanyId(req);
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    res.status(400).json({ error: "Choose a valid From and To date" });
    return;
  }
  const only = own ?? (Number(req.query.salesmanId) || null);
  const { rows: salesmen } = await pool.query(
    `SELECT id, name FROM entities WHERE company_id = $1 AND type = 'salesman' ${only ? "AND id = $2" : ""} ORDER BY name`,
    only ? [companyId, only] : [companyId],
  );
  const ist = (col: string) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
  const [{ rows: bills }, { rows: orders }, { rows: claims }, { rows: paid }] = await Promise.all([
    pool.query(
      `SELECT salesman_id AS sid, ${ist("invoice_date")}::text AS day, COUNT(*) AS n FROM invoices
        WHERE company_id = $1 AND salesman_id IS NOT NULL AND status <> 'cancelled' AND invoice_type <> 'quotation'
          AND ${ist("invoice_date")} BETWEEN $2 AND $3
        GROUP BY 1, 2`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT u.entity_id AS sid, ${ist("o.created_at")}::text AS day, COUNT(*) AS n FROM customer_orders o
         JOIN users u ON u.id = o.user_id AND u.role = 'salesman'
        WHERE o.company_id = $1 AND o.is_draft = false AND o.status <> 'cancelled' AND u.entity_id IS NOT NULL
          AND ${ist("o.created_at")} BETWEEN $2 AND $3
        GROUP BY 1, 2`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT salesman_id AS sid, COALESCE(SUM(km), 0) AS km, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS n
         FROM salesman_travel_claims WHERE company_id = $1 AND claim_date BETWEEN $2 AND $3 GROUP BY 1`,
      [companyId, from, to],
    ),
    pool.query(
      `SELECT salesman_id AS sid, COALESCE(SUM(ta_amount + da_amount), 0) AS paid FROM allowance_payments
        WHERE company_id = $1 AND period_from >= $2 AND period_to <= $3 GROUP BY 1`,
      [companyId, from, to],
    ),
  ]);
  const group = (rows: any[]) => {
    const m = new Map<number, Map<string, number>>();
    for (const r of rows) {
      const sid = Number(r.sid);
      if (!m.has(sid)) m.set(sid, new Map());
      m.get(sid)!.set(r.day, Number(r.n));
    }
    return m;
  };
  const billDays = group(bills);
  const orderDays = group(orders);
  const claimBy = new Map(claims.map((c) => [Number(c.sid), c]));
  const paidBy = new Map(paid.map((p) => [Number(p.sid), Number(p.paid)]));
  const months = monthsInRange(from, to);

  const out = [];
  for (const s of salesmen) {
    const sid = Number(s.id);
    const rule = await ruleFor(pool as any, companyId, sid);
    const b = billDays.get(sid) ?? new Map();
    const o = orderDays.get(sid) ?? new Map();
    const billCount = [...b.values()].reduce((x, y) => x + y, 0);
    const orderCount = [...o.values()].reduce((x, y) => x + y, 0);
    const days = new Set<string>([
      ...(rule.daBasis !== "orders" ? b.keys() : []),
      ...(rule.daBasis !== "invoices" ? o.keys() : []),
    ]);
    const activityCount = (rule.daBasis !== "orders" ? billCount : 0) + (rule.daBasis !== "invoices" ? orderCount : 0);
    const c = claimBy.get(sid);
    const km = Number(c?.km ?? 0);
    const claimAmount = Number(c?.amount ?? 0);

    const da = rule.daMode === "per_day" ? days.size * rule.daAmount
      : rule.daMode === "per_order" ? activityCount * rule.daAmount
      : rule.daMode === "monthly" ? months * rule.daAmount : 0;
    const ta = rule.taMode === "per_km" ? km * rule.taRate
      : rule.taMode === "per_day" ? days.size * rule.taRate
      : rule.taMode === "actual" ? claimAmount : 0;
    const total = Math.round((ta + da) * 100) / 100;
    const alreadyPaid = paidBy.get(sid) ?? 0;
    out.push({
      salesmanId: sid, salesmanName: s.name, rule,
      workingDays: days.size, bills: billCount, orders: orderCount, months,
      km, claimAmount, claims: Number(c?.n ?? 0),
      ta: Math.round(ta * 100) / 100, da: Math.round(da * 100) / 100, total,
      paid: alreadyPaid, due: Math.round((total - alreadyPaid) * 100) / 100,
    });
  }
  res.json({ from, to, rows: out });
});

// POST /commissions/allowances/pay { salesmanId, from, to, ta, da, reference?, note? }
router.post("/commissions/allowances/pay", async (req, res): Promise<void> => {
  if (!isStaff(req)) return deny(res);
  const companyId = getCompanyId(req);
  const { salesmanId, from, to, reference, note } = req.body ?? {};
  const ta = Number(req.body?.ta ?? 0);
  const da = Number(req.body?.da ?? 0);
  if (!DATE_RE.test(String(from)) || !DATE_RE.test(String(to)) || String(from) > String(to)) {
    res.status(400).json({ error: "Choose a valid period" });
    return;
  }
  if (!(ta >= 0) || !(da >= 0) || ta + da <= 0) {
    res.status(400).json({ error: "Nothing to pay" });
    return;
  }
  const { rows: sm } = await pool.query(`SELECT name FROM entities WHERE id = $1 AND company_id = $2 AND type = 'salesman'`, [Number(salesmanId), companyId]);
  if (!sm[0]) {
    res.status(404).json({ error: "Salesman not found" });
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO allowance_payments (company_id, salesman_id, salesman_name, period_from, period_to, ta_amount, da_amount, reference, note, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [companyId, Number(salesmanId), sm[0].name, from, to, ta, da, reference ?? null, note ?? null, (req as any).session?.userId ?? null],
  );
  res.status(201).json({ id: rows[0].id, total: Math.round((ta + da) * 100) / 100 });
});

router.get("/commissions/allowance-payments", async (req, res): Promise<void> => {
  const own = ownSalesmanId(req);
  if (!isStaff(req) && !own) return deny(res);
  const companyId = getCompanyId(req);
  const sid = own ?? (Number(req.query.salesmanId) || null);
  const { rows } = await pool.query(
    `SELECT *, period_from::text AS pf, period_to::text AS pt FROM allowance_payments WHERE company_id = $1 ${sid ? "AND salesman_id = $2" : ""} ORDER BY created_at DESC LIMIT 500`,
    sid ? [companyId, sid] : [companyId],
  );
  res.json(rows.map((r) => ({
    id: r.id, salesmanId: r.salesman_id, salesmanName: r.salesman_name,
    from: r.pf, to: r.pt, ta: Number(r.ta_amount), da: Number(r.da_amount),
    total: Number(r.ta_amount) + Number(r.da_amount), reference: r.reference ?? null, note: r.note ?? null,
    paidAt: new Date(r.created_at).toISOString(),
  })));
});

export default router;
