import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { generateSeriesNumber } from "../lib/number-series";

// Debit Note — goods sent back to a supplier against one of their purchase
// bills. The mirror of a sales return: stock goes out, the supplier's
// outstanding comes down by the returned value (a credit on their ledger;
// below zero it is money they owe back), and Books & Audit takes it off
// Purchases and Input GST. Admin and accountant; only an admin cancels.
const router: IRouter = Router();

function allowed(req: any, res: any, adminOnly = false): boolean {
  const role = req.session?.role;
  if (role === "admin" || (!adminOnly && role === "accountant")) return true;
  res.status(403).json({ error: "Forbidden" });
  return false;
}
const r2 = (v: number) => Math.round(v * 100) / 100;

// Recent purchase bills to pick from, newest first.
router.get("/purchase-returns/bills", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const search = String(req.query.search ?? "").trim();
  try {
    const r = await pool.query(
      `SELECT id, bill_no, vendor_bill_no, bill_date, vendor_id, vendor_name, grand_total
       FROM purchases
       WHERE company_id = $1 AND status = 'saved' AND deleted_at IS NULL
         AND ($2 = '' OR bill_no ILIKE '%' || $2 || '%' OR vendor_bill_no ILIKE '%' || $2 || '%' OR vendor_name ILIKE '%' || $2 || '%')
       ORDER BY bill_date DESC, id DESC LIMIT 30`,
      [getCompanyId(req), search],
    );
    res.json(r.rows.map((b: any) => ({
      id: b.id, billNo: b.bill_no, vendorBillNo: b.vendor_bill_no, billDate: b.bill_date,
      vendorId: b.vendor_id, vendorName: b.vendor_name, grandTotal: Number(b.grand_total),
    })));
  } catch (err) {
    logger.error({ err }, "GET /purchase-returns/bills failed");
    res.status(500).json({ error: "Failed to load purchase bills" });
  }
});

const RETURNABLE_SQL = `
  SELECT pi.id, pi.product_id, pi.product_name, pi.unit, pi.rate, pi.tax_pct, pi.qty, pi.amount,
         COALESCE(ret.qty, 0) AS returned_qty, p.current_stock
  FROM purchase_items pi
  JOIN products p ON p.id = pi.product_id
  LEFT JOIN (
    SELECT pri.purchase_item_id, SUM(pri.qty) AS qty
    FROM purchase_return_items pri
    JOIN purchase_returns pr ON pr.id = pri.return_id
    WHERE pr.purchase_id = $1 AND pr.company_id = $2 AND pr.status = 'saved'
    GROUP BY pri.purchase_item_id
  ) ret ON ret.purchase_item_id = pi.id
  WHERE pi.purchase_id = $1 AND pi.company_id = $2`;

router.get("/purchase-returns/bills/:id/items", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid bill" }); return; }
  try {
    const r = await pool.query(`${RETURNABLE_SQL} ORDER BY pi.id`, [id, getCompanyId(req)]);
    res.json(r.rows.map((it: any) => ({
      purchaseItemId: it.id, productId: it.product_id, productName: it.product_name, unit: it.unit,
      rate: Number(it.rate), taxPct: Number(it.tax_pct), qty: Number(it.qty), amount: Number(it.amount),
      returnableQty: Math.max(0, Number(it.qty) - Number(it.returned_qty)), currentStock: Number(it.current_stock),
    })));
  } catch (err) {
    logger.error({ err }, "GET /purchase-returns/bills/:id/items failed");
    res.status(500).json({ error: "Failed to load bill items" });
  }
});

router.get("/purchase-returns", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const from = String(req.query.from ?? "1900-01-01");
  const to = String(req.query.to ?? "2999-12-31");
  try {
    const r = await pool.query(
      `SELECT pr.*, (pr.return_date AT TIME ZONE 'Asia/Kolkata')::date::text AS day, u.name AS created_by_name,
              COALESCE(json_agg(json_build_object('productName', pri.product_name, 'qty', pri.qty, 'unit', pri.unit, 'amount', pri.amount) ORDER BY pri.id)
                FILTER (WHERE pri.id IS NOT NULL), '[]') AS items
       FROM purchase_returns pr
       LEFT JOIN purchase_return_items pri ON pri.return_id = pr.id
       LEFT JOIN users u ON u.id = pr.created_by_user_id
       WHERE pr.company_id = $1 AND (pr.return_date AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date
       GROUP BY pr.id, u.name ORDER BY pr.return_date DESC, pr.id DESC`,
      [getCompanyId(req), from, to],
    );
    res.json(r.rows.map((x: any) => ({
      id: x.id, returnNo: x.return_no, date: x.day, purchaseId: x.purchase_id, billNo: x.bill_no,
      vendorName: x.vendor_name, reason: x.reason, subtotal: Number(x.subtotal), totalTax: Number(x.total_tax),
      grandTotal: Number(x.grand_total), status: x.status, createdByName: x.created_by_name,
      items: x.items.map((i: any) => ({ ...i, qty: Number(i.qty), amount: Number(i.amount) })),
    })));
  } catch (err) {
    logger.error({ err }, "GET /purchase-returns failed");
    res.status(500).json({ error: "Failed to load debit notes" });
  }
});

// Moves a vendor's outstanding by `delta` and writes the matching ledger line
// (ledger debit − credit always equals the change in outstanding).
async function postVendor(client: any, companyId: number, vendorId: number, delta: number, description: string, returnId: number, returnNo: string) {
  await client.query(`UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3`, [delta, vendorId, companyId]);
  const bal = await client.query(`SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`, [vendorId, companyId]);
  await client.query(
    `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, 'purchase_return', $7, $8)`,
    [companyId, vendorId, description, delta > 0 ? delta : 0, delta < 0 ? -delta : 0, bal.rows[0]?.outstanding_balance ?? 0, returnId, returnNo],
  );
}

router.post("/purchase-returns", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const purchaseId = Number(req.body?.purchaseId);
  const reason = String(req.body?.reason ?? "").trim().slice(0, 500) || null;
  const wanted: { purchaseItemId: number; qty: number }[] = (Array.isArray(req.body?.items) ? req.body.items : [])
    .map((i: any) => ({ purchaseItemId: Number(i?.purchaseItemId), qty: Number(i?.qty) }))
    .filter((i: any) => i.qty > 0);
  if (!Number.isInteger(purchaseId)) { res.status(400).json({ error: "Choose a purchase bill" }); return; }
  if (!wanted.length) { res.status(400).json({ error: "Enter the quantity to return for at least one item" }); return; }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const billRes = await client.query(
      `SELECT id, bill_no, vendor_id, vendor_name, status FROM purchases WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [purchaseId, companyId],
    );
    const bill = billRes.rows[0];
    if (!bill || bill.status !== "saved") {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Purchase bill not found or cancelled" });
      return;
    }
    const itemsRes = await client.query(RETURNABLE_SQL, [purchaseId, companyId]);
    const byId = new Map(itemsRes.rows.map((r: any) => [r.id, r]));

    let subtotal = 0, totalTax = 0, grandTotal = 0;
    const lines: any[] = [];
    for (const w of wanted) {
      const row: any = byId.get(w.purchaseItemId);
      if (!row) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: "An item is not on this bill" });
        return;
      }
      const returnable = Number(row.qty) - Number(row.returned_qty);
      if (w.qty > returnable + 0.0001) {
        await client.query("ROLLBACK");
        res.status(400).json({ error: `Only ${returnable} of ${row.product_name} can still be returned` });
        return;
      }
      const taxPct = Number(row.tax_pct);
      const amount = r2((Number(row.qty) > 0 ? Number(row.amount) / Number(row.qty) : 0) * w.qty);
      const taxable = r2(amount / (1 + taxPct / 100));
      subtotal += taxable;
      totalTax += r2(amount - taxable);
      grandTotal += amount;
      lines.push({ ...w, productId: row.product_id, productName: row.product_name, unit: row.unit, rate: Number(row.rate), taxPct, amount });
    }
    subtotal = r2(subtotal); totalTax = r2(totalTax); grandTotal = r2(grandTotal);

    const returnNo = await generateSeriesNumber(client, "purchase_return", companyId);
    const head = await client.query(
      `INSERT INTO purchase_returns (company_id, return_no, purchase_id, bill_no, vendor_id, vendor_name, reason, subtotal, total_tax, grand_total, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [companyId, returnNo, bill.id, bill.bill_no, bill.vendor_id, bill.vendor_name, reason, subtotal, totalTax, grandTotal, session?.userId ?? null],
    );
    const returnId = head.rows[0].id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO purchase_return_items (company_id, return_id, purchase_item_id, product_id, product_name, qty, unit, rate, tax_pct, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [companyId, returnId, l.purchaseItemId, l.productId, l.productName, l.qty, l.unit, l.rate, l.taxPct, l.amount],
      );
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'outward', $3, 'Purchase return', $4, 'purchase_return', $5)`,
        [companyId, l.productId, l.qty, returnId, session?.userId ?? null],
      );
      await client.query(`UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`, [l.qty, l.productId, companyId]);
    }
    if (bill.vendor_id) {
      await postVendor(client, companyId, bill.vendor_id, -grandTotal, `Purchase return ${returnNo} (Bill ${bill.bill_no})`, returnId, returnNo);
    }
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, 'purchase_return_created', $2, $3, $4, $5)`,
      [companyId, `Debit note ${returnNo} for bill ${bill.bill_no}: ₹${grandTotal}`, session?.userId ?? 1, session?.name ?? "Unknown",
        JSON.stringify({ returnId, returnNo, purchaseId, lines })],
    );
    await client.query("COMMIT");
    res.status(201).json({ id: returnId, returnNo, grandTotal });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "POST /purchase-returns failed");
    res.status(500).json({ error: "Failed to save debit note" });
  } finally {
    client.release();
  }
});

// Cancelling puts the stock back and the supplier's dues back up.
router.post("/purchase-returns/:id/cancel", async (req, res): Promise<void> => {
  if (!allowed(req, res, true)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid debit note" }); return; }
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE purchase_returns SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1 AND company_id = $2 AND status = 'saved' RETURNING *`,
      [id, companyId],
    );
    const pr = r.rows[0];
    if (!pr) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Debit note not found or already cancelled" });
      return;
    }
    const items = await client.query(`SELECT product_id, qty FROM purchase_return_items WHERE return_id = $1 AND company_id = $2`, [id, companyId]);
    for (const it of items.rows) {
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'inward', $3, 'Purchase return cancelled', $4, 'purchase_return', $5)`,
        [companyId, it.product_id, it.qty, id, session?.userId ?? null],
      );
      await client.query(`UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`, [it.qty, it.product_id, companyId]);
    }
    if (pr.vendor_id) {
      await postVendor(client, companyId, pr.vendor_id, Number(pr.grand_total), `Purchase return ${pr.return_no} cancelled`, id, pr.return_no);
    }
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, 'purchase_return_cancelled', $2, $3, $4, $5)`,
      [companyId, `Debit note ${pr.return_no} cancelled (₹${pr.grand_total})`, session?.userId ?? 1, session?.name ?? "Unknown", JSON.stringify({ id })],
    );
    await client.query("COMMIT");
    res.json({ id });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "POST /purchase-returns/:id/cancel failed");
    res.status(500).json({ error: "Failed to cancel debit note" });
  } finally {
    client.release();
  }
});

export default router;
