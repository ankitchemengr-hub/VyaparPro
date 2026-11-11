import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { todayIst } from "../lib/books";

// Batch & Expiry (Books & Audit). Batches are entered against a purchase
// bill's items (one batch per item line) or as opening batches for stock
// already on hand. What is left of each batch is worked out from the
// product's stock, not tracked sale by sale: selling goes earliest expiry
// first, so the stock on hand is taken to be in the batches that expire
// last. Billing therefore needs no batch picking.
const router: IRouter = Router();

const READ_ROLES = new Set(["admin", "accountant", "super_admin"]);
const WRITE_ROLES = new Set(["admin", "super_admin"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class BatchError extends Error {}

function allowed(req: any, res: any, roles: Set<string>): boolean {
  if (!roles.has(req.session?.role)) {
    res.status(403).json({ error: roles === WRITE_ROLES ? "Only admin can do this" : "Forbidden" });
    return false;
  }
  return true;
}

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const dateOrNull = (v: unknown) => (DATE_RE.test(String(v ?? "")) ? String(v) : null);

// GET /batches — every batch with what is left of it and its expiry state.
router.get("/batches", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.product_id, p.name AS product_name, p.unit, p.current_stock::float AS stock, b.batch_no,
              b.mfg_date::text AS mfg, b.expiry_date::text AS expiry, b.qty::float AS qty, b.bill_no, b.purchase_id
         FROM product_batches b JOIN products p ON p.id = b.product_id AND p.company_id = b.company_id
        WHERE b.company_id = $1
        ORDER BY b.product_id, b.expiry_date DESC NULLS FIRST, b.created_at DESC, b.id DESC`,
      [companyId],
    );
    const today = todayIst();
    const leftOf = new Map<number, number>();
    const out = rows.map((b: any) => {
      // Stock fills the latest-expiring batches first (rows are in that order).
      const remaining = leftOf.has(b.product_id) ? leftOf.get(b.product_id)! : Math.max(0, b.stock);
      const left = r3(Math.min(b.qty, remaining));
      leftOf.set(b.product_id, r3(remaining - left));
      const days = b.expiry ? Math.round((Date.parse(`${b.expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : null;
      const state = days == null ? "none" : days < 0 ? "expired" : days <= 30 ? "soon" : days <= 90 ? "later" : "ok";
      return {
        id: b.id, productId: b.product_id, productName: b.product_name, unit: b.unit, batchNo: b.batch_no,
        mfgDate: b.mfg ?? null, expiryDate: b.expiry ?? null, qty: b.qty, left, billNo: b.bill_no ?? null, purchaseId: b.purchase_id ?? null,
        daysToExpiry: days, state,
      };
    });
    const live = out.filter((b: any) => b.left > 0);
    res.json({
      batches: out,
      summary: {
        expired: live.filter((b: any) => b.state === "expired").length,
        soon: live.filter((b: any) => b.state === "soon").length,
        later: live.filter((b: any) => b.state === "later").length,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /batches failed");
    res.status(500).json({ error: "Could not load batches" });
  }
});

// GET /batches/purchase/:id — a purchase bill's items with their batch, if entered.
router.get("/batches/purchase/:id", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  try {
    const bill = (await pool.query(
      `SELECT id, bill_no, vendor_name, bill_date::date::text AS date FROM purchases WHERE company_id = $1 AND id = $2`,
      [companyId, id],
    )).rows[0];
    if (!bill) { res.status(404).json({ error: "Purchase bill not found" }); return; }
    const { rows } = await pool.query(
      `SELECT i.id, i.product_id, i.product_name, i.qty::float AS qty, i.unit,
              b.id AS batch_id, b.batch_no, b.mfg_date::text AS mfg, b.expiry_date::text AS expiry, b.qty::float AS batch_qty
         FROM purchase_items i
         LEFT JOIN product_batches b ON b.company_id = i.company_id AND b.purchase_item_id = i.id
        WHERE i.company_id = $1 AND i.purchase_id = $2 ORDER BY i.id`,
      [companyId, id],
    );
    res.json({
      id: bill.id, billNo: bill.bill_no, vendorName: bill.vendor_name ?? null, date: bill.date,
      items: rows.map((r: any) => ({
        purchaseItemId: r.id, productId: r.product_id, productName: r.product_name, qty: r.qty, unit: r.unit,
        batch: r.batch_id ? { id: r.batch_id, batchNo: r.batch_no, mfgDate: r.mfg ?? null, expiryDate: r.expiry ?? null, qty: r.batch_qty } : null,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /batches/purchase failed");
    res.status(500).json({ error: "Could not load the bill" });
  }
});

// POST /batches { purchaseId?, items: [{ productId, purchaseItemId?, batchNo, mfgDate?, expiryDate?, qty }] }
// A purchase item's batch replaces the one entered for it before.
router.post("/batches", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 300) : [];
  const purchaseId = req.body?.purchaseId ? Number(req.body.purchaseId) : null;
  const user = (req as any).session?.name ?? (req as any).session?.username ?? null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!items.length) throw new BatchError("Nothing to save");
    let billNo: string | null = null;
    if (purchaseId) {
      const bill = (await client.query(`SELECT bill_no FROM purchases WHERE company_id = $1 AND id = $2`, [companyId, purchaseId])).rows[0];
      if (!bill) throw new BatchError("Purchase bill not found");
      billNo = bill.bill_no;
    }
    let saved = 0;
    for (const it of items) {
      const batchNo = text(it?.batchNo, 40);
      const expiry = dateOrNull(it?.expiryDate);
      const mfg = dateOrNull(it?.mfgDate);
      let productId = Number(it?.productId);
      let qty = r3(Number(it?.qty));
      let itemId: number | null = null;
      if (purchaseId && it?.purchaseItemId) {
        const pi = (await client.query(
          `SELECT id, product_id, qty::float AS qty FROM purchase_items WHERE company_id = $1 AND purchase_id = $2 AND id = $3`,
          [companyId, purchaseId, Number(it.purchaseItemId)],
        )).rows[0];
        if (!pi) throw new BatchError("That item is not on this bill");
        itemId = pi.id;
        productId = pi.product_id;
        if (!(qty > 0)) qty = pi.qty;
        if (!batchNo && !expiry) {
          // Both cleared — the line no longer has a batch.
          await client.query(`DELETE FROM product_batches WHERE company_id = $1 AND purchase_item_id = $2`, [companyId, itemId]);
          continue;
        }
      }
      if (!batchNo) throw new BatchError("Enter the batch number");
      if (!(qty > 0)) throw new BatchError(`Batch ${batchNo}: enter the quantity`);
      if (mfg && expiry && mfg > expiry) throw new BatchError(`Batch ${batchNo}: expiry is before the manufacturing date`);
      const p = (await client.query(`SELECT id FROM products WHERE company_id = $1 AND id = $2`, [companyId, productId])).rows[0];
      if (!p) throw new BatchError("Item not found");
      if (itemId) await client.query(`DELETE FROM product_batches WHERE company_id = $1 AND purchase_item_id = $2`, [companyId, itemId]);
      await client.query(
        `INSERT INTO product_batches (company_id, product_id, batch_no, mfg_date, expiry_date, qty, purchase_id, purchase_item_id, bill_no, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [companyId, productId, batchNo, mfg, expiry, qty, itemId ? purchaseId : null, itemId, itemId ? billNo : null, user],
      );
      saved++;
    }
    await client.query("COMMIT");
    res.json({ saved });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof BatchError) { res.status(400).json({ error: err.message }); return; }
    logger.error({ err }, "POST /batches failed");
    res.status(500).json({ error: "Could not save — nothing was changed" });
  } finally {
    client.release();
  }
});

router.delete("/batches/:id", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const r = await pool.query(`DELETE FROM product_batches WHERE company_id = $1 AND id = $2 RETURNING id`, [companyId, Number(req.params.id)]);
  if (!r.rows.length) { res.status(404).json({ error: "Batch not found" }); return; }
  res.json({ ok: true });
});

export default router;
