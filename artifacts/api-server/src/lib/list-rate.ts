// Price-list rate checks for sale invoices.
//
// listRateFor() mirrors the billing page's getBaseRate() (frontend
// pages/billing.tsx) — keep the two in step. applyListRateFlags() runs after
// an invoice's lines are written: it snapshots each line's list rate and marks
// the invoice `below_list_rate` when someone other than an admin billed a line
// below it, so the owner can spot those invoices in the list. Never blocks a
// save — it only records.

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> };

const GST_TYPES = new Set(["gst", "proforma_invoice"]);
const ADMIN_ROLES = new Set(["admin", "super_admin"]);

export interface PricedProduct {
  pricing_mode: string | null;
  mrp: string | number | null;
  retail_price: string | number | null;
  wholesale_price: string | number | null;
  non_gst_price: string | number | null;
  retail_discount_pct: string | number | null;
  retail_non_gst_discount_pct: string | number | null;
  wholesale_discount_pct: string | number | null;
  wholesale_non_gst_discount_pct: string | number | null;
}

export function listRateFor(p: PricedProduct, pricingTier: string | null, invoiceType: string): number {
  const isWholesale = pricingTier === "wholesale";
  const isGst = GST_TYPES.has(invoiceType);

  if (p.pricing_mode === "mrp_based") {
    const mrp = Number(p.mrp) || 0;
    if (mrp > 0) {
      const discountPct = Number(
        isWholesale
          ? (isGst ? p.wholesale_discount_pct : p.wholesale_non_gst_discount_pct)
          : (isGst ? p.retail_discount_pct : p.retail_non_gst_discount_pct),
      ) || 0;
      const rate = mrp * (1 - discountPct / 100);
      if (rate > 0) return rate;
    }
  }

  const wholesale = Number(p.wholesale_price) || 0;
  const retail = Number(p.retail_price) || 0;
  if (!isWholesale) return retail || wholesale;
  const nonGst = Number(p.non_gst_price) || 0;
  if (!isGst && nonGst > 0) return nonGst;
  return wholesale || retail;
}

// Returns whether the invoice ended up flagged.
export async function applyListRateFlags(
  q: Queryable,
  companyId: number,
  invoiceId: number,
  actorRole: string | null | undefined,
): Promise<boolean> {
  const { rows } = await q.query(
    `SELECT ii.id, ii.qty, ii.rate, ii.discount_amt, i.invoice_type, e.pricing_tier,
            p.pricing_mode, p.mrp, p.retail_price, p.wholesale_price, p.non_gst_price,
            p.retail_discount_pct, p.retail_non_gst_discount_pct,
            p.wholesale_discount_pct, p.wholesale_non_gst_discount_pct
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id AND i.company_id = ii.company_id
     LEFT JOIN products p ON p.id = ii.product_id AND p.company_id = ii.company_id
     LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
     WHERE ii.invoice_id = $1 AND ii.company_id = $2`,
    [invoiceId, companyId],
  );

  const ids: number[] = [];
  const listRates: (string | null)[] = [];
  let anyBelow = false;
  for (const r of rows) {
    // No product row (deleted product) → nothing to compare against.
    const list = r.retail_price != null ? listRateFor(r, r.pricing_tier ?? "retail", r.invoice_type) : 0;
    ids.push(r.id);
    listRates.push(list > 0 ? list.toFixed(2) : null);
    // Compare the net unit rate actually charged (after line discount).
    const qty = Number(r.qty) || 0;
    const net = qty > 0 ? (qty * Number(r.rate) - (Number(r.discount_amt) || 0)) / qty : Number(r.rate);
    if (list > 0 && net < list - 0.005) anyBelow = true;
  }

  if (ids.length > 0) {
    await q.query(
      `UPDATE invoice_items AS ii SET list_rate = v.list_rate::numeric
       FROM UNNEST($1::int[], $2::text[]) AS v(id, list_rate)
       WHERE ii.id = v.id AND ii.company_id = $3`,
      [ids, listRates, companyId],
    );
  }
  // An admin saving (or editing) the invoice is the approval — no flag.
  const flagged = anyBelow && !ADMIN_ROLES.has(actorRole ?? "");
  await q.query(
    `UPDATE invoices SET below_list_rate = $1 WHERE id = $2 AND company_id = $3`,
    [flagged, invoiceId, companyId],
  );
  return flagged;
}
