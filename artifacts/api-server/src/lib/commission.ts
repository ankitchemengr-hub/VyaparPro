// Salesman commission and TA/DA rules (Commission → Settings).
//
// Each salesman can have their own rule; anyone without one uses the company
// default (commission_settings row with salesman_id = 0), and with no rows at
// all it is "per liter" — the original behaviour (liters × the product's
// commission per liter).
//
// Commission methods:
//   per_liter        liters sold × product's commission per liter
//   invoice_percent  rate % of the bill (before GST, or with GST — `base`)
//   product_percent  each product's own % (product_commission_rates) of its line
//   per_invoice      fixed ₹ rate for every bill
//   none             no commission
//
// TA/DA (allowances), worked out for a period on the TA / DA screen:
//   DA: none | per_day (₹ × days with at least one bill/order) | per_order
//       (₹ × bills/orders) | monthly (₹ × months in the period)
//   TA: none | per_km (₹ × km in travel claims) | per_day (₹ × working days)
//       | actual (the ₹ entered in travel claims)
//   `da_basis`: which activity counts — bills, customer orders, or both.

export type CommissionMethod = "per_liter" | "invoice_percent" | "product_percent" | "per_invoice" | "none";
export type CommissionBase = "without_gst" | "with_gst";
export type DaMode = "none" | "per_day" | "per_order" | "monthly";
export type TaMode = "none" | "per_km" | "per_day" | "actual";
export type ActivityBasis = "invoices" | "orders" | "both";

export const COMMISSION_METHODS: CommissionMethod[] = ["per_liter", "invoice_percent", "product_percent", "per_invoice", "none"];
export const COMMISSION_BASES: CommissionBase[] = ["without_gst", "with_gst"];
export const DA_MODES: DaMode[] = ["none", "per_day", "per_order", "monthly"];
export const TA_MODES: TaMode[] = ["none", "per_km", "per_day", "actual"];
export const ACTIVITY_BASES: ActivityBasis[] = ["invoices", "orders", "both"];

export interface CommissionRule {
  salesmanId: number; // 0 = company default
  method: CommissionMethod;
  rate: number;
  base: CommissionBase;
  daMode: DaMode;
  daAmount: number;
  daBasis: ActivityBasis;
  taMode: TaMode;
  taRate: number;
  isDefault: boolean; // true when this salesman has no rule of their own
}

const BUILT_IN: Omit<CommissionRule, "salesmanId" | "isDefault"> = {
  method: "per_liter", rate: 0, base: "without_gst",
  daMode: "none", daAmount: 0, daBasis: "invoices", taMode: "none", taRate: 0,
};

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

export function ruleFromRow(r: any, salesmanId: number, isDefault: boolean): CommissionRule {
  if (!r) return { ...BUILT_IN, salesmanId, isDefault };
  return {
    salesmanId,
    method: r.method,
    rate: Number(r.rate ?? 0),
    base: r.base,
    daMode: r.da_mode,
    daAmount: Number(r.da_amount ?? 0),
    daBasis: r.da_basis,
    taMode: r.ta_mode,
    taRate: Number(r.ta_rate ?? 0),
    isDefault,
  };
}

// The rule that applies to this salesman: their own, else the company default.
export async function ruleFor(db: Queryable, companyId: number, salesmanId: number): Promise<CommissionRule> {
  const { rows } = await db.query(
    `SELECT * FROM commission_settings WHERE company_id = $1 AND salesman_id IN (0, $2) ORDER BY salesman_id DESC`,
    [companyId, salesmanId],
  );
  const own = rows.find((r) => Number(r.salesman_id) === salesmanId && salesmanId !== 0);
  if (own) return ruleFromRow(own, salesmanId, false);
  return ruleFromRow(rows.find((r) => Number(r.salesman_id) === 0), salesmanId, true);
}

export interface CommissionLine {
  productId: number;
  liters: number;
  withGst: number; // line value including GST
  withoutGst: number; // line value before GST
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function commissionForLines(db: Queryable, companyId: number, rule: CommissionRule, lines: CommissionLine[]): Promise<{ amount: number; liters: number }> {
  const liters = lines.reduce((s, l) => s + l.liters, 0);
  const ids = [...new Set(lines.map((l) => l.productId))];
  let amount = 0;
  switch (rule.method) {
    case "none":
      break;
    case "per_invoice":
      amount = lines.length > 0 ? rule.rate : 0;
      break;
    case "invoice_percent": {
      const base = lines.reduce((s, l) => s + (rule.base === "with_gst" ? l.withGst : l.withoutGst), 0);
      amount = (base * rule.rate) / 100;
      break;
    }
    case "product_percent": {
      const { rows } = ids.length
        ? await db.query(`SELECT product_id, percent FROM product_commission_rates WHERE company_id = $1 AND product_id = ANY($2::int[])`, [companyId, ids])
        : { rows: [] };
      const pct = new Map(rows.map((r) => [Number(r.product_id), Number(r.percent)]));
      for (const l of lines) amount += ((rule.base === "with_gst" ? l.withGst : l.withoutGst) * (pct.get(l.productId) ?? 0)) / 100;
      break;
    }
    case "per_liter":
    default: {
      const { rows } = ids.length
        ? await db.query(`SELECT id, commission_per_liter FROM products WHERE company_id = $1 AND id = ANY($2::int[])`, [companyId, ids])
        : { rows: [] };
      const cpl = new Map(rows.map((r) => [Number(r.id), Number(r.commission_per_liter ?? 0)]));
      for (const l of lines) amount += l.liters * (cpl.get(l.productId) ?? 0);
    }
  }
  return { amount: round2(amount), liters: Math.round(liters * 1000) / 1000 };
}

async function invoiceLines(db: Queryable, companyId: number, invoiceId: number): Promise<CommissionLine[]> {
  const { rows } = await db.query(
    `SELECT product_id, total_liters, amount, tax_pct, cess_pct FROM invoice_items WHERE company_id = $1 AND invoice_id = $2`,
    [companyId, invoiceId],
  );
  return rows.map((r) => {
    const withGst = Number(r.amount ?? 0);
    const taxFactor = 1 + (Number(r.tax_pct ?? 0) + Number(r.cess_pct ?? 0)) / 100;
    return { productId: Number(r.product_id), liters: Number(r.total_liters ?? 0), withGst, withoutGst: withGst / taxFactor };
  });
}

// Brings the bill's commission in line with the bill as it is now — after it
// is created, edited or cancelled. The bill's own commission row is updated
// while still pending; once paid, the difference goes in as a separate
// pending "(Edited)" row (negative = to recover on the next payout).
export async function refreshInvoiceCommission(db: Queryable, companyId: number, invoiceId: number): Promise<void> {
  const { rows: [inv] } = await db.query(
    `SELECT id, invoice_no, invoice_type, status, salesman_id, salesman_name, customer_id, customer_name
       FROM invoices WHERE company_id = $1 AND id = $2`,
    [companyId, invoiceId],
  );
  if (!inv || inv.invoice_type === "quotation") return;

  const { rows: existing } = await db.query(
    `SELECT id, salesman_id, commission_amount, total_liters, status FROM commission_transactions
      WHERE company_id = $1 AND invoice_id = $2 AND (invoice_no = $3 OR invoice_no = $3 || ' (Edited)')
      ORDER BY id`,
    [companyId, invoiceId, inv.invoice_no],
  );
  const own = existing.find((r) => r.status === "pending" && r.id === existing[0]?.id) ?? null;

  let target = { amount: 0, liters: 0 };
  const salesmanId = inv.salesman_id ? Number(inv.salesman_id) : null;
  if (salesmanId && inv.status !== "cancelled") {
    const rule = await ruleFor(db, companyId, salesmanId);
    target = await commissionForLines(db, companyId, rule, await invoiceLines(db, companyId, invoiceId));
  }

  // What the bill's rows already add up to.
  const booked = existing.reduce((s, r) => s + Number(r.commission_amount), 0);
  const bookedLiters = existing.reduce((s, r) => s + Number(r.total_liters), 0);
  const firstSalesman = existing[0]?.salesman_id != null ? Number(existing[0].salesman_id) : null;

  if (own && existing.length === 1 && (firstSalesman === salesmanId || !salesmanId)) {
    // The bill's single row is still pending: just rewrite it.
    if (target.amount === 0 && target.liters === 0) {
      await db.query(`DELETE FROM commission_transactions WHERE id = $1`, [own.id]);
    } else {
      await db.query(
        `UPDATE commission_transactions SET commission_amount = $1, total_liters = $2, salesman_name = COALESCE($3, salesman_name),
                customer_id = $4, customer_name = $5 WHERE id = $6`,
        [String(target.amount), String(target.liters), inv.salesman_name, inv.customer_id, inv.customer_name, own.id],
      );
    }
    return;
  }

  if (existing.length === 0) {
    if (salesmanId && (target.amount > 0 || target.liters > 0)) {
      await db.query(
        `INSERT INTO commission_transactions
           (company_id, invoice_id, invoice_no, salesman_id, salesman_name, customer_id, customer_name, total_liters, commission_amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
        [companyId, invoiceId, inv.invoice_no, salesmanId, inv.salesman_name ?? "", inv.customer_id, inv.customer_name,
         String(target.liters), String(target.amount)],
      );
    }
    return;
  }

  // Paid already, several rows, or the salesman changed: book the difference.
  // A changed salesman: the old one's total is reversed, the new one gets the
  // full amount.
  if (firstSalesman != null && salesmanId !== firstSalesman) {
    if (Math.abs(booked) > 0.004 || Math.abs(bookedLiters) > 0.0005) {
      await db.query(
        `INSERT INTO commission_transactions
           (company_id, invoice_id, invoice_no, salesman_id, salesman_name, customer_id, customer_name, total_liters, commission_amount, status)
         SELECT $1, $2, $3 || ' (Edited)', salesman_id, salesman_name, $4, $5, $6, $7, 'pending'
           FROM commission_transactions WHERE id = $8`,
        [companyId, invoiceId, inv.invoice_no, inv.customer_id, inv.customer_name, String(-bookedLiters), String(-booked), existing[0].id],
      );
    }
    if (salesmanId && (target.amount > 0 || target.liters > 0)) {
      await db.query(
        `INSERT INTO commission_transactions
           (company_id, invoice_id, invoice_no, salesman_id, salesman_name, customer_id, customer_name, total_liters, commission_amount, status)
         VALUES ($1,$2,$3 || ' (Edited)',$4,$5,$6,$7,$8,$9,'pending')`,
        [companyId, invoiceId, inv.invoice_no, salesmanId, inv.salesman_name ?? "", inv.customer_id, inv.customer_name,
         String(target.liters), String(target.amount)],
      );
    }
    return;
  }

  const diff = round2(target.amount - booked);
  const diffLiters = Math.round((target.liters - bookedLiters) * 1000) / 1000;
  if (Math.abs(diff) < 0.005 && Math.abs(diffLiters) < 0.0005) return;
  await db.query(
    `INSERT INTO commission_transactions
       (company_id, invoice_id, invoice_no, salesman_id, salesman_name, customer_id, customer_name, total_liters, commission_amount, status)
     VALUES ($1,$2,$3 || ' (Edited)',$4,$5,$6,$7,$8,$9,'pending')`,
    [companyId, invoiceId, inv.invoice_no, firstSalesman, inv.salesman_name ?? "", inv.customer_id, inv.customer_name,
     String(diffLiters), String(diff)],
  );
}

// Commission to take back for returned lines. Per-bill commission isn't taken
// back; the % methods take back the same % of the returned value.
export async function commissionForReturn(db: Queryable, companyId: number, salesmanId: number, lines: CommissionLine[]): Promise<{ amount: number; liters: number }> {
  const rule = await ruleFor(db, companyId, salesmanId);
  if (rule.method === "per_invoice") return { amount: 0, liters: Math.round(lines.reduce((s, l) => s + l.liters, 0) * 1000) / 1000 };
  return commissionForLines(db, companyId, rule, lines);
}
