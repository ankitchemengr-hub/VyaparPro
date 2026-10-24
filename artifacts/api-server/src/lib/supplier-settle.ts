import { pool } from "@workspace/db";
import { NO_PAY_INVOICE_TYPES } from "./entity-payment";

// Supplier Settle — for every supplier: how much of the material bought from
// them has been sold, how much of that sale the customers have actually paid,
// and therefore how much of the supplier's money has come in and should go
// out to the supplier first.
//
// Which supplier a sale belongs to is decided FIFO per product: sales use up
// the oldest purchase lots first (across all suppliers), the way stock moves
// on the shelf. A product made in-house (has a BOM) that wasn't bought is
// broken down through its BOM — selling 1 unit "sells" the raw materials it
// is made of (BOM qty x units / output qty, the same maths manufacturing uses
// to consume them), so the raw-material supplier's money counts as in once
// the customer pays. The sale value is split across the materials by their
// cost. Sales that still can't be traced to any purchase (opening stock, no
// BOM) are left unattributed and reported separately.
//
// Amounts include GST/freight: a purchase line's cost is its share of the
// bill's grand total (what is owed to the supplier); a sale line's value is
// its share of the invoice's grand total (what the customer owes). A sale is
// "collected" in the same ratio its invoice has been paid (amount_paid /
// grand_total), so a fully paid bill means that material's money is in.
//
// Bills deleted by Non-GST Data Cleanup still count (they are real sales and
// purchases); cancelled ones don't. Sales returns put quantity back.

const EPS = 1e-9;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

interface Lot { vendorId: number; qty: number; unitCost: number; left: number }
interface SaleLine { productId: number; qty: number; unitValue: number; paidRatio: number }

export interface SupplierProductRow {
  productId: number;
  productName: string;
  unit: string;
  // Of soldQty, how much went out inside made products (via their BOM).
  usedInMadeQty: number;
  purchasedQty: number;
  purchasedValue: number;
  soldQty: number;
  soldValue: number;
  costOfSold: number;
  collected: number;
  costOfCollected: number;
  stockQty: number;
  stockValue: number;
}

export interface SupplierSettleRow {
  vendorId: number;
  vendorName: string;
  mobile: string | null;
  purchasedValue: number;
  soldValue: number;
  costOfSold: number;
  collected: number;
  // The supplier's share of the money that has come in.
  costOfCollected: number;
  // Profit on the money that has come in.
  profitCollected: number;
  // Sold but the customer hasn't paid yet (sale value).
  pendingFromCustomers: number;
  stockValue: number;
  paidToSupplier: number;
  supplierDue: number;
  // What to pay the supplier now: their share of collected money not yet paid,
  // never more than what is actually due to them.
  payNow: number;
  products: SupplierProductRow[];
}

export interface SupplierSettleReport {
  suppliers: SupplierSettleRow[];
  totals: Omit<SupplierSettleRow, "vendorId" | "vendorName" | "mobile" | "products">;
  unattributed: { soldQty: number; soldValue: number; collected: number };
}

export async function buildSupplierSettle(companyId: number): Promise<SupplierSettleReport> {
  const noPay = NO_PAY_INVOICE_TYPES as string[];
  const [vendorsRes, lotsRes, salesRes, paidRes, productsRes, bomRes] = await Promise.all([
    pool.query(
      `SELECT id, name, mobile, outstanding_balance FROM entities WHERE company_id = $1 AND type = 'vendor'`,
      [companyId],
    ),
    // One lot per purchase line; its cost is its share of the bill's grand total.
    pool.query(
      `SELECT p.vendor_id, pi.product_id, pi.qty::float8 AS qty,
              CASE WHEN t.lines_total > 0 THEN pi.amount * p.grand_total / t.lines_total ELSE pi.amount END::float8 AS line_cost
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id AND p.company_id = pi.company_id
         JOIN (SELECT purchase_id, SUM(amount) AS lines_total FROM purchase_items WHERE company_id = $1 GROUP BY purchase_id) t
           ON t.purchase_id = p.id
        WHERE p.company_id = $1 AND p.status <> 'cancelled' AND p.vendor_id IS NOT NULL AND pi.qty > 0
        ORDER BY p.bill_date ASC, p.id ASC, pi.id ASC`,
      [companyId],
    ),
    // One line per invoice line, net of returns; value is its share of the
    // invoice's grand total, collected in the invoice's paid ratio.
    pool.query(
      `SELECT ii.product_id,
              (ii.qty - COALESCE(ret.qty, 0))::float8 AS qty,
              CASE WHEN ii.qty > 0 AND t.lines_total > 0
                   THEN ii.amount * i.grand_total / t.lines_total / ii.qty ELSE 0 END::float8 AS unit_value,
              CASE WHEN i.grand_total > 0 THEN LEAST(1, GREATEST(0, i.amount_paid / i.grand_total)) ELSE 1 END::float8 AS paid_ratio
         FROM invoice_items ii
         JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = ii.company_id
         JOIN (SELECT invoice_id, SUM(amount) AS lines_total FROM invoice_items WHERE company_id = $1 GROUP BY invoice_id) t
           ON t.invoice_id = i.id
         LEFT JOIN (
           SELECT sri.invoice_item_id, SUM(sri.qty) AS qty
             FROM sales_return_items sri
             JOIN sales_returns sr ON sr.id = sri.return_id AND sr.company_id = sri.company_id
            WHERE sri.company_id = $1 AND sr.status <> 'cancelled' AND sri.invoice_item_id IS NOT NULL
            GROUP BY sri.invoice_item_id
         ) ret ON ret.invoice_item_id = ii.id
        WHERE i.company_id = $1 AND i.status = 'saved' AND NOT (i.invoice_type = ANY($2::text[]))
          AND ii.qty - COALESCE(ret.qty, 0) > 0
        ORDER BY i.invoice_date ASC, i.id ASC, ii.id ASC`,
      [companyId, noPay],
    ),
    // Payments made to each supplier (Cash Book / Khatabook "payment" rows).
    pool.query(
      `SELECT l.entity_id, SUM(l.credit)::float8 AS paid
         FROM ledger_entries l
         JOIN entities e ON e.id = l.entity_id AND e.company_id = l.company_id
        WHERE l.company_id = $1 AND e.type = 'vendor' AND l.type = 'payment'
        GROUP BY l.entity_id`,
      [companyId],
    ),
    pool.query(`SELECT id, name, unit, purchase_price FROM products WHERE company_id = $1`, [companyId]),
    pool.query(
      `SELECT b.finished_product_id, b.output_quantity::float8 AS output_qty, bi.material_product_id, bi.quantity::float8 AS qty
         FROM boms b JOIN bom_items bi ON bi.bom_id = b.id AND bi.company_id = b.company_id
        WHERE b.company_id = $1 AND bi.quantity > 0`,
      [companyId],
    ),
  ]);

  const productInfo = new Map<number, { name: string; unit: string; price: number }>(
    productsRes.rows.map((p: any) => [p.id, { name: p.name, unit: p.unit, price: Number(p.purchase_price ?? 0) }]),
  );

  // BOM per finished product: raw material qty needed per 1 unit made.
  const bomOf = new Map<number, { materialId: number; perUnit: number }[]>();
  for (const b of bomRes.rows as any[]) {
    const out = Number(b.output_qty) > 0 ? Number(b.output_qty) : 1;
    const list = bomOf.get(b.finished_product_id) ?? [];
    list.push({ materialId: b.material_product_id, perUnit: Number(b.qty) / out });
    bomOf.set(b.finished_product_id, list);
  }

  // FIFO lots per product.
  const lotsByProduct = new Map<number, Lot[]>();
  for (const l of lotsRes.rows) {
    const qty = Number(l.qty);
    const lot: Lot = { vendorId: l.vendor_id, qty, unitCost: qty > 0 ? Number(l.line_cost) / qty : 0, left: qty };
    const list = lotsByProduct.get(l.product_id) ?? [];
    list.push(lot);
    lotsByProduct.set(l.product_id, list);
  }

  type Acc = Omit<SupplierProductRow, "productId" | "productName" | "unit" | "stockQty" | "stockValue">;
  const acc = new Map<string, Acc>(); // `${vendorId}:${productId}`
  const accFor = (vendorId: number, productId: number): Acc => {
    const k = `${vendorId}:${productId}`;
    let a = acc.get(k);
    if (!a) {
      a = { usedInMadeQty: 0, purchasedQty: 0, purchasedValue: 0, soldQty: 0, soldValue: 0, costOfSold: 0, collected: 0, costOfCollected: 0 };
      acc.set(k, a);
    }
    return a;
  };
  for (const [productId, lots] of lotsByProduct) {
    for (const lot of lots) {
      const a = accFor(lot.vendorId, productId);
      a.purchasedQty += lot.qty;
      a.purchasedValue += lot.qty * lot.unitCost;
    }
  }

  const unattributed = { soldQty: 0, soldValue: 0, collected: 0 };
  const cursor = new Map<number, number>(); // product → index of oldest lot with stock left

  // Use up `line.qty` of a product: its own purchase lots first (FIFO), then —
  // for a made product — the raw materials of whatever is left, via its BOM.
  const consume = (line: SaleLine, viaBom: boolean, depth: number): void => {
    const lots = lotsByProduct.get(line.productId) ?? [];
    let need = line.qty;
    let i = cursor.get(line.productId) ?? 0;
    while (need > EPS && i < lots.length) {
      const lot = lots[i]!;
      const take = Math.min(need, lot.left);
      if (take > EPS) {
        const a = accFor(lot.vendorId, line.productId);
        const value = take * line.unitValue;
        const cost = take * lot.unitCost;
        a.soldQty += take;
        if (viaBom) a.usedInMadeQty += take;
        a.soldValue += value;
        a.costOfSold += cost;
        a.collected += value * line.paidRatio;
        a.costOfCollected += cost * line.paidRatio;
        lot.left -= take;
        need -= take;
      }
      if (lot.left <= EPS) i++;
    }
    cursor.set(line.productId, i);
    if (need <= EPS) return;

    const bom = depth < 5 ? bomOf.get(line.productId) : undefined;
    if (bom && bom.length > 0) {
      // Split the remaining sale value across the materials by their cost.
      const parts = bom.map((m) => ({ ...m, qty: need * m.perUnit, w: need * m.perUnit * (productInfo.get(m.materialId)?.price ?? 0) }));
      const totalW = parts.reduce((sum, m) => sum + m.w, 0);
      const value = need * line.unitValue;
      for (const m of parts) {
        if (m.qty <= EPS) continue;
        const share = totalW > EPS ? m.w / totalW : 1 / parts.length;
        consume({ productId: m.materialId, qty: m.qty, unitValue: (value * share) / m.qty, paidRatio: line.paidRatio }, true, depth + 1);
      }
      return;
    }
    // Can't be traced to any purchase. A raw material used beyond what was
    // ever bought adds its value but not its quantity (a different item).
    if (!viaBom) unattributed.soldQty += need;
    unattributed.soldValue += need * line.unitValue;
    unattributed.collected += need * line.unitValue * line.paidRatio;
  };

  for (const row of salesRes.rows as any[]) {
    consume({ productId: row.product_id, qty: Number(row.qty), unitValue: Number(row.unit_value), paidRatio: Number(row.paid_ratio) }, false, 0);
  }

  // Stock still on hand, per supplier lot.
  const stock = new Map<string, { qty: number; value: number }>();
  for (const [productId, lots] of lotsByProduct) {
    for (const lot of lots) {
      if (lot.left <= EPS) continue;
      const k = `${lot.vendorId}:${productId}`;
      const st = stock.get(k) ?? { qty: 0, value: 0 };
      st.qty += lot.left;
      st.value += lot.left * lot.unitCost;
      stock.set(k, st);
    }
  }

  const paidBy = new Map<number, number>(paidRes.rows.map((r: any) => [r.entity_id, Number(r.paid)]));
  const suppliers: SupplierSettleRow[] = [];
  for (const v of vendorsRes.rows) {
    const products: SupplierProductRow[] = [];
    for (const [k, a] of acc) {
      const [vid, pid] = k.split(":").map(Number);
      if (vid !== v.id) continue;
      const st = stock.get(k) ?? { qty: 0, value: 0 };
      const info = productInfo.get(pid!) ?? { name: `Product #${pid}`, unit: "", price: 0 };
      products.push({
        productId: pid!, productName: info.name, unit: info.unit, usedInMadeQty: r3(a.usedInMadeQty),
        purchasedQty: r3(a.purchasedQty), purchasedValue: r2(a.purchasedValue),
        soldQty: r3(a.soldQty), soldValue: r2(a.soldValue), costOfSold: r2(a.costOfSold),
        collected: r2(a.collected), costOfCollected: r2(a.costOfCollected),
        stockQty: r3(st.qty), stockValue: r2(st.value),
      });
    }
    const due = Number(v.outstanding_balance ?? 0);
    if (products.length === 0 && Math.abs(due) < 0.005) continue;
    products.sort((x, y) => y.soldValue - x.soldValue || x.productName.localeCompare(y.productName));
    const sum = (f: (p: SupplierProductRow) => number) => r2(products.reduce((s, p) => s + f(p), 0));
    const costOfCollected = sum((p) => p.costOfCollected);
    const collected = sum((p) => p.collected);
    const soldValue = sum((p) => p.soldValue);
    const paidToSupplier = r2(paidBy.get(v.id) ?? 0);
    const supplierDue = r2(Math.max(0, due));
    suppliers.push({
      vendorId: v.id,
      vendorName: v.name,
      mobile: v.mobile ?? null,
      purchasedValue: sum((p) => p.purchasedValue),
      soldValue,
      costOfSold: sum((p) => p.costOfSold),
      collected,
      costOfCollected,
      profitCollected: r2(collected - costOfCollected),
      pendingFromCustomers: r2(soldValue - collected),
      stockValue: sum((p) => p.stockValue),
      paidToSupplier,
      supplierDue,
      payNow: r2(Math.min(supplierDue, Math.max(0, costOfCollected - paidToSupplier))),
      products,
    });
  }
  suppliers.sort((a, b) => b.payNow - a.payNow || b.supplierDue - a.supplierDue || a.vendorName.localeCompare(b.vendorName));

  const tot = (f: (s: SupplierSettleRow) => number) => r2(suppliers.reduce((s, x) => s + f(x), 0));
  return {
    suppliers,
    totals: {
      purchasedValue: tot((s) => s.purchasedValue),
      soldValue: tot((s) => s.soldValue),
      costOfSold: tot((s) => s.costOfSold),
      collected: tot((s) => s.collected),
      costOfCollected: tot((s) => s.costOfCollected),
      profitCollected: tot((s) => s.profitCollected),
      pendingFromCustomers: tot((s) => s.pendingFromCustomers),
      stockValue: tot((s) => s.stockValue),
      paidToSupplier: tot((s) => s.paidToSupplier),
      supplierDue: tot((s) => s.supplierDue),
      payNow: tot((s) => s.payNow),
    },
    unattributed: { soldQty: r3(unattributed.soldQty), soldValue: r2(unattributed.soldValue), collected: r2(unattributed.collected) },
  };
}
