import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

async function queryMany(text: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(text, params);
  return result.rows;
}
async function queryOne(text: string, params: any[] = []): Promise<any> {
  const result = await pool.query(text, params);
  return result.rows[0] ?? {};
}

function requireAdmin(req: any, res: any): boolean {
  const role = req.session?.role;
  if (role !== "admin" && role !== "accountant") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

function dateRange(req: any): { from: Date | null; to: Date | null; clauses: string[]; params: any[] } {
  const params: any[] = [];
  const clauses: string[] = [];
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (to) to.setHours(23, 59, 59, 999);
  return { from, to, clauses, params };
}

// ── GET /reports/sales ──────────────────────────────────────────────
router.get("/reports/sales", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const type = String((req.query as any).type ?? "all"); // gst | non_gst | all
  const customerId = (req.query as any).customerId ? Number((req.query as any).customerId) : null;
  const search = String((req.query as any).search ?? "").trim();

  const params: any[] = [companyId];
  const where: string[] = [`company_id = $1`, `status = 'saved'`];
  if (from) { params.push(new Date(from)); where.push(`invoice_date >= $${params.length}`); }
  if (to) { const d = new Date(to); d.setHours(23,59,59,999); params.push(d); where.push(`invoice_date <= $${params.length}`); }
  if (type === "gst" || type === "non_gst") { params.push(type); where.push(`invoice_type = $${params.length}`); }
  if (customerId) { params.push(customerId); where.push(`customer_id = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(invoice_no ILIKE $${params.length} OR COALESCE(customer_name,'') ILIKE $${params.length})`);
  }

  const rows = await queryMany(
    `SELECT id, invoice_no, invoice_date, invoice_type, customer_id, customer_name,
            customer_gstin, place_of_supply, subtotal, total_discount, total_tax,
            cgst, sgst, igst, freight, round_off, grand_total, amount_paid, balance_due, status
     FROM invoices
     WHERE ${where.join(" AND ")}
     ORDER BY invoice_date DESC, id DESC
     LIMIT 1000`, params
  );

  const items = rows.map(r => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    invoiceDate: new Date(r.invoice_date).toISOString(),
    invoiceType: r.invoice_type,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerGstin: r.customer_gstin,
    placeOfSupply: r.place_of_supply,
    subtotal: Number(r.subtotal),
    totalDiscount: Number(r.total_discount),
    totalTax: Number(r.total_tax),
    cgst: Number(r.cgst),
    sgst: Number(r.sgst),
    igst: Number(r.igst),
    freight: Number(r.freight),
    roundOff: Number(r.round_off),
    grandTotal: Number(r.grand_total),
    amountPaid: Number(r.amount_paid),
    balanceDue: Number(r.balance_due),
    status: r.status,
  }));

  const totals = items.reduce((acc, it) => {
    acc.subtotal += it.subtotal;
    acc.totalTax += it.totalTax;
    acc.cgst += it.cgst; acc.sgst += it.sgst; acc.igst += it.igst;
    acc.grandTotal += it.grandTotal;
    acc.amountPaid += it.amountPaid;
    acc.balanceDue += it.balanceDue;
    return acc;
  }, { subtotal: 0, totalTax: 0, cgst: 0, sgst: 0, igst: 0, grandTotal: 0, amountPaid: 0, balanceDue: 0, count: items.length });

  res.json({ items, totals });
});

// ── GET /reports/sales/item-wise ────────────────────────────────────
router.get("/reports/sales/item-wise", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const type = String((req.query as any).type ?? "all");
  const search = String((req.query as any).search ?? "").trim();

  const params: any[] = [companyId];
  const where: string[] = [`i.company_id = $1`, `i.status = 'saved'`];
  if (from) { params.push(new Date(from)); where.push(`i.invoice_date >= $${params.length}`); }
  if (to) { const d = new Date(to); d.setHours(23,59,59,999); params.push(d); where.push(`i.invoice_date <= $${params.length}`); }
  if (type === "gst" || type === "non_gst") { params.push(type); where.push(`i.invoice_type = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(ii.product_name ILIKE $${params.length} OR COALESCE(ii.hsn_code,'') ILIKE $${params.length})`); }

  const rows = await queryMany(
    `SELECT ii.product_id, ii.product_name, ii.hsn_code, ii.unit,
            COUNT(DISTINCT ii.invoice_id) AS invoices,
            SUM(ii.qty) AS qty,
            SUM(ii.amount) AS amount,
            SUM(ii.amount * ii.tax_pct / 100) AS tax
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     WHERE ${where.join(" AND ")}
     GROUP BY ii.product_id, ii.product_name, ii.hsn_code, ii.unit
     ORDER BY SUM(ii.amount) DESC
     LIMIT 1000`, params
  );

  const items = rows.map(r => ({
    productId: r.product_id,
    productName: r.product_name,
    hsnCode: r.hsn_code ?? null,
    unit: r.unit,
    invoices: Number(r.invoices),
    qty: Number(r.qty),
    amount: Number(r.amount),
    tax: Number(r.tax ?? 0),
    total: Number(r.amount) + Number(r.tax ?? 0),
  }));

  const totals = items.reduce((a, it) => {
    a.qty += it.qty; a.amount += it.amount; a.tax += it.tax; a.total += it.total; return a;
  }, { qty: 0, amount: 0, tax: 0, total: 0, count: items.length });

  res.json({ items, totals });
});

// ── GET /reports/sales/customer-wise ────────────────────────────────
router.get("/reports/sales/customer-wise", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const type = String((req.query as any).type ?? "all");
  const search = String((req.query as any).search ?? "").trim();

  const params: any[] = [companyId];
  const where: string[] = [`i.company_id = $1`, `i.status = 'saved'`];
  if (from) { params.push(new Date(from)); where.push(`i.invoice_date >= $${params.length}`); }
  if (to) { const d = new Date(to); d.setHours(23,59,59,999); params.push(d); where.push(`i.invoice_date <= $${params.length}`); }
  if (type === "gst" || type === "non_gst") { params.push(type); where.push(`i.invoice_type = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`COALESCE(i.customer_name,'') ILIKE $${params.length}`); }

  const rows = await queryMany(
    `SELECT i.customer_id,
            COALESCE(i.customer_name, '— Walk-in —') AS customer_name,
            COUNT(*) AS invoices,
            SUM(i.subtotal) AS subtotal,
            SUM(i.total_tax) AS tax,
            SUM(i.grand_total) AS total,
            SUM(i.amount_paid) AS paid,
            SUM(i.balance_due) AS balance,
            COALESCE((
              SELECT SUM(ii.qty)
              FROM invoice_items ii
              WHERE ii.invoice_id IN (
                SELECT id FROM invoices i2
                WHERE ${where.join(" AND ").replace(/\bi\./g, "i2.")}
                  AND (i2.customer_id IS NOT DISTINCT FROM i.customer_id)
              )
            ), 0) AS qty
     FROM invoices i
     WHERE ${where.join(" AND ")}
     GROUP BY i.customer_id, i.customer_name
     ORDER BY SUM(i.grand_total) DESC
     LIMIT 1000`, params
  );

  const items = rows.map(r => ({
    customerId: r.customer_id,
    customerName: r.customer_name,
    invoices: Number(r.invoices),
    qty: Number(r.qty ?? 0),
    subtotal: Number(r.subtotal),
    tax: Number(r.tax),
    total: Number(r.total),
    paid: Number(r.paid),
    balance: Number(r.balance),
  }));

  const totals = items.reduce((a, it) => {
    a.qty += it.qty; a.subtotal += it.subtotal; a.tax += it.tax; a.total += it.total; a.paid += it.paid; a.balance += it.balance; return a;
  }, { qty: 0, subtotal: 0, tax: 0, total: 0, paid: 0, balance: 0, count: items.length });

  res.json({ items, totals });
});

// ── GET /reports/production ─────────────────────────────────────────
router.get("/reports/production", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const search = String((req.query as any).search ?? "").trim();

  const params: any[] = [companyId];
  const where: string[] = [`wc.company_id = $1`, `wc.status = 'done'`, `wc.completed_at IS NOT NULL`];
  if (from) { params.push(new Date(from)); where.push(`wc.completed_at >= $${params.length}`); }
  if (to) { const d = new Date(to); d.setHours(23,59,59,999); params.push(d); where.push(`wc.completed_at <= $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(p.name ILIKE $${params.length} OR COALESCE(wc.worker_name,'') ILIKE $${params.length})`); }

  const rows = await queryMany(
    `SELECT wc.id, wc.product_id, p.name AS product_name, p.unit,
            wc.target_qty, wc.worker_name, wc.order_type, wc.completed_at,
            p.purchase_price
     FROM workload_cards wc
     JOIN products p ON p.id = wc.product_id
     WHERE ${where.join(" AND ")}
     ORDER BY wc.completed_at DESC
     LIMIT 1000`, params
  );

  const items = rows.map(r => ({
    id: r.id,
    productId: r.product_id,
    productName: r.product_name,
    unit: r.unit,
    qty: Number(r.target_qty),
    workerName: r.worker_name ?? null,
    orderType: r.order_type,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    cost: Number(r.target_qty) * Number(r.purchase_price ?? 0),
  }));

  const summary = await queryMany(
    `SELECT wc.product_id, p.name AS product_name, p.unit,
            COUNT(*) AS batches, SUM(wc.target_qty) AS qty,
            SUM(wc.target_qty * COALESCE(p.purchase_price, 0)) AS cost
     FROM workload_cards wc
     JOIN products p ON p.id = wc.product_id
     WHERE ${where.join(" AND ")}
     GROUP BY wc.product_id, p.name, p.unit
     ORDER BY SUM(wc.target_qty) DESC`, params
  );

  const summaryRows = summary.map(r => ({
    productId: r.product_id,
    productName: r.product_name,
    unit: r.unit,
    batches: Number(r.batches),
    qty: Number(r.qty),
    cost: Number(r.cost ?? 0),
  }));

  const totals = items.reduce((a, it) => { a.qty += it.qty; a.cost += it.cost; return a; },
    { qty: 0, cost: 0, count: items.length });

  res.json({ items, summary: summaryRows, totals });
});

// ── GET /reports/tax ────────────────────────────────────────────────
router.get("/reports/tax", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const ps: any[] = [companyId];
  let dateClauseSales = "i.company_id = $1 AND i.status = 'saved' AND i.invoice_type = 'gst'";
  let dateClausePurchase = "p.company_id = $1 AND p.status = 'saved' AND p.bill_type = 'gst'";
  if (from) {
    ps.push(new Date(from));
    dateClauseSales += ` AND i.invoice_date >= $${ps.length}`;
    dateClausePurchase += ` AND p.bill_date >= $${ps.length}`;
  }
  if (to) {
    const d = new Date(to); d.setHours(23,59,59,999);
    ps.push(d);
    dateClauseSales += ` AND i.invoice_date <= $${ps.length}`;
    dateClausePurchase += ` AND p.bill_date <= $${ps.length}`;
  }

  const [outputAgg, inputAgg, outputByRate, inputByRate] = await Promise.all([
    queryOne(
      `SELECT COALESCE(SUM(subtotal),0) AS taxable,
              COALESCE(SUM(cgst),0) AS cgst,
              COALESCE(SUM(sgst),0) AS sgst,
              COALESCE(SUM(igst),0) AS igst,
              COALESCE(SUM(total_tax),0) AS total
       FROM invoices i WHERE ${dateClauseSales}`, ps),
    queryOne(
      `SELECT COALESCE(SUM(subtotal),0) AS taxable,
              COALESCE(SUM(cgst),0) AS cgst,
              COALESCE(SUM(sgst),0) AS sgst,
              COALESCE(SUM(igst),0) AS igst,
              COALESCE(SUM(total_tax),0) AS total
       FROM purchases p WHERE ${dateClausePurchase}`, ps),
    queryMany(
      `SELECT ii.tax_pct AS rate,
              SUM(ii.amount) AS taxable,
              SUM(ii.amount * ii.tax_pct / 100) AS tax
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE ${dateClauseSales}
       GROUP BY ii.tax_pct ORDER BY ii.tax_pct`, ps),
    queryMany(
      `SELECT pi.tax_pct AS rate,
              SUM(pi.amount) AS taxable,
              SUM(pi.amount * pi.tax_pct / 100) AS tax
       FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
       WHERE ${dateClausePurchase}
       GROUP BY pi.tax_pct ORDER BY pi.tax_pct`, ps),
  ]);

  const output = {
    taxable: Number(outputAgg.taxable), cgst: Number(outputAgg.cgst),
    sgst: Number(outputAgg.sgst), igst: Number(outputAgg.igst), total: Number(outputAgg.total),
  };
  const input = {
    taxable: Number(inputAgg.taxable), cgst: Number(inputAgg.cgst),
    sgst: Number(inputAgg.sgst), igst: Number(inputAgg.igst), total: Number(inputAgg.total),
  };
  res.json({
    output, input,
    netPayable: output.total - input.total,
    outputByRate: outputByRate.map((r: any) => ({ rate: Number(r.rate), taxable: Number(r.taxable), tax: Number(r.tax) })),
    inputByRate: inputByRate.map((r: any) => ({ rate: Number(r.rate), taxable: Number(r.taxable), tax: Number(r.tax) })),
  });
});

// ── GET /reports/profit-loss ────────────────────────────────────────
router.get("/reports/profit-loss", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const ps: any[] = [companyId];
  let salesClause = "i.company_id = $1 AND i.status = 'saved'";
  let purClause = "p.company_id = $1 AND p.status = 'saved'";
  let expClause = "e.company_id = $1";
  if (from) {
    ps.push(new Date(from));
    salesClause += ` AND i.invoice_date >= $${ps.length}`;
    purClause += ` AND p.bill_date >= $${ps.length}`;
    expClause += ` AND e.date >= $${ps.length}`;
  }
  if (to) {
    const d = new Date(to); d.setHours(23,59,59,999);
    ps.push(d);
    salesClause += ` AND i.invoice_date <= $${ps.length}`;
    purClause += ` AND p.bill_date <= $${ps.length}`;
    expClause += ` AND e.date <= $${ps.length}`;
  }

  const [salesRow, cogsRow, purchaseRow, expRow, expByCat] = await Promise.all([
    queryOne(`SELECT COALESCE(SUM(subtotal),0) AS revenue, COALESCE(SUM(total_tax),0) AS tax, COALESCE(SUM(grand_total),0) AS total FROM invoices i WHERE ${salesClause}`, ps),
    queryOne(
      `SELECT COALESCE(SUM(ii.qty * COALESCE(prod.purchase_price, 0)), 0) AS cogs
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       JOIN products prod ON prod.id = ii.product_id
       WHERE ${salesClause}`, ps),
    queryOne(`SELECT COALESCE(SUM(subtotal),0) AS purchases FROM purchases p WHERE ${purClause}`, ps),
    queryOne(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses e WHERE ${expClause}`, ps),
    queryMany(`SELECT e.category_name, COALESCE(SUM(e.amount),0) AS total FROM expenses e WHERE ${expClause} GROUP BY e.category_name ORDER BY SUM(e.amount) DESC`, ps),
  ]);

  const revenue = Number(salesRow.revenue);
  const cogs = Number(cogsRow.cogs);
  const grossProfit = revenue - cogs;
  const expenses = Number(expRow.total);
  const netProfit = grossProfit - expenses;
  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin = revenue > 0 ? (netProfit / revenue) * 100 : 0;

  res.json({
    revenue,
    cogs,
    grossProfit,
    grossMargin,
    expenses,
    netProfit,
    netMargin,
    salesTax: Number(salesRow.tax),
    salesTotal: Number(salesRow.total),
    purchases: Number(purchaseRow.purchases),
    expensesByCategory: expByCat.map((r: any) => ({ categoryName: r.category_name, total: Number(r.total) })),
  });
});

// ── GET /reports/commission ─────────────────────────────────────────
// Salesman commission = sum of (liters sold x product commission-per-liter)
// across that salesman's saved invoices. Admin/accountant see every salesman;
// a salesman sees only their own attributed sales.
router.get("/reports/commission", async (req, res): Promise<void> => {
  const role = (req as any).session?.role;
  const sessionEntityId = (req as any).session?.entityId ?? null;
  const isPrivileged = role === "admin" || role === "accountant";
  if (!isPrivileged && role !== "salesman") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const companyId = getCompanyId(req);
  const { from, to } = req.query as any;
  const params: any[] = [companyId];
  const where: string[] = [`i.company_id = $1`, `i.status = 'saved'`, `i.salesman_id IS NOT NULL`];
  if (from) { params.push(new Date(from)); where.push(`i.invoice_date >= $${params.length}`); }
  if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); params.push(d); where.push(`i.invoice_date <= $${params.length}`); }

  // A salesman is hard-scoped to their own entity id; privileged roles may
  // optionally filter by a specific salesmanId.
  if (!isPrivileged) {
    if (!sessionEntityId) {
      res.json({ totalCommission: 0, totalLiters: 0, rows: [] });
      return;
    }
    params.push(sessionEntityId);
    where.push(`i.salesman_id = $${params.length}`);
  } else if ((req.query as any).salesmanId) {
    params.push(Number((req.query as any).salesmanId));
    where.push(`i.salesman_id = $${params.length}`);
  }

  const rows = await queryMany(
    `SELECT i.salesman_id,
            COALESCE(i.salesman_name, '—') AS salesman_name,
            ii.product_id,
            MAX(ii.product_name) AS product_name,
            COALESCE(p.commission_per_liter, 0) AS commission_per_liter,
            SUM(COALESCE(ii.total_liters, ii.qty, 0)) AS liters
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     JOIN products p ON p.id = ii.product_id
     WHERE ${where.join(" AND ")}
     GROUP BY i.salesman_id, i.salesman_name, ii.product_id, p.commission_per_liter
     ORDER BY i.salesman_id`, params
  );

  const bySalesman = new Map<number, any>();
  for (const r of rows) {
    const sid = Number(r.salesman_id);
    const liters = Number(r.liters ?? 0);
    const cpl = Number(r.commission_per_liter ?? 0);
    const commission = liters * cpl;
    let s = bySalesman.get(sid);
    if (!s) {
      s = { salesmanId: sid, salesmanName: r.salesman_name, liters: 0, commission: 0, productBreakdown: [] };
      bySalesman.set(sid, s);
    }
    s.liters += liters;
    s.commission += commission;
    s.productBreakdown.push({
      productId: Number(r.product_id),
      productName: r.product_name,
      liters,
      commissionPerLiter: cpl,
      commission,
    });
  }

  const resultRows = Array.from(bySalesman.values()).sort((a, b) => b.commission - a.commission);
  const totalCommission = resultRows.reduce((acc, s) => acc + s.commission, 0);
  const totalLiters = resultRows.reduce((acc, s) => acc + s.liters, 0);

  res.json({ totalCommission, totalLiters, rows: resultRows });
});

export default router;
