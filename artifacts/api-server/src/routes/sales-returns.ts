import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  GetInvoiceReturnableItemsParams,
  ListSalesReturnsQueryParams,
  CreateSalesReturnBody,
  GetSalesReturnParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";
import { generateSeriesNumber } from "../lib/number-series";

const router: IRouter = Router();

const SALES_RETURN_READ_ROLES = new Set(["admin", "salesman", "accountant", "store"]);
const SALES_RETURN_WRITE_ROLES = new Set(["admin", "salesman", "store"]);

function requireSession(req: any, res: any, roles: Set<string>): { userId: number; role: string } | null {
  const session = req.session;
  if (!session || typeof session.userId !== "number") {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (!roles.has(session.role)) {
    res.status(403).json({ error: "Not permitted" });
    return null;
  }
  return { userId: session.userId, role: session.role };
}

function formatSalesReturn(row: any, items: any[], createdByName: string | null = null) {
  return {
    id: row.id,
    returnNo: row.return_no,
    returnDate: row.return_date?.toISOString?.() ?? row.return_date,
    invoiceId: row.invoice_id ?? null,
    invoiceNo: row.invoice_no,
    customerId: row.customer_id ?? null,
    customerName: row.customer_name ?? null,
    reason: row.reason ?? null,
    subtotal: Number(row.subtotal),
    totalTax: Number(row.total_tax),
    grandTotal: Number(row.grand_total),
    status: row.status,
    createdByName,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    items: items.map((it) => ({
      id: it.id,
      productId: it.product_id,
      productName: it.product_name,
      qty: Number(it.qty),
      unit: it.unit,
      rate: Number(it.rate),
      taxPct: Number(it.tax_pct),
      amount: Number(it.amount),
    })),
  };
}

// GET /invoices/:id/returnable-items
router.get("/invoices/:id/returnable-items", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, SALES_RETURN_READ_ROLES);
  if (!auth) return;
  const parsed = GetInvoiceReturnableItemsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  try {
    const invRes = await pool.query(
      `SELECT id, invoice_no, invoice_date, invoice_type, customer_id, customer_name, status
       FROM invoices WHERE id = $1 AND company_id = $2`,
      [parsed.data.id, companyId],
    );
    const inv = invRes.rows[0];
    if (!inv) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (inv.status === "cancelled") {
      res.status(400).json({ error: "This invoice is cancelled and has nothing to return" });
      return;
    }
    if (inv.invoice_type === "quotation") {
      res.status(400).json({ error: "Quotations never affected stock/ledger — nothing to return" });
      return;
    }
    const itemsRes = await pool.query(
      `SELECT ii.id AS invoice_item_id, ii.product_id, ii.product_name, ii.unit, ii.rate, ii.tax_pct, ii.qty, ii.amount,
              COALESCE(ret.returned_qty, 0) AS already_returned_qty
       FROM invoice_items ii
       LEFT JOIN (
         SELECT sri.invoice_item_id, SUM(sri.qty) AS returned_qty
         FROM sales_return_items sri
         JOIN sales_returns sr ON sr.id = sri.return_id
         WHERE sr.invoice_id = $1 AND sr.company_id = $2 AND sr.status != 'cancelled'
         GROUP BY sri.invoice_item_id
       ) ret ON ret.invoice_item_id = ii.id
       WHERE ii.invoice_id = $1 AND ii.company_id = $2
       ORDER BY ii.id ASC`,
      [parsed.data.id, companyId],
    );
    res.json({
      invoiceId: inv.id,
      invoiceNo: inv.invoice_no,
      invoiceDate: inv.invoice_date?.toISOString?.() ?? inv.invoice_date,
      invoiceType: inv.invoice_type,
      customerId: inv.customer_id ?? null,
      customerName: inv.customer_name ?? null,
      items: itemsRes.rows.map((r: any) => {
        const qty = Number(r.qty);
        const alreadyReturnedQty = Number(r.already_returned_qty);
        return {
          invoiceItemId: r.invoice_item_id,
          productId: r.product_id,
          productName: r.product_name,
          unit: r.unit,
          rate: Number(r.rate),
          taxPct: Number(r.tax_pct),
          qty,
          originalAmount: Number(r.amount),
          alreadyReturnedQty,
          returnableQty: Math.max(0, qty - alreadyReturnedQty),
        };
      }),
    });
  } catch (err) {
    logger.error({ err }, "Failed to load returnable items");
    res.status(500).json({ error: "Failed to load returnable items" });
  }
});

// GET /sales-returns
router.get("/sales-returns", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, SALES_RETURN_READ_ROLES);
  if (!auth) return;
  const parsed = ListSalesReturnsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const params: any[] = [companyId];
  const conditions = ["company_id = $1"];
  if (parsed.data.search) {
    params.push(`%${parsed.data.search}%`);
    conditions.push(`(return_no ILIKE $${params.length} OR invoice_no ILIKE $${params.length} OR customer_name ILIKE $${params.length})`);
  }
  try {
    const result = await pool.query(
      `SELECT * FROM sales_returns WHERE ${conditions.join(" AND ")} ORDER BY return_date DESC, id DESC`,
      params,
    );
    res.json(result.rows.map((r: any) => formatSalesReturn(r, [])));
  } catch (err) {
    logger.error({ err }, "Failed to list sales returns");
    res.status(500).json({ error: "Failed to list sales returns" });
  }
});

// POST /sales-returns
router.post("/sales-returns", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, SALES_RETURN_WRITE_ROLES);
  if (!auth) return;
  const parsed = CreateSalesReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const data = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const invRes = await client.query(
      `SELECT id, invoice_no, invoice_type, customer_id, customer_name, status
       FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [data.invoiceId, companyId],
    );
    const inv = invRes.rows[0];
    if (!inv) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (inv.status === "cancelled") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "This invoice is cancelled and has nothing to return" });
      return;
    }
    if (inv.invoice_type === "quotation") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Quotations never affected stock/ledger — nothing to return" });
      return;
    }

    const itemIds = data.items.map((i) => i.invoiceItemId);
    const itemsRes = await client.query(
      `SELECT ii.id, ii.product_id, ii.product_name, ii.unit, ii.rate, ii.tax_pct, ii.qty, ii.amount,
              COALESCE(ret.returned_qty, 0) AS already_returned_qty
       FROM invoice_items ii
       LEFT JOIN (
         SELECT sri.invoice_item_id, SUM(sri.qty) AS returned_qty
         FROM sales_return_items sri
         JOIN sales_returns sr ON sr.id = sri.return_id
         WHERE sr.invoice_id = $1 AND sr.company_id = $2 AND sr.status != 'cancelled'
         GROUP BY sri.invoice_item_id
       ) ret ON ret.invoice_item_id = ii.id
       WHERE ii.invoice_id = $1 AND ii.company_id = $2 AND ii.id = ANY($3::int[])`,
      [data.invoiceId, companyId, itemIds],
    );
    const itemById = new Map(itemsRes.rows.map((r: any) => [r.id, r]));

    let subtotal = 0;
    let totalTax = 0;
    let grandTotal = 0;
    const lines: { invoiceItemId: number; productId: number; productName: string; unit: string; rate: number; taxPct: number; qty: number; amount: number }[] = [];

    for (const reqItem of data.items) {
      const row: any = itemById.get(reqItem.invoiceItemId);
      if (!row || row.product_id !== reqItem.productId) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Invoice item ${reqItem.invoiceItemId} not found on this invoice` });
        return;
      }
      const returnQty = Number(reqItem.qty);
      if (!(returnQty > 0)) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Return quantity for ${row.product_name} must be greater than 0` });
        return;
      }
      const originalQty = Number(row.qty);
      const alreadyReturnedQty = Number(row.already_returned_qty);
      const returnableQty = originalQty - alreadyReturnedQty;
      if (returnQty > returnableQty + 0.0001) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Cannot return ${returnQty} of ${row.product_name} — only ${returnableQty} still returnable` });
        return;
      }

      const originalAmount = Number(row.amount);
      const taxPct = Number(row.tax_pct);
      const unitAmount = originalQty > 0 ? originalAmount / originalQty : 0;
      const lineAmount = Math.round(unitAmount * returnQty * 100) / 100;
      const lineTaxable = Math.round((lineAmount / (1 + taxPct / 100)) * 100) / 100;
      const lineTax = Math.round((lineAmount - lineTaxable) * 100) / 100;

      subtotal += lineTaxable;
      totalTax += lineTax;
      grandTotal += lineAmount;
      lines.push({
        invoiceItemId: reqItem.invoiceItemId,
        productId: row.product_id,
        productName: row.product_name,
        unit: row.unit,
        rate: Number(row.rate),
        taxPct,
        qty: returnQty,
        amount: lineAmount,
      });
    }

    if (lines.length === 0) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "At least one item must be returned" });
      return;
    }

    const returnNo = await generateSeriesNumber(client, "sale_return", companyId);

    const headerRes = await client.query(
      `INSERT INTO sales_returns
         (company_id, return_no, invoice_id, invoice_no, customer_id, customer_name, reason,
          subtotal, total_tax, grand_total, status, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'saved',$11)
       RETURNING *`,
      [companyId, returnNo, inv.id, inv.invoice_no, inv.customer_id, inv.customer_name, data.reason ?? null, subtotal, totalTax, grandTotal, auth.userId],
    );
    const returnRow = headerRes.rows[0];

    const insertedItems: any[] = [];
    for (const line of lines) {
      const itemRes = await client.query(
        `INSERT INTO sales_return_items
           (company_id, return_id, invoice_item_id, product_id, product_name, qty, unit, rate, tax_pct, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [companyId, returnRow.id, line.invoiceItemId, line.productId, line.productName, line.qty, line.unit, line.rate, line.taxPct, line.amount],
      );
      insertedItems.push(itemRes.rows[0]);

      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'inward', $3, 'Sales return', $4, 'sales_return', $5)`,
        [companyId, line.productId, line.qty, returnRow.id, auth.userId],
      );
      await client.query(
        `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`,
        [line.qty, line.productId, companyId],
      );
    }

    if (inv.customer_id) {
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE id = $2 AND company_id = $3`,
        [grandTotal, inv.customer_id, companyId],
      );
      const balRes = await client.query(
        `SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`,
        [inv.customer_id, companyId],
      );
      const newBalance = Number(balRes.rows[0]?.outstanding_balance ?? 0);
      await client.query(
        `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
         VALUES ($1, $2, NOW(), $3, 0, $4, $5, 'sales_return', $6, $7)`,
        [companyId, inv.customer_id, `Sales return ${returnNo} (Inv ${inv.invoice_no})`, grandTotal, newBalance, returnRow.id, returnNo],
      );
    }

    await client.query("COMMIT");

    const creatorRes = await pool.query(`SELECT name FROM users WHERE id = $1`, [auth.userId]);
    res.status(201).json(formatSalesReturn(returnRow, insertedItems, creatorRes.rows[0]?.name ?? null));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to create sales return");
    res.status(500).json({ error: "Failed to create sales return" });
  } finally {
    client.release();
  }
});

// GET /sales-returns/:id
router.get("/sales-returns/:id", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, SALES_RETURN_READ_ROLES);
  if (!auth) return;
  const parsed = GetSalesReturnParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  try {
    const headerRes = await pool.query(
      `SELECT * FROM sales_returns WHERE id = $1 AND company_id = $2`,
      [parsed.data.id, companyId],
    );
    const row = headerRes.rows[0];
    if (!row) {
      res.status(404).json({ error: "Sales return not found" });
      return;
    }
    const itemsRes = await pool.query(
      `SELECT * FROM sales_return_items WHERE return_id = $1 AND company_id = $2 ORDER BY id ASC`,
      [parsed.data.id, companyId],
    );
    let createdByName: string | null = null;
    if (row.created_by_user_id != null) {
      const creatorRes = await pool.query(`SELECT name FROM users WHERE id = $1`, [row.created_by_user_id]);
      createdByName = creatorRes.rows[0]?.name ?? null;
    }
    res.json(formatSalesReturn(row, itemsRes.rows, createdByName));
  } catch (err) {
    logger.error({ err }, "Failed to fetch sales return");
    res.status(500).json({ error: "Failed to fetch sales return" });
  }
});

export default router;
