import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requirePrivileged(req: any, res: any): boolean {
  const role = req.session?.role;
  if (role !== "admin" && role !== "accountant") {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// ── GET /commissions/transactions ─────────────────────────────────────────────
// Admin/accountant: all transactions for the company (filterable by salesman, status, date).
// Salesman: their own transactions only.
router.get("/commissions/transactions", async (req, res): Promise<void> => {
  const session = (req as any).session;
  const role = session?.role;
  const isPrivileged = role === "admin" || role === "accountant";
  if (!isPrivileged && role !== "salesman") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const companyId = getCompanyId(req);
  const params: any[] = [companyId];
  const where: string[] = ["ct.company_id = $1"];

  if (!isPrivileged) {
    const entityId = session?.entityId;
    if (!entityId) {
      res.json({ transactions: [], totals: { pending: 0, paid: 0, total: 0 } });
      return;
    }
    params.push(entityId);
    where.push(`ct.salesman_id = $${params.length}`);
  } else if ((req.query as any).salesmanId) {
    params.push(Number((req.query as any).salesmanId));
    where.push(`ct.salesman_id = $${params.length}`);
  }

  if ((req.query as any).status) {
    params.push(String((req.query as any).status));
    where.push(`ct.status = $${params.length}`);
  }

  if ((req.query as any).from) {
    params.push(new Date(String((req.query as any).from)));
    where.push(`ct.created_at >= $${params.length}`);
  }

  if ((req.query as any).to) {
    const d = new Date(String((req.query as any).to));
    d.setHours(23, 59, 59, 999);
    params.push(d);
    where.push(`ct.created_at <= $${params.length}`);
  }

  const rows = await pool.query(
    `SELECT ct.id, ct.invoice_id, ct.invoice_no, ct.salesman_id, ct.salesman_name,
            ct.customer_id, ct.customer_name, ct.total_liters, ct.commission_amount,
            ct.status, ct.paid_at, ct.payment_reference, ct.created_at
     FROM commission_transactions ct
     WHERE ${where.join(" AND ")}
     ORDER BY ct.created_at DESC
     LIMIT 2000`,
    params
  );

  const transactions = rows.rows.map((r: any) => ({
    id: r.id,
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice_no,
    salesmanId: r.salesman_id,
    salesmanName: r.salesman_name,
    customerId: r.customer_id,
    customerName: r.customer_name,
    totalLiters: Number(r.total_liters),
    commissionAmount: Number(r.commission_amount),
    status: r.status,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    paymentReference: r.payment_reference ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  }));

  const totals = transactions.reduce(
    (acc: any, t: any) => {
      acc.total += t.commissionAmount;
      if (t.status === "paid") acc.paid += t.commissionAmount;
      else acc.pending += t.commissionAmount;
      return acc;
    },
    { pending: 0, paid: 0, total: 0 }
  );

  res.json({ transactions, totals });
});

// ── PATCH /commissions/transactions/:id/mark-paid ─────────────────────────────
router.patch("/commissions/transactions/:id/mark-paid", async (req, res): Promise<void> => {
  if (!requirePrivileged(req, res)) return;

  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const companyId = getCompanyId(req);
  const { reference } = req.body ?? {};

  const result = await pool.query(
    `UPDATE commission_transactions
     SET status = 'paid', paid_at = NOW(), payment_reference = $1
     WHERE id = $2 AND company_id = $3 AND status = 'pending'
     RETURNING *`,
    [reference ?? null, id, companyId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: "Transaction not found or already paid" });
    return;
  }

  const r = result.rows[0];
  res.json({
    id: r.id,
    status: r.status,
    paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
    paymentReference: r.payment_reference,
  });
});

// ── POST /commissions/bulk-pay ────────────────────────────────────────────────
// Mark all pending transactions for a salesman as paid and record a payment.
router.post("/commissions/bulk-pay", async (req, res): Promise<void> => {
  if (!requirePrivileged(req, res)) return;

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const { salesmanId, reference, note } = req.body ?? {};

  if (!salesmanId) { res.status(400).json({ error: "salesmanId is required" }); return; }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pending = await client.query(
      `SELECT id, salesman_name, commission_amount FROM commission_transactions
       WHERE company_id = $1 AND salesman_id = $2 AND status = 'pending'`,
      [companyId, salesmanId]
    );

    if (pending.rowCount === 0) {
      await client.query("ROLLBACK");
      res.json({ paidCount: 0, totalAmount: 0 });
      return;
    }

    const totalAmount = pending.rows.reduce((s: number, r: any) => s + Number(r.commission_amount), 0);
    const salesmanName = pending.rows[0].salesman_name;
    const ids = pending.rows.map((r: any) => r.id);

    await client.query(
      `UPDATE commission_transactions SET status = 'paid', paid_at = NOW(), payment_reference = $1
       WHERE id = ANY($2)`,
      [reference ?? null, ids]
    );

    await client.query(
      `INSERT INTO commission_payments (company_id, salesman_id, salesman_name, amount, reference, note, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [companyId, salesmanId, salesmanName, String(totalAmount), reference ?? null, note ?? null, session?.userId ?? null]
    );

    await client.query("COMMIT");
    res.json({ paidCount: ids.length, totalAmount });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "bulk-pay failed");
    res.status(500).json({ error: "Bulk payment failed" });
  } finally {
    client.release();
  }
});

// ── GET /commissions/payment-history ─────────────────────────────────────────
router.get("/commissions/payment-history", async (req, res): Promise<void> => {
  if (!requirePrivileged(req, res)) return;

  const companyId = getCompanyId(req);
  const params: any[] = [companyId];
  const where = ["company_id = $1"];

  if ((req.query as any).salesmanId) {
    params.push(Number((req.query as any).salesmanId));
    where.push(`salesman_id = $${params.length}`);
  }

  const rows = await pool.query(
    `SELECT id, salesman_id, salesman_name, amount, payment_date, reference, note, created_at
     FROM commission_payments
     WHERE ${where.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT 500`,
    params
  );

  res.json(rows.rows.map((r: any) => ({
    id: r.id,
    salesmanId: r.salesman_id,
    salesmanName: r.salesman_name,
    amount: Number(r.amount),
    paymentDate: new Date(r.payment_date).toISOString(),
    reference: r.reference ?? null,
    note: r.note ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  })));
});

// ── GET /commissions/salesmen-summary ────────────────────────────────────────
// Admin: summary of pending and paid commission by salesman.
router.get("/commissions/salesmen-summary", async (req, res): Promise<void> => {
  if (!requirePrivileged(req, res)) return;

  const companyId = getCompanyId(req);

  const rows = await pool.query(
    `SELECT salesman_id, salesman_name,
            SUM(CASE WHEN status = 'pending' THEN commission_amount ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'paid' THEN commission_amount ELSE 0 END) AS paid,
            SUM(commission_amount) AS total,
            COUNT(*) AS transactions
     FROM commission_transactions
     WHERE company_id = $1
     GROUP BY salesman_id, salesman_name
     ORDER BY SUM(commission_amount) DESC`,
    [companyId]
  );

  res.json(rows.rows.map((r: any) => ({
    salesmanId: r.salesman_id,
    salesmanName: r.salesman_name,
    pending: Number(r.pending),
    paid: Number(r.paid),
    total: Number(r.total),
    transactions: Number(r.transactions),
  })));
});

// ── GET /commissions/my-stats ─────────────────────────────────────────────────
// Salesman's own commission stats.
router.get("/commissions/my-stats", async (req, res): Promise<void> => {
  const session = (req as any).session;
  const role = session?.role;
  if (role !== "salesman" && role !== "admin" && role !== "accountant") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const companyId = getCompanyId(req);
  const entityId = session?.entityId ?? null;

  if (!entityId && role === "salesman") {
    res.json({ pending: 0, paid: 0, total: 0, recentTransactions: [] });
    return;
  }

  const params: any[] = [companyId];
  const salesmanFilter = entityId ? `AND salesman_id = $${params.length + 1}` : "";
  if (entityId) params.push(entityId);

  const [summary, recent] = await Promise.all([
    pool.query(
      `SELECT SUM(CASE WHEN status = 'pending' THEN commission_amount ELSE 0 END) AS pending,
              SUM(CASE WHEN status = 'paid' THEN commission_amount ELSE 0 END) AS paid,
              SUM(commission_amount) AS total
       FROM commission_transactions
       WHERE company_id = $1 ${salesmanFilter}`,
      params
    ),
    pool.query(
      `SELECT id, invoice_no, customer_name, total_liters, commission_amount, status, created_at
       FROM commission_transactions
       WHERE company_id = $1 ${salesmanFilter}
       ORDER BY created_at DESC LIMIT 20`,
      params
    ),
  ]);

  const s = summary.rows[0];
  res.json({
    pending: Number(s?.pending ?? 0),
    paid: Number(s?.paid ?? 0),
    total: Number(s?.total ?? 0),
    recentTransactions: recent.rows.map((r: any) => ({
      id: r.id,
      invoiceNo: r.invoice_no,
      customerName: r.customer_name,
      totalLiters: Number(r.total_liters),
      commissionAmount: Number(r.commission_amount),
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  });
});

export default router;
