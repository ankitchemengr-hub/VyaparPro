import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  purchasesTable,
  purchaseItemsTable,
  entitiesTable,
  ledgerEntriesTable,
  productsTable,
} from "@workspace/db";
import {
  ListPurchasesQueryParams,
  CreatePurchaseBody,
  GetPurchaseParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const PURCHASE_READ_ROLES = new Set(["admin", "accountant", "store"]);
const PURCHASE_WRITE_ROLES = new Set(["admin", "accountant", "store"]);

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

async function generateBillNumber(client: any, companyId: number): Promise<string> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const result = await client.query(
    `INSERT INTO purchase_sequence (company_id, month, year, last_number)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (company_id, month, year) DO UPDATE
       SET last_number = purchase_sequence.last_number + 1
     RETURNING last_number`,
    [companyId, month, year],
  );
  const seqNum: number = result.rows[0].last_number;
  return `PUR/${year}/${String(month).padStart(2, "0")}/${seqNum}`;
}

function formatPurchase(row: any, items: any[]) {
  return {
    id: row.id,
    billNo: row.billNo ?? row.bill_no,
    vendorBillNo: row.vendorBillNo ?? row.vendor_bill_no ?? null,
    billDate: (row.billDate ?? row.bill_date)?.toISOString?.() ?? row.bill_date,
    dueDate: row.dueDate ?? row.due_date ?? null,
    billType: row.billType ?? row.bill_type,
    vendorId: row.vendorId ?? row.vendor_id ?? null,
    vendorName: row.vendorName ?? row.vendor_name ?? null,
    vendorGstin: row.vendorGstin ?? row.vendor_gstin ?? null,
    placeOfSupply: row.placeOfSupply ?? row.place_of_supply,
    notes: row.notes ?? null,
    subtotal: String(row.subtotal),
    totalDiscount: String(row.totalDiscount ?? row.total_discount),
    totalTax: String(row.totalTax ?? row.total_tax),
    cgst: String(row.cgst),
    sgst: String(row.sgst),
    igst: String(row.igst),
    freight: String(row.freight),
    roundOff: String(row.roundOff ?? row.round_off),
    grandTotal: String(row.grandTotal ?? row.grand_total),
    amountPaid: String(row.amountPaid ?? row.amount_paid),
    balanceDue: String(row.balanceDue ?? row.balance_due),
    status: row.status,
    createdAt: (row.createdAt ?? row.created_at)?.toISOString?.() ?? row.created_at,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId ?? it.product_id,
      productName: it.productName ?? it.product_name,
      hsnCode: it.hsnCode ?? it.hsn_code ?? null,
      qty: String(it.qty),
      unit: it.unit,
      rate: String(it.rate),
      discountPct: String(it.discountPct ?? it.discount_pct),
      discountAmt: String(it.discountAmt ?? it.discount_amt),
      taxPct: String(it.taxPct ?? it.tax_pct),
      amount: String(it.amount),
    })),
  };
}

// GET /purchases
router.get("/purchases", async (req, res): Promise<void> => {
  if (!requireSession(req, res, PURCHASE_READ_ROLES)) return;
  const parsed = ListPurchasesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const conditions: any[] = [eq(purchasesTable.companyId, companyId)];
  if (parsed.data.vendorId) conditions.push(eq(purchasesTable.vendorId, parsed.data.vendorId));
  if (parsed.data.status) conditions.push(eq(purchasesTable.status, parsed.data.status));
  const rows = await db.select().from(purchasesTable).where(and(...conditions)).orderBy(sql`${purchasesTable.createdAt} DESC`);
  res.json(rows.map((r) => formatPurchase(r, [])));
});

// GET /purchases/:id
router.get("/purchases/:id", async (req, res): Promise<void> => {
  if (!requireSession(req, res, PURCHASE_READ_ROLES)) return;
  const parsed = GetPurchaseParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const [row] = await db.select().from(purchasesTable).where(and(eq(purchasesTable.companyId, companyId), eq(purchasesTable.id, parsed.data.id)));
  if (!row) {
    res.status(404).json({ error: "Purchase not found" });
    return;
  }
  const items = await db.select().from(purchaseItemsTable).where(and(eq(purchaseItemsTable.companyId, companyId), eq(purchaseItemsTable.purchaseId, parsed.data.id)));
  res.json(formatPurchase(row, items));
});

// POST /purchases
// Atomic SERIALIZABLE: insert bill + items, INWARD stock movement, debit
// product stock UP, and credit the vendor ledger (we now owe them).
router.post("/purchases", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_WRITE_ROLES);
  if (!auth) return;

  const parsed = CreatePurchaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const data = parsed.data;
  if (!data.items || data.items.length === 0) {
    res.status(400).json({ error: "At least one line item is required" });
    return;
  }
  if (!data.vendorId) {
    res.status(400).json({ error: "vendorId is required — purchases must post to a vendor's ledger" });
    return;
  }

  // Validate line item bounds — qty must be > 0 (we only INCREMENT stock here, a
  // negative qty would silently DEDUCT stock and reverse the payable). Rates,
  // discounts and tax must be non-negative. Reject up-front rather than commit
  // a math-poisoned bill.
  for (const [idx, it] of data.items.entries()) {
    const qty = Number(it.qty);
    const rate = Number(it.rate);
    const disc = Number(it.discountPct ?? 0);
    const tax = Number(it.taxPct ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      res.status(400).json({ error: `Line ${idx + 1}: qty must be greater than 0` });
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      res.status(400).json({ error: `Line ${idx + 1}: rate must be 0 or more` });
      return;
    }
    if (disc < 0 || disc > 100 || tax < 0 || tax > 100) {
      res.status(400).json({ error: `Line ${idx + 1}: discountPct and taxPct must be between 0 and 100` });
      return;
    }
  }
  if (Number(data.freight ?? 0) < 0) {
    res.status(400).json({ error: "freight must be 0 or more" });
    return;
  }

  // Verify the vendor exists and is actually a vendor (defence-in-depth so a
  // caller can't link a purchase to a customer/worker entity).
  const [vendorRow] = await db.select().from(entitiesTable).where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, data.vendorId)));
  if (!vendorRow || vendorRow.type !== "vendor") {
    res.status(400).json({ error: "Selected entity is not a vendor" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const billNo = await generateBillNumber(client, companyId);

    const isGst = data.billType === "gst";
    const isInterstate = (data.placeOfSupply ?? "Maharashtra") !== "Maharashtra";

    let subtotal = 0, totalDiscount = 0, totalTax = 0, cgst = 0, sgst = 0, igst = 0;

    const processed = data.items.map((item) => {
      const qty = Number(item.qty);
      const rate = Number(item.rate);
      const discPct = Number(item.discountPct ?? 0);
      const discAmt = Number(item.discountAmt ?? 0);
      const taxPct = isGst ? Number(item.taxPct ?? 0) : 0;
      const baseAmt = qty * rate;
      const effectiveDisc = discAmt > 0 ? discAmt : (baseAmt * discPct / 100);
      const taxableAmt = baseAmt - effectiveDisc;
      const taxAmt = taxableAmt * taxPct / 100;
      const amount = taxableAmt + taxAmt;
      subtotal += taxableAmt;
      totalDiscount += effectiveDisc;
      totalTax += taxAmt;
      if (isGst) {
        if (isInterstate) igst += taxAmt;
        else { cgst += taxAmt / 2; sgst += taxAmt / 2; }
      }
      return {
        productId: item.productId,
        qty: String(qty),
        unit: item.unit,
        rate: String(rate),
        discountPct: String(discPct),
        discountAmt: String(effectiveDisc),
        taxPct: String(taxPct),
        amount: String(amount),
      };
    });

    const freight = Number(data.freight ?? 0);
    const roundOff = Number(data.roundOff ?? 0);
    const grandTotal = subtotal + totalTax + freight + roundOff;
    const balanceDue = grandTotal;

    const billRes = await client.query(
      `INSERT INTO purchases (company_id, bill_no, vendor_bill_no, bill_date, due_date, bill_type, vendor_id,
         vendor_name, vendor_gstin, place_of_supply, notes, subtotal, total_discount, total_tax,
         cgst, sgst, igst, freight, round_off, grand_total, balance_due, status, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        companyId,
        billNo,
        data.vendorBillNo ?? null,
        data.billDate ?? new Date(),
        data.dueDate ?? null,
        data.billType,
        data.vendorId,
        data.vendorName ?? vendorRow.name,
        data.vendorGstin ?? vendorRow.gstin ?? null,
        data.placeOfSupply ?? "Maharashtra",
        data.notes ?? null,
        String(subtotal),
        String(totalDiscount),
        String(totalTax),
        String(cgst),
        String(sgst),
        String(igst),
        String(freight),
        String(roundOff),
        String(grandTotal),
        String(balanceDue),
        "saved",
        auth.userId,
      ],
    );
    const billRow = billRes.rows[0];

    for (const item of processed) {
      const prodRes = await client.query(
        `SELECT name FROM products WHERE company_id = $1 AND id = $2`,
        [companyId, item.productId],
      );
      const prodName = prodRes.rows[0]?.name ?? "Unknown";
      await client.query(
        `INSERT INTO purchase_items (company_id, purchase_id, product_id, product_name, qty, unit, rate,
           discount_pct, discount_amt, tax_pct, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          companyId,
          billRow.id,
          item.productId,
          prodName,
          item.qty,
          item.unit,
          item.rate,
          item.discountPct,
          item.discountAmt,
          item.taxPct,
          item.amount,
        ],
      );

      // Inward stock movement (goods received) + credit product stock
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'inward', $3, 'Purchase received', $4, 'purchase', $5)`,
        [companyId, item.productId, item.qty, billRow.id, auth.userId],
      );
      await client.query(
        `UPDATE products SET current_stock = current_stock + $1 WHERE company_id = $2 AND id = $3`,
        [item.qty, companyId, item.productId],
      );
    }

    // Vendor payable: increase outstanding (we owe them) + credit-side ledger entry
    await client.query(
      `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE company_id = $2 AND id = $3`,
      [grandTotal, companyId, data.vendorId],
    );
    const balRes = await client.query(
      `SELECT outstanding_balance FROM entities WHERE company_id = $1 AND id = $2`,
      [companyId, data.vendorId],
    );
    const newBal = balRes.rows[0].outstanding_balance;
    await client.query(
      `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
       VALUES ($1, $2, NOW(), $3, 0, $4, $5, 'purchase', $6, $7)`,
      [companyId, data.vendorId, `Purchase ${billNo}`, grandTotal, newBal, billRow.id, billNo],
    );

    await client.query("COMMIT");

    const [full] = await db.select().from(purchasesTable).where(and(eq(purchasesTable.companyId, companyId), eq(purchasesTable.id, billRow.id)));
    const items = await db.select().from(purchaseItemsTable).where(and(eq(purchaseItemsTable.companyId, companyId), eq(purchaseItemsTable.purchaseId, billRow.id)));
    res.status(201).json(formatPurchase(full, items));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to create purchase");
    res.status(500).json({ error: "Failed to create purchase" });
  } finally {
    client.release();
  }
});

export default router;
