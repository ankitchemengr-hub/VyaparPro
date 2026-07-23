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
  UpdatePurchaseParams,
  UpdatePurchaseBody,
  DeletePurchaseParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getCompanyId } from "../lib/tenant";
import multer from "multer";

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

// ---- File upload setup for purchase attachments ----
// Stored as bytes directly in Postgres (not local disk) — Railway's
// container filesystem is ephemeral and wipes local uploads on every
// redeploy, which previously made every attachment unviewable/undownloadable
// after the next deploy even though its DB record survived.
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      (cb as any)(new Error("Only JPG, PNG, or PDF files are allowed"), false);
    }
  },
});

// Ensure purchase_attachments table exists (best-effort at startup)
pool.query(`
  CREATE TABLE IF NOT EXISTS purchase_attachments (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    purchase_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_path TEXT,
    file_data BYTEA,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS pa_company_idx ON purchase_attachments(company_id);
  CREATE INDEX IF NOT EXISTS pa_purchase_idx ON purchase_attachments(purchase_id);
`).catch((err: any) => logger.warn({ err }, "Could not ensure purchase_attachments table"));

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

// GET /purchases/report — date + product filtered line-item report
router.get("/purchases/report", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_READ_ROLES);
  if (!auth) return;
  const companyId = getCompanyId(req);
  const { fromDate, toDate, productId, billType, vendorId } = req.query as Record<string, string | undefined>;
  const params: any[] = [companyId];
  const conditions = ["p.company_id = $1", "p.status != 'cancelled'"];
  if (fromDate) {
    params.push(fromDate);
    conditions.push(`p.bill_date >= $${params.length}::date`);
  }
  if (toDate) {
    params.push(toDate);
    conditions.push(`p.bill_date < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (productId && !isNaN(Number(productId))) {
    params.push(Number(productId));
    conditions.push(`pi.product_id = $${params.length}`);
  }
  if (billType === "gst" || billType === "non_gst") {
    params.push(billType);
    conditions.push(`p.bill_type = $${params.length}`);
  }
  if (vendorId && !isNaN(Number(vendorId))) {
    params.push(Number(vendorId));
    conditions.push(`p.vendor_id = $${params.length}`);
  }
  try {
    const result = await pool.query(
      `SELECT p.id as purchase_id, p.bill_date, p.vendor_name, p.bill_no, p.vendor_bill_no,
              p.grand_total, p.bill_type,
              pi.product_id, pi.product_name, pi.qty, pi.unit,
              pi.rate, pi.tax_pct, pi.discount_pct, pi.amount
       FROM purchases p
       JOIN purchase_items pi ON pi.purchase_id = p.id AND pi.company_id = p.company_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.bill_date DESC, p.id DESC, pi.id ASC`,
      params,
    );
    res.json(result.rows.map((r: any) => ({
      purchaseId: r.purchase_id,
      billDate: r.bill_date,
      vendorName: r.vendor_name ?? "—",
      billNo: r.bill_no,
      vendorBillNo: r.vendor_bill_no ?? "—",
      productName: r.product_name,
      productId: r.product_id,
      qty: String(r.qty),
      unit: r.unit,
      rate: String(r.rate),
      taxPct: String(r.tax_pct),
      discountPct: String(r.discount_pct),
      amount: String(r.amount),
      grandTotal: String(r.grand_total),
      billType: r.bill_type,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to generate purchase report");
    res.status(500).json({ error: "Failed to generate report" });
  }
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

// PUT /purchases/:id  — replace bill: reverse old stock/ledger, re-apply new
router.put("/purchases/:id", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_WRITE_ROLES);
  if (!auth) return;

  const paramsParsed = UpdatePurchaseParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }
  const bodyParsed = UpdatePurchaseBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: bodyParsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const purchaseId = paramsParsed.data.id;
  const data = bodyParsed.data;

  if (!data.items || data.items.length === 0) {
    res.status(400).json({ error: "At least one line item is required" });
    return;
  }
  if (!data.vendorId) {
    res.status(400).json({ error: "vendorId is required" });
    return;
  }

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
      res.status(400).json({ error: `Line ${idx + 1}: discountPct and taxPct must be 0–100` });
      return;
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Fetch old purchase
    const oldRes = await client.query(
      `SELECT * FROM purchases WHERE company_id = $1 AND id = $2`,
      [companyId, purchaseId],
    );
    if (oldRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    const old = oldRes.rows[0];

    // Fetch old items to reverse stock
    const oldItemsRes = await client.query(
      `SELECT product_id, qty FROM purchase_items WHERE company_id = $1 AND purchase_id = $2`,
      [companyId, purchaseId],
    );

    // Reverse old stock
    for (const oldItem of oldItemsRes.rows) {
      await client.query(
        `UPDATE products SET current_stock = current_stock - $1 WHERE company_id = $2 AND id = $3`,
        [oldItem.qty, companyId, oldItem.product_id],
      );
    }

    // Vendor payable + ledger get adjusted further down (step marked "New
    // vendor payable + ledger entry"), once the new grand total is known —
    // in place on this purchase's existing ledger row when the vendor hasn't
    // changed, instead of deleting and reposting a fresh row (which used to
    // both lose the bill's original ledger date and leave every later row's
    // stored running balance stale, since only the vendor's own outstanding_
    // balance was corrected, not the chain of snapshots after this entry).
    const oldVendorId = old.vendor_id;
    const oldGrandTotal = Number(old.grand_total);

    // Delete old purchase items
    await client.query(
      `DELETE FROM purchase_items WHERE company_id = $1 AND purchase_id = $2`,
      [companyId, purchaseId],
    );

    // Validate new vendor
    const [vendorRow] = await db.select().from(entitiesTable).where(
      and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, data.vendorId!))
    );
    if (!vendorRow || vendorRow.type !== "vendor") {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "Selected entity is not a vendor" });
      return;
    }

    // Recompute totals
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
      return { productId: item.productId, qty, unit: item.unit, rate, discountPct: discPct, discountAmt: effectiveDisc, taxPct, amount };
    });

    const freight = Number(data.freight ?? 0);
    const roundOff = Number(data.roundOff ?? 0);
    const grandTotal = subtotal + totalTax + freight + roundOff;
    const balanceDue = grandTotal;

    // Update purchase header (keep same bill_no)
    await client.query(
      `UPDATE purchases SET
         vendor_bill_no=$1, bill_date=$2, bill_type=$3, vendor_id=$4, vendor_name=$5,
         vendor_gstin=$6, place_of_supply=$7, notes=$8, subtotal=$9, total_discount=$10,
         total_tax=$11, cgst=$12, sgst=$13, igst=$14, freight=$15, round_off=$16,
         grand_total=$17, balance_due=$18, status='saved'
       WHERE company_id=$19 AND id=$20`,
      [
        data.vendorBillNo ?? null,
        data.billDate ?? new Date(),
        data.billType,
        data.vendorId,
        data.vendorName ?? vendorRow.name,
        data.vendorGstin ?? vendorRow.gstin ?? null,
        data.placeOfSupply ?? "Maharashtra",
        data.notes ?? null,
        String(subtotal), String(totalDiscount), String(totalTax),
        String(cgst), String(sgst), String(igst),
        String(freight), String(roundOff),
        String(grandTotal), String(balanceDue),
        companyId, purchaseId,
      ],
    );

    // Insert new items + stock
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
        [companyId, purchaseId, item.productId, prodName,
          String(item.qty), item.unit, String(item.rate),
          String(item.discountPct), String(item.discountAmt),
          String(item.taxPct), String(item.amount)],
      );
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1,$2,'inward',$3,'Purchase edit (re-applied)',$4,'purchase',$5)`,
        [companyId, item.productId, String(item.qty), purchaseId, auth.userId],
      );
      await client.query(
        `UPDATE products SET current_stock = current_stock + $1 WHERE company_id = $2 AND id = $3`,
        [String(item.qty), companyId, item.productId],
      );
    }

    // Vendor payable + ledger: adjust the existing ledger row in place when
    // the vendor hasn't changed, so an edited bill stays the same line at
    // its original position instead of a fresh row dated "now". Every later
    // ledger row's own stored running balance shifts by the same delta,
    // since they're all downstream of this one.
    if (oldVendorId && Number(oldVendorId) === Number(data.vendorId)) {
      const delta = grandTotal - oldGrandTotal;
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE company_id = $2 AND id = $3`,
        [delta, companyId, data.vendorId],
      );
      const existingLedgerRes = await client.query(
        `SELECT id FROM ledger_entries WHERE company_id = $1 AND entity_id = $2 AND type = 'purchase' AND reference_id = $3 ORDER BY id ASC LIMIT 1`,
        [companyId, data.vendorId, purchaseId],
      );
      const existingLedgerRow = existingLedgerRes.rows[0];
      if (existingLedgerRow) {
        await client.query(
          `UPDATE ledger_entries SET credit = $1, description = $2, balance = balance + $3 WHERE id = $4`,
          [grandTotal, `Purchase ${old.bill_no}`, delta, existingLedgerRow.id],
        );
        await client.query(
          `UPDATE ledger_entries SET balance = balance + $1 WHERE company_id = $2 AND entity_id = $3 AND id > $4`,
          [delta, companyId, data.vendorId, existingLedgerRow.id],
        );
      } else {
        const balRes = await client.query(
          `SELECT outstanding_balance FROM entities WHERE company_id = $1 AND id = $2`,
          [companyId, data.vendorId],
        );
        const newBal = balRes.rows[0].outstanding_balance;
        await client.query(
          `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
           VALUES ($1,$2,NOW(),$3,0,$4,$5,'purchase',$6,$7)`,
          [companyId, data.vendorId, `Purchase ${old.bill_no}`, grandTotal, newBal, purchaseId, old.bill_no],
        );
      }
    } else {
      // Vendor changed (or bill had no vendor before) — genuinely spans two
      // different entities' histories: reverse on the old one, delete its
      // ledger row, and post fresh on the new one.
      if (oldVendorId) {
        await client.query(
          `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE company_id = $2 AND id = $3`,
          [oldGrandTotal, companyId, oldVendorId],
        );
        await client.query(
          `DELETE FROM ledger_entries WHERE company_id = $1 AND type = 'purchase' AND reference_id = $2 AND entity_id = $3`,
          [companyId, purchaseId, oldVendorId],
        );
      }
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
         VALUES ($1,$2,NOW(),$3,0,$4,$5,'purchase',$6,$7)`,
        [companyId, data.vendorId, `Purchase ${old.bill_no} (edited)`, grandTotal, newBal, purchaseId, old.bill_no],
      );
    }

    await client.query("COMMIT");

    const [full] = await db.select().from(purchasesTable).where(
      and(eq(purchasesTable.companyId, companyId), eq(purchasesTable.id, purchaseId))
    );
    const items = await db.select().from(purchaseItemsTable).where(
      and(eq(purchaseItemsTable.companyId, companyId), eq(purchaseItemsTable.purchaseId, purchaseId))
    );
    res.json(formatPurchase(full, items));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to update purchase");
    res.status(500).json({ error: "Failed to update purchase" });
  } finally {
    client.release();
  }
});

// DELETE /purchases/:id — cancel a bill: reverse its stock/vendor payable/ledger
// effects (same reversal used by PUT above), then mark it cancelled. Unlike
// invoice cancellation, purchases DO reverse stock — a mis-entered bill hasn't
// sent real goods anywhere, so leaving stock/payable inflated would just be
// wrong going forward, not a record of something that already happened.
router.delete("/purchases/:id", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_WRITE_ROLES);
  if (!auth) return;

  const paramsParsed = DeletePurchaseParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: paramsParsed.error.message });
    return;
  }
  const companyId = getCompanyId(req);
  const purchaseId = paramsParsed.data.id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    const oldRes = await client.query(
      `SELECT * FROM purchases WHERE company_id = $1 AND id = $2`,
      [companyId, purchaseId],
    );
    if (oldRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Purchase not found" });
      return;
    }
    const old = oldRes.rows[0];
    if (old.status === "cancelled") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Purchase is already cancelled" });
      return;
    }

    const oldItemsRes = await client.query(
      `SELECT product_id, qty FROM purchase_items WHERE company_id = $1 AND purchase_id = $2`,
      [companyId, purchaseId],
    );
    for (const oldItem of oldItemsRes.rows) {
      await client.query(
        `UPDATE products SET current_stock = current_stock - $1 WHERE company_id = $2 AND id = $3`,
        [oldItem.qty, companyId, oldItem.product_id],
      );
      await client.query(
        `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
         VALUES ($1, $2, 'outward', $3, 'Purchase cancelled', $4, 'purchase', $5)`,
        [companyId, oldItem.product_id, oldItem.qty, purchaseId, auth.userId],
      );
    }

    if (old.vendor_id) {
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE company_id = $2 AND id = $3`,
        [Number(old.grand_total), companyId, old.vendor_id],
      );
    }

    await client.query(
      `DELETE FROM ledger_entries WHERE company_id = $1 AND type = 'purchase' AND reference_id = $2`,
      [companyId, purchaseId],
    );

    const updated = await client.query(
      `UPDATE purchases SET status = 'cancelled' WHERE company_id = $1 AND id = $2 RETURNING *`,
      [companyId, purchaseId],
    );

    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, 'purchase_cancelled', $2, $3, $4, $5)`,
      [
        companyId,
        `Purchase bill ${old.bill_no} cancelled — stock and vendor payable reversed`,
        auth.userId,
        (req as any).session?.name ?? auth.role,
        JSON.stringify({ purchaseId, billNo: old.bill_no, grandTotal: old.grand_total }),
      ],
    );

    await client.query("COMMIT");

    const items = await db.select().from(purchaseItemsTable).where(
      and(eq(purchaseItemsTable.companyId, companyId), eq(purchaseItemsTable.purchaseId, purchaseId))
    );
    res.json(formatPurchase(updated.rows[0], items));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to cancel purchase");
    res.status(500).json({ error: "Failed to cancel purchase" });
  } finally {
    client.release();
  }
});

// ---- ATTACHMENT ROUTES ----

// GET /purchases/attachments/:attachmentId/file — serve/download file
router.get("/purchases/attachments/:attachmentId/file", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_READ_ROLES);
  if (!auth) return;
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.attachmentId, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await pool.query(
      `SELECT * FROM purchase_attachments WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Attachment not found" }); return; }
    const att = result.rows[0];
    if (!att.file_data) {
      // Uploaded before file bytes were stored in Postgres — the disk file
      // it pointed to was wiped by a subsequent deploy and can't be recovered.
      res.status(404).json({ error: "This file was uploaded before persistent storage was added and is no longer available. Please re-upload it." });
      return;
    }
    res.setHeader("Content-Type", att.mime_type);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(att.original_name)}"`);
    res.send(att.file_data);
  } catch (err) {
    logger.error({ err }, "Failed to serve attachment");
    res.status(500).json({ error: "Failed to serve file" });
  }
});

// DELETE /purchases/attachments/:attachmentId
router.delete("/purchases/attachments/:attachmentId", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_WRITE_ROLES);
  if (!auth) return;
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.attachmentId, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await pool.query(
      `DELETE FROM purchase_attachments WHERE id = $1 AND company_id = $2 RETURNING *`,
      [id, companyId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Attachment not found" }); return; }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "Failed to delete attachment");
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

// POST /purchases/:id/attachments — upload files via multer
router.post(
  "/purchases/:id/attachments",
  (req: any, res: any, next: any) => {
    attachmentUpload.array("files", 10)(req, res, (err: any) => {
      if (err) {
        res.status(400).json({ error: err.message ?? "Upload failed" });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const auth = requireSession(req, res, PURCHASE_WRITE_ROLES);
    if (!auth) return;
    const companyId = getCompanyId(req);
    const purchaseId = parseInt(req.params.id, 10);
    if (!Number.isFinite(purchaseId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) { res.status(400).json({ error: "No files uploaded" }); return; }
    try {
      const inserted = [];
      for (const f of files) {
        const r = await pool.query(
          `INSERT INTO purchase_attachments
             (company_id, purchase_id, file_name, original_name, mime_type, file_size, file_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [companyId, purchaseId, f.originalname, f.originalname, f.mimetype, f.size, f.buffer],
        );
        inserted.push(r.rows[0]);
      }
      res.json(inserted.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        originalName: r.original_name,
        mimeType: r.mime_type,
        fileSize: r.file_size,
        createdAt: r.created_at,
      })));
    } catch (err) {
      logger.error({ err }, "Failed to save attachments");
      res.status(500).json({ error: "Failed to save attachments" });
    }
  },
);

// GET /purchases/:id/attachments — list attachments for a purchase
router.get("/purchases/:id/attachments", async (req, res): Promise<void> => {
  const auth = requireSession(req, res, PURCHASE_READ_ROLES);
  if (!auth) return;
  const companyId = getCompanyId(req);
  const purchaseId = parseInt(req.params.id, 10);
  if (!Number.isFinite(purchaseId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await pool.query(
      `SELECT * FROM purchase_attachments
       WHERE purchase_id = $1 AND company_id = $2
       ORDER BY created_at ASC`,
      [purchaseId, companyId],
    );
    res.json(result.rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      originalName: r.original_name,
      mimeType: r.mime_type,
      fileSize: r.file_size,
      createdAt: r.created_at,
      // False only for rows uploaded before file bytes were stored in
      // Postgres — their disk file was wiped by a later deploy.
      available: r.file_data != null,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to fetch attachments");
    res.status(500).json({ error: "Failed to fetch attachments" });
  }
});

export default router;
