import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

interface MaterialTransferItemInput {
  productId: number;
  qty: number;
  unit: string;
}

async function queryOne(text: string, params: any[] = []): Promise<any> {
  const result = await pool.query(text, params);
  return result.rows[0] ?? {};
}

async function queryMany(text: string, params: any[] = []): Promise<any[]> {
  const result = await pool.query(text, params);
  return result.rows;
}

// GET /material-transfers — list, most recent first, with item count.
router.get("/material-transfers", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const rows = await queryMany(
    `SELECT
       mt.id, mt.transfer_no, mt.transfer_date, mt.sent_by, mt.notes, mt.created_at,
       COUNT(mti.id) AS item_count
     FROM material_transfers mt
     LEFT JOIN material_transfer_items mti ON mti.transfer_id = mt.id
     WHERE mt.company_id = $1
     GROUP BY mt.id
     ORDER BY mt.transfer_date DESC, mt.id DESC
     LIMIT 200`,
    [companyId],
  );

  res.json(rows.map((r) => ({
    id: r.id,
    transferNo: r.transfer_no,
    transferDate: new Date(r.transfer_date).toISOString(),
    sentBy: r.sent_by ?? null,
    notes: r.notes ?? null,
    itemCount: Number(r.item_count),
    createdAt: new Date(r.created_at).toISOString(),
  })));
});

// GET /material-transfers/:id — full detail with line items, for viewing/print.
router.get("/material-transfers/:id", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const header = await queryOne(
    `SELECT id, transfer_no, transfer_date, sent_by, notes, created_at
     FROM material_transfers WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );
  if (!header.id) {
    res.status(404).json({ error: "Material transfer not found" });
    return;
  }

  const items = await queryMany(
    `SELECT product_id, product_name, qty, unit
     FROM material_transfer_items WHERE company_id = $1 AND transfer_id = $2
     ORDER BY id ASC`,
    [companyId, id],
  );

  res.json({
    id: header.id,
    transferNo: header.transfer_no,
    transferDate: new Date(header.transfer_date).toISOString(),
    sentBy: header.sent_by ?? null,
    notes: header.notes ?? null,
    createdAt: new Date(header.created_at).toISOString(),
    items: items.map((it) => ({
      productId: Number(it.product_id),
      productName: it.product_name,
      qty: Number(it.qty),
      unit: it.unit,
    })),
  });
});

// POST /material-transfers — manual slip a worker creates directly, without
// going through a Ready Material batch (e.g. material was physically sent
// before the assembly/dispatch paperwork caught up). Unlike a ready-batch
// dispatch (which credits stock), a manual transfer here DEDUCTS the product's
// current_stock — it represents stock leaving. Deliberately NOT blocked on
// insufficient stock: if the worker sends more than what's actually assembled
// yet, current_stock is allowed to go negative as a visible flag. It self-
// corrects once the shortfall is assembled and dispatched normally.
router.post("/material-transfers", async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const auth = (req as any).session;
  const userId = auth?.userId ?? 1;
  const body = req.body as {
    transferDate?: string;
    sentBy?: string;
    notes?: string;
    items?: MaterialTransferItemInput[];
  };

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: "At least one item is required" });
    return;
  }
  for (const [idx, it] of items.entries()) {
    if (!it.productId || !Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) {
      res.status(400).json({ error: `Line ${idx + 1}: product and a positive qty are required` });
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Allocate the next transfer number for this company.
    await client.query(
      `INSERT INTO material_transfer_sequence (company_id, last_number)
       VALUES ($1, 0)
       ON CONFLICT (company_id) DO NOTHING`,
      [companyId],
    );
    const seqRes = await client.query(
      `UPDATE material_transfer_sequence SET last_number = last_number + 1
       WHERE company_id = $1
       RETURNING last_number`,
      [companyId],
    );
    const seq = Number(seqRes.rows[0].last_number);
    const transferNo = `MT-${String(seq).padStart(3, "0")}`;

    const headerRes = await client.query(
      `INSERT INTO material_transfers (company_id, transfer_no, transfer_date, sent_by, notes, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, transfer_no, transfer_date, sent_by, notes, created_at`,
      [
        companyId,
        transferNo,
        body.transferDate ? new Date(body.transferDate) : new Date(),
        body.sentBy?.trim() || null,
        body.notes?.trim() || null,
        userId,
      ],
    );
    const header = headerRes.rows[0];

    const savedItems: { productId: number; productName: string; qty: number; unit: string }[] = [];
    for (const item of items) {
      const prodRes = await client.query(
        `SELECT name FROM products WHERE company_id = $1 AND id = $2`,
        [companyId, item.productId],
      );
      if (prodRes.rows.length === 0) {
        throw new Error(`Product ${item.productId} not found`);
      }
      const productName = prodRes.rows[0].name;
      await client.query(
        `INSERT INTO material_transfer_items (company_id, transfer_id, product_id, product_name, qty, unit)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, header.id, item.productId, productName, item.qty, item.unit || "QTY"],
      );

      // Deduct stock — allowed to go negative on purpose (see comment above).
      await client.query(
        `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`,
        [item.qty, item.productId, companyId],
      );
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'manufacturing_transfer', $3, 'Manual material transfer', $4, 'material_transfer', $5)`,
        [companyId, item.productId, -Number(item.qty), header.id, userId],
      );

      savedItems.push({ productId: item.productId, productName, qty: Number(item.qty), unit: item.unit || "QTY" });
    }

    await client.query("COMMIT");

    res.status(201).json({
      id: header.id,
      transferNo: header.transfer_no,
      transferDate: new Date(header.transfer_date).toISOString(),
      sentBy: header.sent_by ?? null,
      notes: header.notes ?? null,
      createdAt: new Date(header.created_at).toISOString(),
      items: savedItems,
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: err?.message ?? "Failed to create material transfer" });
  } finally {
    client.release();
  }
});

// DELETE /material-transfers/:id — admin only.
router.delete("/material-transfers/:id", async (req, res): Promise<void> => {
  const role = (req as any).session?.role;
  if (role !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const result = await pool.query(
    `DELETE FROM material_transfers WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );
  if (result.rowCount === 0) {
    res.status(404).json({ error: "Material transfer not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
