import { pool } from "@workspace/db";
import { buildSupplierSettle, cashPosition, type CashPosition } from "./supplier-settle";

// Stock Investment — how much to spend buying each item again, from the
// money the market has actually paid for it (not credit sales).
//
// For every item (bought-in product or raw material) sold in the period:
//   money back  = cost of the part of its sales the customers have paid
//                 (FIFO cost incl. GST, same matching as Supplier Settle —
//                 a made product's sale counts as its raw materials, via BOM)
//   profit      = collected - money back
//   invest      = money back + profit x % (fast items 10%, others 5% by default)
//   order qty   = invest / last purchase rate (landed, incl. GST)
// so the money that came in for an item goes back into it, plus a slice of
// its profit to grow the stock, more for the items that sell fastest.
//
// "Fast" is automatic — the top 20% of items by money collected in the
// period — unless the owner marks an item fast/normal themselves.

const r2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
const r3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0);

export const DEFAULTS = { fastPct: 10, normalPct: 5, days: 30 };
const KEYS = {
  fastPct: "stock_investment_fast_pct",
  normalPct: "stock_investment_normal_pct",
  days: "stock_investment_days",
  overrides: "stock_investment_overrides",
} as const;
const FAST_SHARE = 0.2;

export type Speed = "fast" | "normal";
export interface StockInvestmentSettings {
  fastPct: number;
  normalPct: number;
  days: number;
  // productId → the owner's own choice, beating the automatic one.
  overrides: Record<string, Speed>;
}

export async function loadSettings(companyId: number): Promise<StockInvestmentSettings> {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE company_id = $1 AND key = ANY($2::text[])`,
    [companyId, Object.values(KEYS)],
  );
  const by = new Map<string, string>(rows.map((r: any) => [r.key, r.value]));
  const n = (k: string, d: number) => {
    const v = Number(by.get(k));
    return by.has(k) && Number.isFinite(v) && v >= 0 ? v : d;
  };
  let overrides: Record<string, Speed> = {};
  try {
    const o = JSON.parse(by.get(KEYS.overrides) ?? "{}");
    if (o && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) if (v === "fast" || v === "normal") overrides[k] = v;
    }
  } catch {
    overrides = {};
  }
  return {
    fastPct: n(KEYS.fastPct, DEFAULTS.fastPct),
    normalPct: n(KEYS.normalPct, DEFAULTS.normalPct),
    days: Math.max(1, Math.round(n(KEYS.days, DEFAULTS.days))),
    overrides,
  };
}

export async function saveSettings(companyId: number, s: StockInvestmentSettings): Promise<void> {
  const pairs: Array<[string, string]> = [
    [KEYS.fastPct, String(s.fastPct)],
    [KEYS.normalPct, String(s.normalPct)],
    [KEYS.days, String(s.days)],
    [KEYS.overrides, JSON.stringify(s.overrides)],
  ];
  for (const [key, value] of pairs) {
    await pool.query(
      `INSERT INTO app_settings (company_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (company_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
      [companyId, key, value],
    );
  }
}

export interface StockInvestmentRow {
  productId: number;
  productName: string;
  itemCode: string | null;
  unit: string;
  rawMaterial: boolean;
  speed: Speed;
  // true when the owner set the speed, not the automatic top-20% rule.
  speedSetByOwner: boolean;
  soldQty: number;
  soldValue: number;
  collected: number;
  // Cost of the collected sales — the item's own money coming back.
  moneyBack: number;
  profit: number;
  pct: number;
  // The slice of profit added on top of moneyBack.
  extra: number;
  invest: number;
  // Landed rate (incl. GST/freight) of the last purchase, else purchase price + GST.
  lastRate: number;
  lastPurchaseDate: string | null;
  lastSupplier: string | null;
  orderQty: number;
  stockQty: number;
  // Some sales couldn't be traced to a purchase; their cost is the item's purchase price.
  costEstimated: boolean;
}

export interface StockInvestmentReport {
  from: string;
  to: string;
  settings: StockInvestmentSettings;
  items: StockInvestmentRow[];
  totals: { collected: number; moneyBack: number; profit: number; extra: number; invest: number; pendingFromCustomers: number };
  cash: CashPosition;
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

export async function buildStockInvestment(
  companyId: number,
  range: { from?: unknown; to?: unknown } = {},
): Promise<StockInvestmentReport> {
  const settings = await loadSettings(companyId);
  const to = isDate(range.to) ? range.to : istToday();
  const from = isDate(range.from) ? range.from : addDays(to, -(settings.days - 1));

  const [productsRes, lastRes] = await Promise.all([
    pool.query(
      `SELECT id, name, item_code, unit, current_stock::float8 AS stock, not_for_sale,
              COALESCE(purchase_price, 0)::float8 AS price, COALESCE(purchase_gst_pct, 0)::float8 AS gst
         FROM products WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
    ),
    // The latest purchase line per product, its cost a share of the bill's grand total.
    pool.query(
      `SELECT DISTINCT ON (pi.product_id) pi.product_id,
              to_char(p.bill_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS bill_date, e.name AS vendor_name,
              (CASE WHEN t.lines_total > 0 THEN pi.amount * p.grand_total / t.lines_total ELSE pi.amount END / pi.qty)::float8 AS unit_cost
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id AND p.company_id = pi.company_id
         JOIN (SELECT purchase_id, SUM(amount) AS lines_total FROM purchase_items WHERE company_id = $1 GROUP BY purchase_id) t
           ON t.purchase_id = p.id
         LEFT JOIN entities e ON e.id = p.vendor_id AND e.company_id = p.company_id
        WHERE p.company_id = $1 AND p.status <> 'cancelled' AND pi.qty > 0
        ORDER BY pi.product_id, p.bill_date DESC, p.id DESC, pi.id DESC`,
      [companyId],
    ),
  ]);
  const product = new Map<number, any>(productsRes.rows.map((p: any) => [p.id, p]));
  const last = new Map<number, any>(lastRes.rows.map((l: any) => [l.product_id, l]));
  const listRate = (p: any) => Number(p?.price ?? 0) * (1 + Number(p?.gst ?? 0) / 100);

  type Acc = { soldQty: number; soldValue: number; collected: number; moneyBack: number; estimated: boolean };
  const acc = new Map<number, Acc>();
  const settle = await buildSupplierSettle(companyId, {
    onSold: (s) => {
      if (s.date < from || s.date > to) return;
      const p = product.get(s.productId);
      if (!p) return;
      // A made product sold beyond what was ever bought, with no BOM: its
      // cost is unknown, so the purchase price stands in for it.
      const cost = s.cost ?? s.qty * listRate(p);
      const a = acc.get(s.productId) ?? { soldQty: 0, soldValue: 0, collected: 0, moneyBack: 0, estimated: false };
      a.soldQty += s.qty;
      a.soldValue += s.value;
      a.collected += s.value * s.paidRatio;
      a.moneyBack += cost * s.paidRatio;
      if (s.cost === null) a.estimated = true;
      acc.set(s.productId, a);
    },
  });

  // Automatic "fast": the top 20% of items by money collected.
  const ranked = [...acc.entries()].filter(([, a]) => a.collected > 0.005).sort((x, y) => y[1].collected - x[1].collected);
  const autoFast = new Set(ranked.slice(0, Math.ceil(ranked.length * FAST_SHARE)).map(([id]) => id));

  let pendingFromCustomers = 0;
  const items: StockInvestmentRow[] = [];
  for (const [productId, a] of acc) {
    pendingFromCustomers += a.soldValue - a.collected;
    if (a.collected <= 0.005) continue;
    const p = product.get(productId);
    const l = last.get(productId);
    const own = settings.overrides[String(productId)];
    const speed: Speed = own ?? (autoFast.has(productId) ? "fast" : "normal");
    const pct = speed === "fast" ? settings.fastPct : settings.normalPct;
    const profit = a.collected - a.moneyBack;
    const extra = Math.max(0, profit) * (pct / 100);
    const invest = a.moneyBack + extra;
    const lastRate = l && Number(l.unit_cost) > 0 ? Number(l.unit_cost) : listRate(p);
    items.push({
      productId,
      productName: p.name,
      itemCode: p.item_code ?? null,
      unit: p.unit ?? "",
      rawMaterial: !!p.not_for_sale,
      speed,
      speedSetByOwner: !!own,
      soldQty: r3(a.soldQty),
      soldValue: r2(a.soldValue),
      collected: r2(a.collected),
      moneyBack: r2(a.moneyBack),
      profit: r2(profit),
      pct,
      extra: r2(extra),
      invest: r2(invest),
      lastRate: r2(lastRate),
      lastPurchaseDate: l?.bill_date ?? null,
      lastSupplier: l?.vendor_name ?? null,
      orderQty: lastRate > 0 ? Math.floor((invest / lastRate) * 100) / 100 : 0,
      stockQty: r3(Number(p.stock ?? 0)),
      costEstimated: a.estimated,
    });
  }
  // Fast items first — they are to be ordered first — then the biggest spend.
  items.sort((x, y) => (x.speed === y.speed ? 0 : x.speed === "fast" ? -1 : 1) || y.invest - x.invest || x.productName.localeCompare(y.productName));

  const sum = (f: (r: StockInvestmentRow) => number) => r2(items.reduce((s, r) => s + f(r), 0));
  return {
    from,
    to,
    settings,
    items,
    totals: {
      collected: sum((r) => r.collected),
      moneyBack: sum((r) => r.moneyBack),
      profit: sum((r) => r.profit),
      extra: sum((r) => r.extra),
      invest: sum((r) => r.invest),
      pendingFromCustomers: r2(pendingFromCustomers),
    },
    cash: await cashPosition(companyId, settle.totals.supplierDue),
  };
}
