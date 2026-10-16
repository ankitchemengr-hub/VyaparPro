// Auto-manufacture on sale: a product we make (has a BOM) should never go
// negative just because the production entry wasn't made before it was
// sold — if it was sold, it was made. When a sale needs more than is in
// stock, the shortfall is covered first from Ready Material (made but not
// yet dispatched to store), and whatever is still short is treated as
// manufactured right now: the BOM's raw materials are deducted for that
// quantity and the finished stock is credited, so the sale lands the
// product at zero instead of below it. Same idea as Material Transfer's
// consumeReadyStockOrAutoAssemble. Raw materials may still go negative —
// that is the real shortage, and shows up for purchasing.
//
// Products without a BOM (bought-in / resale items) are never touched.

type Client = { query: (text: string, params?: any[]) => Promise<any> };

export const AUTO_MANUFACTURE_KEY = "auto_manufacture_on_sale";

// On unless the company switched it off.
export async function isAutoManufactureEnabled(client: Client, companyId: number): Promise<boolean> {
  const r = await client.query(
    `SELECT value FROM app_settings WHERE company_id = $1 AND key = $2`,
    [companyId, AUTO_MANUFACTURE_KEY],
  );
  return r.rows[0]?.value !== "false";
}

export interface ShortfallCover {
  productId: number;
  productName: string;
  unit: string;
  shortfall: number;
  fromReady: number;
  manufactured: number;
  materials: { productId: number; name: string; unit: string; qty: number; stockAfter: number }[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Credits `shortfall` units of a BOM product to stock — from Ready Material
// first, then by consuming raw materials per the BOM. Returns null (and
// changes nothing) when the product has no BOM or there is nothing to cover.
export async function coverManufacturedShortfall(
  client: Client,
  params: { companyId: number; productId: number; shortfall: number; reason: string; userId: number },
): Promise<ShortfallCover | null> {
  const { companyId, productId, reason, userId } = params;
  const shortfall = round3(params.shortfall);
  if (!(shortfall > 0)) return null;

  const bomRes = await client.query(
    `SELECT b.id, b.output_quantity, p.name, p.unit
     FROM boms b JOIN products p ON p.id = b.finished_product_id AND p.company_id = b.company_id
     WHERE b.company_id = $1 AND b.finished_product_id = $2
     ORDER BY b.id ASC LIMIT 1`,
    [companyId, productId],
  );
  const bom = bomRes.rows[0];
  if (!bom) return null;

  // 1. Made but not yet dispatched to store — use that first (oldest batch first).
  let remaining = shortfall;
  let fromReady = 0;
  const readyRes = await client.query(
    `SELECT id, qty FROM ready_material_batches
     WHERE company_id = $1 AND product_id = $2 AND status = 'ready' AND qty > 0
     ORDER BY created_at ASC FOR UPDATE`,
    [companyId, productId],
  );
  for (const batch of readyRes.rows) {
    if (remaining <= 0) break;
    const take = Math.min(Number(batch.qty), remaining);
    if (take >= Number(batch.qty)) {
      await client.query(
        `UPDATE ready_material_batches SET status = 'dispatched', dispatched_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [batch.id],
      );
    } else {
      await client.query(`UPDATE ready_material_batches SET qty = qty - $1, updated_at = NOW() WHERE id = $2`, [take, batch.id]);
    }
    remaining = round3(remaining - take);
    fromReady = round3(fromReady + take);
  }
  if (fromReady > 0) {
    await client.query(
      `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
       VALUES ($1, $2, 'inward', $3, $4, NULL, 'ready_auto_dispatch', $5)`,
      [companyId, productId, fromReady, `Ready material moved to store — ${reason}`, userId],
    );
    await client.query(
      `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`,
      [fromReady, productId, companyId],
    );
  }

  // 2. Still short — it was made without an entry: consume raw materials per BOM.
  const materials: ShortfallCover["materials"] = [];
  if (remaining > 0) {
    const cardRes = await client.query(
      `INSERT INTO workload_cards (company_id, product_id, target_qty, status, order_type, worker_name, started_at, completed_at)
       VALUES ($1, $2, $3, 'done', 'production', $4, NOW(), NOW())
       RETURNING id`,
      [companyId, productId, String(remaining), `Auto — ${reason}`.slice(0, 200)],
    );
    const cardId = cardRes.rows[0].id;
    const itemsRes = await client.query(
      `SELECT bi.material_product_id, bi.quantity, p.name, p.unit
       FROM bom_items bi LEFT JOIN products p ON p.id = bi.material_product_id AND p.company_id = bi.company_id
       WHERE bi.company_id = $1 AND bi.bom_id = $2
       ORDER BY bi.id ASC`,
      [companyId, bom.id],
    );
    const batches = remaining / (Number(bom.output_quantity) || 1);
    for (const it of itemsRes.rows) {
      const qty = round3(Number(it.quantity) * batches);
      if (!(qty > 0)) continue;
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'manufacturing_consume', $3, $4, $5, 'workload', $6)`,
        [companyId, it.material_product_id, qty, `Auto manufacturing — ${reason}`, cardId, userId],
      );
      const upd = await client.query(
        `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3 RETURNING current_stock`,
        [qty, it.material_product_id, companyId],
      );
      materials.push({
        productId: it.material_product_id,
        name: it.name ?? `#${it.material_product_id}`,
        unit: it.unit ?? "",
        qty,
        stockAfter: Number(upd.rows[0]?.current_stock ?? 0),
      });
    }
    await client.query(
      `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
       VALUES ($1, $2, 'inward', $3, $4, $5, 'workload', $6)`,
      [companyId, productId, remaining, `Auto manufacturing — ${reason}`, cardId, userId],
    );
    await client.query(
      `UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`,
      [remaining, productId, companyId],
    );
  }

  return {
    productId,
    productName: bom.name,
    unit: bom.unit,
    shortfall,
    fromReady,
    manufactured: round3(remaining),
    materials,
  };
}

// Called just before a sale deducts `qtyOut` of a product: covers only the
// part of THIS sale that stock can't (an already-negative stock is left to
// the one-time fix, not silently absorbed by the next sale).
export async function autoManufactureForSale(
  client: Client,
  params: { companyId: number; productId: number; qtyOut: number; reason: string; userId: number },
): Promise<ShortfallCover | null> {
  const { companyId, productId, qtyOut } = params;
  if (!(qtyOut > 0)) return null;
  if (!(await isAutoManufactureEnabled(client, companyId))) return null;
  const r = await client.query(
    `SELECT current_stock FROM products WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [productId, companyId],
  );
  if (!r.rows[0]) return null;
  const stock = Number(r.rows[0].current_stock);
  const shortfall = Math.min(qtyOut, qtyOut - Math.max(0, stock));
  return coverManufacturedShortfall(client, { ...params, shortfall });
}
