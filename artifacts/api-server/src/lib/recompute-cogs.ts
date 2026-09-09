// Re-derives invoice_items.cost_price from the date-effective purchase / BOM
// cost as of each invoice's own date. Used both as an admin-triggered
// "Recompute COGS" action over a date range and as a best-effort self-heal
// after a purchase bill is saved/edited (so a bill entered late still flows
// into the margin of sales that happened after its bill_date).
import { pool } from "@workspace/db";
import { loadCostInputs, computeCostAsOf } from "./date-effective-cost";

export interface CogsRecomputeResult {
  invoicesTouched: number;
  itemsChanged: number;
  oldCogs: number;
  newCogs: number;
}

interface Opts {
  apply: boolean;
  /** Restrict to invoices that contain at least one of these products. */
  productIds?: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function recomputeCogs(
  companyId: number,
  from: Date | null,
  to: Date | null,
  opts: Opts,
): Promise<CogsRecomputeResult> {
  const params: any[] = [companyId];
  const clauses: string[] = [
    `ii.company_id = $1`,
    `i.status = 'saved'`,
    `i.invoice_type <> 'quotation'`,
  ];
  if (from) {
    params.push(from);
    clauses.push(`i.invoice_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    clauses.push(`i.invoice_date <= $${params.length}`);
  }
  if (opts.productIds && opts.productIds.length > 0) {
    params.push(opts.productIds);
    // Any line on the invoice matching keeps the whole invoice in scope, so a
    // recompute triggered by one raw material still re-costs sibling lines
    // whose own recipes moved for the same reason.
    clauses.push(
      `i.id IN (SELECT invoice_id FROM invoice_items WHERE company_id = $1 AND product_id = ANY($${params.length}))`,
    );
  }

  const rows = (
    await pool.query(
      `SELECT ii.id, ii.product_id, ii.qty, ii.cost_price, i.id AS invoice_id, i.invoice_date
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE ${clauses.join(" AND ")}`,
      params,
    )
  ).rows;

  if (rows.length === 0) {
    return { invoicesTouched: 0, itemsChanged: 0, oldCogs: 0, newCogs: 0 };
  }

  const inputs = await loadCostInputs(companyId);
  // Live purchase_price per product — the same fallback the P&L / bill-wise
  // reports apply for rows whose cost_price is still null, so the "before"
  // COGS below matches what those reports actually show today.
  const livePriceById = new Map<number, number>(
    inputs.products.map((p) => [p.id, Number(p.purchasePrice) || 0]),
  );

  // One cost map per distinct invoice timestamp.
  const datesSeen = new Map<string, Date>();
  for (const r of rows) {
    const d = new Date(r.invoice_date);
    datesSeen.set(d.toISOString(), d);
  }
  const costByDate = new Map<string, Map<number, number>>();
  for (const [key, d] of datesSeen) {
    costByDate.set(key, await computeCostAsOf(companyId, d, inputs));
  }

  const updates: { id: number; newCost: number }[] = [];
  const touchedInvoices = new Set<number>();
  let oldCogs = 0;
  let newCogs = 0;

  for (const r of rows) {
    const key = new Date(r.invoice_date).toISOString();
    const pid = Number(r.product_id);
    const qty = Number(r.qty);
    const oldCost = r.cost_price != null ? Number(r.cost_price) : null;

    // Undefined ⇒ the product isn't in the company's master at all (should not
    // happen). Never coerce that to 0 — leaving a real snapshot untouched is
    // always safer than zeroing a line's historical cost.
    const computed = costByDate.get(key)!.get(pid);
    if (computed == null) continue;
    const newCost = round2(computed);

    // "before" uses the same cost_price → live purchase_price fallback the
    // reports use, so the preview's old vs new totals are comparable.
    oldCogs += qty * (oldCost ?? livePriceById.get(pid) ?? 0);
    newCogs += qty * newCost;

    if (oldCost == null || Math.abs(newCost - oldCost) > 0.004) {
      updates.push({ id: r.id, newCost });
      touchedInvoices.add(r.invoice_id);
    }
  }

  if (opts.apply && updates.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const u of updates) {
        await client.query(
          `UPDATE invoice_items SET cost_price = $1 WHERE id = $2 AND company_id = $3`,
          [u.newCost, u.id, companyId],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    invoicesTouched: touchedInvoices.size,
    itemsChanged: updates.length,
    oldCogs: round2(oldCogs),
    newCogs: round2(newCogs),
  };
}

// Every finished product whose recipe uses any of `materialIds`, directly or
// transitively — the set whose COGS a raw-material rate change can move.
export async function expandToBomParents(
  companyId: number,
  materialIds: number[],
): Promise<number[]> {
  if (materialIds.length === 0) return [];
  const bomRows = (
    await pool.query(
      `SELECT b.finished_product_id, bi.material_product_id
         FROM boms b
         JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
        WHERE b.company_id = $1`,
      [companyId],
    )
  ).rows as { finished_product_id: number; material_product_id: number }[];

  const parentsOf = new Map<number, number[]>();
  for (const r of bomRows) {
    const list = parentsOf.get(r.material_product_id) ?? [];
    list.push(r.finished_product_id);
    parentsOf.set(r.material_product_id, list);
  }

  const result = new Set<number>(materialIds);
  const queue = [...materialIds];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const parent of parentsOf.get(cur) ?? []) {
      if (!result.has(parent)) {
        result.add(parent);
        queue.push(parent);
      }
    }
  }
  return [...result];
}
