import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";
import { roleAllowed } from "../lib/role-guard";

// Manufacturing → Assemble Item → Assembly History. Every Assemble Item run
// is a workload_cards row (status 'done', order_type 'production') with its
// raw-material stock_movements (type manufacturing_consume, reference_type
// 'workload', reference_id = card id); the output went to Ready Material.
// Auto-manufacture rows share that shape but carry worker_name "Auto — …",
// so they are left out here.
//
// Editing a run's quantity scales what it took: each raw material it
// consumed is consumed further (or given back) in the same proportion, and
// the change in output goes to the product's Ready Material line — the same
// place the original output went. Deleting is an edit to zero plus removing
// the run.

const router: IRouter = Router();

const ASSEMBLY_WHERE = `
  w.company_id = $1 AND w.status = 'done' AND w.order_type = 'production'
  AND (w.worker_name IS NULL OR w.worker_name NOT LIKE 'Auto — %')`;

const istDate = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function canView(req: Request): boolean {
  return roleAllowed((req as any).session?.role, ["admin", "manufacturing"]);
}
function isAdmin(req: Request): boolean {
  return roleAllowed((req as any).session?.role, ["admin"]);
}

function formatRow(r: any) {
  const qty = Number(r.target_qty);
  const lpu = r.liters_per_box != null ? Number(r.liters_per_box) : null;
  return {
    id: r.id,
    date: r.day,
    at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    productId: r.product_id,
    productName: r.product_name ?? "",
    unit: r.unit ?? "",
    qty,
    liters: lpu != null ? Math.round(qty * lpu * 1000) / 1000 : null,
    batches: r.batches != null ? Number(r.batches) : null,
    bomId: r.bom_id ?? null,
    workerId: r.worker_id ?? null,
    workerName: r.worker_name ?? null,
  };
}

// GET /manufacturing/assemblies?from=YYYY-MM-DD&to=YYYY-MM-DD&productId=&workerId=
router.get("/manufacturing/assemblies", async (req, res): Promise<void> => {
  if (!canView(req)) {
    res.status(403).json({ error: "You don't have access to this." });
    return;
  }
  const companyId = getCompanyId(req);
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) {
    res.status(400).json({ error: "Dates must be YYYY-MM-DD" });
    return;
  }
  const params: unknown[] = [companyId];
  let where = ASSEMBLY_WHERE;
  if (from) { params.push(from); where += ` AND ${istDate("w.completed_at")} >= $${params.length}`; }
  if (to) { params.push(to); where += ` AND ${istDate("w.completed_at")} <= $${params.length}`; }
  const productId = Number(req.query.productId);
  if (Number.isInteger(productId) && productId > 0) { params.push(productId); where += ` AND w.product_id = $${params.length}`; }
  const workerId = Number(req.query.workerId);
  if (Number.isInteger(workerId) && workerId > 0) { params.push(workerId); where += ` AND w.worker_id = $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT w.id, w.product_id, w.target_qty, w.batches, w.bom_id, w.worker_id, w.worker_name, w.completed_at,
            ${istDate("w.completed_at")} AS day, p.name AS product_name, p.unit, p.liters_per_box
       FROM workload_cards w
       LEFT JOIN products p ON p.id = w.product_id AND p.company_id = w.company_id
      WHERE ${where}
      ORDER BY w.completed_at DESC, w.id DESC
      LIMIT 2000`,
    params,
  );
  res.json(rows.map(formatRow));
});

async function loadRun(client: any, companyId: number, id: number) {
  const { rows } = await client.query(
    `SELECT w.* FROM workload_cards w WHERE ${ASSEMBLY_WHERE} AND w.id = $2 FOR UPDATE`,
    [companyId, id],
  );
  return rows[0];
}

// Change a run's output from oldQty to newQty: raw materials scale by the same
// factor, the output difference lands on the product's Ready Material line.
async function rescaleRun(client: any, companyId: number, run: any, newQty: number, newBatches: number | null, userId: number, note: string) {
  const oldQty = Number(run.target_qty);
  const delta = newQty - oldQty;
  if (Math.abs(delta) < 1e-9) return;
  const factor = oldQty > 0 ? newQty / oldQty : 0;

  const { rows: used } = await client.query(
    `SELECT product_id, SUM(quantity) AS qty FROM stock_movements
      WHERE company_id = $1 AND reference_type = 'workload' AND reference_id = $2 AND type = 'manufacturing_consume'
      GROUP BY product_id`,
    [companyId, run.id],
  );
  for (const u of used) {
    const change = Number(u.qty) * (factor - 1);
    if (Math.abs(change) < 1e-9) continue;
    await client.query(
      `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
       VALUES ($1, $2, 'manufacturing_consume', $3, $4, $5, 'workload', $6)`,
      [companyId, u.product_id, change, note, run.id, userId],
    );
    await client.query(
      `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`,
      [change, u.product_id, companyId],
    );
  }

  const batchDelta = newBatches != null && run.batches != null ? newBatches - Number(run.batches) : 0;
  const { rows: ready } = await client.query(
    `SELECT id, qty, batches FROM ready_material_batches
      WHERE company_id = $1 AND product_id = $2 AND status = 'ready'
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
    [companyId, run.product_id],
  );
  if (ready[0]) {
    const merged = Number(ready[0].qty) + delta;
    await client.query(
      `UPDATE ready_material_batches
          SET qty = $1, batches = GREATEST(batches + $2, 0), adjustment_reason = $3, updated_at = NOW()
        WHERE id = $4`,
      [merged, batchDelta, note, ready[0].id],
    );
  } else {
    const { rows: [p] } = await client.query(
      `SELECT name, unit FROM products WHERE id = $1 AND company_id = $2`,
      [run.product_id, companyId],
    );
    await client.query(
      `INSERT INTO ready_material_batches
         (company_id, bom_id, product_id, product_name, unit, qty, batches, worker_id, worker_name, workload_card_id, created_by_user_id, adjustment_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [companyId, run.bom_id ?? null, run.product_id, p?.name ?? "", p?.unit ?? "QTY", delta, Math.max(batchDelta, 0),
       run.worker_id ?? null, run.worker_name ?? "", run.id, userId, note],
    );
  }
}

async function inTxn(res: Response, label: string, fn: (client: any) => Promise<boolean>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const ok = await fn(client);
    await client.query(ok ? "COMMIT" : "ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, label);
    if (!res.headersSent) res.status(500).json({ error: `${label} — nothing was changed` });
  } finally {
    client.release();
  }
}

// PATCH /manufacturing/assemblies/:id { batches? | qty?, date?, workerId? } — admin only.
router.patch("/manufacturing/assemblies/:id", async (req, res): Promise<void> => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Only an admin can edit an assembly" });
    return;
  }
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  const body = req.body ?? {};
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  if (body.date != null && !DATE_RE.test(String(body.date))) {
    res.status(400).json({ error: "date must be YYYY-MM-DD" });
    return;
  }
  const userId = (req as any).session?.userId ?? 0;

  await inTxn(res, "Failed to edit assembly", async (client) => {
    const run = await loadRun(client, companyId, id);
    if (!run) {
      res.status(404).json({ error: "Assembly not found" });
      return false;
    }
    const oldQty = Number(run.target_qty);
    let newQty = oldQty;
    let newBatches: number | null = run.batches != null ? Number(run.batches) : null;
    if (body.batches != null) {
      const b = Number(body.batches);
      if (!Number.isFinite(b) || b <= 0 || run.batches == null || Number(run.batches) <= 0) {
        res.status(400).json({ error: run.batches == null ? "This older entry has no batch count — change the quantity instead" : "Batches must be more than 0" });
        return false;
      }
      newQty = Math.round((oldQty / Number(run.batches)) * b * 1000) / 1000;
      newBatches = b;
    } else if (body.qty != null) {
      const q = Number(body.qty);
      if (!Number.isFinite(q) || q <= 0) {
        res.status(400).json({ error: "Quantity must be more than 0" });
        return false;
      }
      newQty = q;
      if (newBatches != null && oldQty > 0) newBatches = Math.round((newBatches * q / oldQty) * 1000) / 1000;
    }

    let worker: { id: number; name: string } | null = null;
    if (body.workerId != null) {
      const { rows } = await client.query(`SELECT id, name FROM workers WHERE id = $1 AND company_id = $2`, [Number(body.workerId), companyId]);
      if (!rows[0]) {
        res.status(400).json({ error: "Worker not found" });
        return false;
      }
      worker = rows[0];
    }

    const note = `Assembly #${id} edited: ${oldQty} → ${newQty}`;
    await rescaleRun(client, companyId, run, newQty, newBatches, userId, note);
    await client.query(
      `UPDATE workload_cards
          SET target_qty = $1, batches = $2,
              completed_at = CASE WHEN $3::text IS NULL THEN completed_at
                                  ELSE (($3::text || ' ' || to_char(completed_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS'))::timestamp AT TIME ZONE 'Asia/Kolkata') END,
              worker_id = COALESCE($4, worker_id), worker_name = COALESCE($5, worker_name), updated_at = NOW()
        WHERE id = $6 AND company_id = $7`,
      [String(newQty), newBatches, body.date ?? null, worker?.id ?? null, worker?.name ?? null, id, companyId],
    );
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, "assembly_edited", note, userId, (req as any).session?.name ?? "Admin",
       JSON.stringify({ id, oldQty, newQty, date: body.date ?? null, workerId: worker?.id ?? null })],
    );
    const { rows } = await client.query(
      `SELECT w.id, w.product_id, w.target_qty, w.batches, w.bom_id, w.worker_id, w.worker_name, w.completed_at,
              ${istDate("w.completed_at")} AS day, p.name AS product_name, p.unit, p.liters_per_box
         FROM workload_cards w LEFT JOIN products p ON p.id = w.product_id AND p.company_id = w.company_id
        WHERE w.id = $1 AND w.company_id = $2`,
      [id, companyId],
    );
    res.json(formatRow(rows[0]));
    return true;
  });
});

// DELETE /manufacturing/assemblies/:id — admin only. Gives the raw materials
// back and takes the output off Ready Material, then removes the run.
router.delete("/manufacturing/assemblies/:id", async (req, res): Promise<void> => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Only an admin can delete an assembly" });
    return;
  }
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const userId = (req as any).session?.userId ?? 0;
  await inTxn(res, "Failed to delete assembly", async (client) => {
    const run = await loadRun(client, companyId, id);
    if (!run) {
      res.status(404).json({ error: "Assembly not found" });
      return false;
    }
    const note = `Assembly #${id} deleted (${Number(run.target_qty)})`;
    await rescaleRun(client, companyId, run, 0, run.batches != null ? 0 : null, userId, note);
    await client.query(`DELETE FROM workload_cards WHERE id = $1 AND company_id = $2`, [id, companyId]);
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, "assembly_deleted", note, userId, (req as any).session?.name ?? "Admin", JSON.stringify({ id, qty: Number(run.target_qty) })],
    );
    res.sendStatus(204);
    return true;
  });
});

export default router;
