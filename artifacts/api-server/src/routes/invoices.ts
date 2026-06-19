import { Router, type IRouter } from "express";
import { eq, and, ilike, sql, or } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  invoicesTable,
  invoiceItemsTable,
  invoiceSequenceTable,
  entitiesTable,
  ledgerEntriesTable,
  stockMovementsTable,
  productsTable,
  rewardSchemesTable,
  rewardProgressTable,
} from "@workspace/db";
import {
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  GetInvoiceParams,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  DeleteInvoiceParams,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { generateSeriesNumber } from "../lib/number-series";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// Invoice numbers come from the configurable `invoice` series (see number-series.ts).
// The series engine seeds itself from the legacy invoice_sequence counter on first
// use, so the running number is preserved across the cutover.
async function generateInvoiceNumber(client: any, companyId: number): Promise<string> {
  return generateSeriesNumber(client, "invoice", companyId);
}

// GET /invoices
router.get("/invoices", async (req, res): Promise<void> => {
  const params = ListInvoicesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const conditions: any[] = [eq(invoicesTable.companyId, companyId)];
  if (params.data.customerId) conditions.push(eq(invoicesTable.customerId, params.data.customerId));

  // Server-side scoping: a salesman can only ever see invoices linked to their own
  // entity, regardless of what the client puts in the salesmanId query param. This
  // also auto-filters the Invoices page when a salesman opens it with no filters.
  if (session?.role === "salesman") {
    if (!session.entityId) {
      // Salesman user with no linked entity — return empty list rather than leaking everything.
      res.json([]);
      return;
    }
    conditions.push(eq(invoicesTable.salesmanId, session.entityId));
    // Salesmen may only ever see invoices from the last 7 days — enforced
    // server-side so the restriction can't be bypassed from the client.
    conditions.push(sql`${invoicesTable.invoiceDate} >= (CURRENT_DATE - INTERVAL '7 days')`);
  } else if (params.data.salesmanId) {
    conditions.push(eq(invoicesTable.salesmanId, params.data.salesmanId));
  }
  if (params.data.type) conditions.push(eq(invoicesTable.invoiceType, params.data.type));
  if (params.data.search) {
    conditions.push(
      or(
        ilike(invoicesTable.invoiceNo, `%${params.data.search}%`),
        ilike(invoicesTable.customerName ?? sql`''`, `%${params.data.search}%`)
      )
    );
  }
  if (params.data.month && params.data.year) {
    conditions.push(
      sql`EXTRACT(MONTH FROM ${invoicesTable.invoiceDate}) = ${params.data.month} AND EXTRACT(YEAR FROM ${invoicesTable.invoiceDate}) = ${params.data.year}`
    );
  }
  if (params.data.dateFrom) {
    conditions.push(sql`${invoicesTable.invoiceDate} >= ${params.data.dateFrom}::date`);
  }
  if (params.data.dateTo) {
    // Inclusive end date — match anything strictly before the next day.
    conditions.push(sql`${invoicesTable.invoiceDate} < (${params.data.dateTo}::date + INTERVAL '1 day')`);
  }
  if (params.data.status) {
    conditions.push(eq(invoicesTable.status, params.data.status));
  }

  const invoices = conditions.length > 0
    ? await db.select().from(invoicesTable).where(and(...conditions)).orderBy(sql`${invoicesTable.createdAt} DESC`)
    : await db.select().from(invoicesTable).orderBy(sql`${invoicesTable.createdAt} DESC`);

  res.json(invoices.map((inv) => formatInvoice(inv, [])));
});

// POST /invoices
router.post("/invoices", async (req, res): Promise<void> => {
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const data = parsed.data;
  const client = await pool.connect();

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Generate invoice number
    const invoiceNo = await generateInvoiceNumber(client, companyId);

    // Calculate totals
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    const isInterstate = data.placeOfSupply !== "Maharashtra";
    const isGst = data.invoiceType === "gst" || data.invoiceType === "proforma_invoice";
    const isQuotation = data.invoiceType === "quotation";

    const processedItems = data.items.map((item) => {
      const qty = Number(item.qty);
      const rate = Number(item.rate);
      const discPct = Number(item.discountPct ?? 0);
      const discAmt = Number(item.discountAmt ?? 0);
      const taxPct = isGst ? Number(item.taxPct ?? 0) : 0;
      const cessPct = Number(item.cessPct ?? 0);

      const baseAmt = qty * rate;
      const effectiveDisc = discAmt > 0 ? discAmt : (baseAmt * discPct / 100);
      const taxableAmt = baseAmt - effectiveDisc;
      const taxAmt = taxableAmt * taxPct / 100;
      const cessAmt = taxableAmt * cessPct / 100;
      const amount = taxableAmt + taxAmt + cessAmt;

      subtotal += taxableAmt;
      totalDiscount += effectiveDisc;
      totalTax += taxAmt;

      if (isGst) {
        if (isInterstate) {
          igst += taxAmt;
        } else {
          cgst += taxAmt / 2;
          sgst += taxAmt / 2;
        }
      }

      return {
        ...item,
        qty: String(qty),
        qtyBoxes: item.qtyBoxes != null ? String(item.qtyBoxes) : null,
        totalLiters: item.qtyBoxes != null && item.litersPerBox != null
          ? String(Number(item.qtyBoxes) * Number(item.litersPerBox))
          : null,
        rate: String(rate),
        mrp: String(item.mrp),
        discountPct: String(discPct),
        discountAmt: String(effectiveDisc),
        taxPct: String(taxPct),
        cessPct: String(cessPct),
        netPrice: String(rate - rate * discPct / 100),
        amount: String(amount),
      };
    });

    const freight = Number(data.freight ?? 0);
    const roundOff = Number(data.roundOff ?? 0);
    const grandTotal = subtotal + totalTax + freight + roundOff;
    const balanceDue = isQuotation ? 0 : grandTotal;

    // Resolve effective salesman (for invoice attribution + commission).
    // Priority: 1) salesman session entity, 2) explicit salesmanId from admin,
    // 3) customer's assignedSalesmanId (auto-resolved when commission hasn't expired).
    let resolvedSalesmanId: number | null = null;
    let salesmanName: string | null = null;

    if (session?.role === "salesman") {
      resolvedSalesmanId = session.entityId ?? null;
      salesmanName = session.name;
    } else if (data.salesmanId) {
      resolvedSalesmanId = data.salesmanId;
      const [salesman] = await db.select().from(entitiesTable).where(and(eq(entitiesTable.companyId, companyId), eq(entitiesTable.id, data.salesmanId)));
      salesmanName = salesman?.name ?? null;
    } else if (data.customerId) {
      // Auto-resolve from customer's assigned salesman if commission period is still active
      const custRes = await client.query(
        `SELECT assigned_salesman_id, commission_expiry_date FROM entities WHERE id = $1 AND company_id = $2`,
        [data.customerId, companyId]
      );
      const cust = custRes.rows[0];
      if (cust?.assigned_salesman_id && (!cust.commission_expiry_date || new Date(cust.commission_expiry_date) > new Date())) {
        resolvedSalesmanId = cust.assigned_salesman_id;
        const smRes = await client.query(
          `SELECT name FROM entities WHERE id = $1 AND company_id = $2`,
          [resolvedSalesmanId, companyId]
        );
        salesmanName = smRes.rows[0]?.name ?? null;
      }
    }

    // Insert invoice
    const invoiceQueryResult = await client.query(
      `INSERT INTO invoices (invoice_no, invoice_date, due_date, invoice_type, customer_id, customer_name,
        customer_gstin, billing_address, shipping_address, place_of_supply, salesman_id, salesman_name,
        po_number, e_way_bill_no, subtotal, total_discount, total_tax, cgst, sgst, igst, freight,
        round_off, grand_total, balance_due, status, created_by_user_id, company_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING *`,
      [
        invoiceNo,
        data.invoiceDate,
        data.dueDate ?? null,
        data.invoiceType,
        data.customerId ?? null,
        data.customerName ?? null,
        data.customerGstin ?? null,
        data.billingAddress ?? null,
        data.shippingAddress ?? null,
        data.placeOfSupply,
        resolvedSalesmanId,
        salesmanName,
        data.poNumber ?? null,
        data.eWayBillNo ?? null,
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
        session?.userId ?? 1,
        companyId,
      ]
    );
    const invRow = invoiceQueryResult.rows[0];

    // Insert items + deduct stock
    for (const item of processedItems) {
      await client.query(
        `INSERT INTO invoice_items (company_id, invoice_id, product_id, product_name, hsn_code, qty, qty_boxes, total_liters, unit, rate, mrp, discount_pct, discount_amt, tax_pct, cess_pct, net_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          companyId,
          invRow.id,
          item.productId,
          (await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, item.productId))))[0]?.name ?? "Unknown",
          null,
          item.qty,
          item.qtyBoxes,
          item.totalLiters,
          item.unit,
          item.rate,
          item.mrp,
          item.discountPct,
          item.discountAmt,
          item.taxPct,
          item.cessPct,
          item.netPrice,
          item.amount,
        ]
      );

      if (!isQuotation) {
        // Stock movement (outward)
        await client.query(
          `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
           VALUES ($1, $2, 'outward', $3, 'Invoice sale', $4, 'invoice', $5)`,
          [companyId, item.productId, item.qty, invRow.id, session?.userId ?? 1]
        );

        // Reduce product stock
        await client.query(
          `UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`,
          [item.qty, item.productId, companyId]
        );
      }
    }

    // Update customer outstanding balance & ledger (quotations don't affect outstanding)
    if (data.customerId && !isQuotation) {
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3`,
        [grandTotal, data.customerId, companyId]
      );

      const balResult = await client.query(
        `SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`,
        [data.customerId, companyId]
      );
      const newBal = balResult.rows[0].outstanding_balance;

      await client.query(
        `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
         VALUES ($1, $2, NOW(), $3, $4, 0, $5, 'invoice', $6, $7)`,
        [companyId, data.customerId, `Invoice ${invoiceNo}`, grandTotal, newBal, invRow.id, invoiceNo]
      );
    }

    // ── Commission transaction ─────────────────────────────────────────────
    // When an invoice has a salesman attributed, snapshot the commission
    // (liters × commission_per_liter per item) into commission_transactions.
    if (resolvedSalesmanId && !isQuotation) {
      const commissionRows = await client.query(
        `SELECT SUM(COALESCE(ii.total_liters, ii.qty, 0) * COALESCE(p.commission_per_liter, 0)) AS commission,
                SUM(COALESCE(ii.total_liters, ii.qty, 0)) AS liters
         FROM invoice_items ii
         JOIN products p ON p.id = ii.product_id
         WHERE ii.invoice_id = $1 AND ii.company_id = $2`,
        [invRow.id, companyId]
      );
      const totalCommission = Number(commissionRows.rows[0]?.commission ?? 0);
      const totalLiters = Number(commissionRows.rows[0]?.liters ?? 0);

      if (totalCommission > 0 || totalLiters > 0) {
        await client.query(
          `INSERT INTO commission_transactions
             (company_id, invoice_id, invoice_no, salesman_id, salesman_name,
              customer_id, customer_name, total_liters, commission_amount, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
          [
            companyId,
            invRow.id,
            invoiceNo,
            resolvedSalesmanId,
            salesmanName ?? "",
            data.customerId ?? null,
            data.customerName ?? null,
            String(totalLiters),
            String(totalCommission),
          ]
        );
      }
    }

    await client.query("COMMIT");

    // Fetch with items
    const [fullInv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.id, invRow.id)));
    const items = await db.select().from(invoiceItemsTable).where(and(eq(invoiceItemsTable.companyId, companyId), eq(invoiceItemsTable.invoiceId, invRow.id)));

    res.status(201).json(formatInvoice(fullInv, items));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to create invoice");
    res.status(500).json({ error: "Failed to create invoice" });
  } finally {
    client.release();
  }
});

// GET /invoices/:id
router.get("/invoices/:id", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyId(req);
  const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.id, params.data.id)));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  // Salesman scoping (defence against IDOR): a salesman may only read invoices
  // attributed to their own entity. Return 404 (not 403) so existence isn't leaked.
  // A salesman with no linked entity must never see any invoice — otherwise they
  // could read unattributed (admin/counter) invoices where salesman_id IS NULL.
  const session = (req as any).session;
  if (session?.role === "salesman") {
    if (!session.entityId || inv.salesmanId !== session.entityId) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
  }

  const items = await db.select().from(invoiceItemsTable).where(and(eq(invoiceItemsTable.companyId, companyId), eq(invoiceItemsTable.invoiceId, params.data.id)));
  res.json(formatInvoice(inv, items));
});

// PATCH /invoices/:id  — admin only
// Two modes:
//   1. Header-only patch (no `items` in body): updates status / dueDate / select header fields,
//      no stock or ledger impact.
//   2. Full edit (body includes `items`): inside a SERIALIZABLE transaction, reverses the
//      previous stock movements + ledger entry, then re-applies them with the new payload.
router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const session = (req as any).session;
  const companyId = getCompanyId(req);
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only admins can edit invoices" });
    return;
  }
  const params = UpdateInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.status === "cancelled") {
    res.status(400).json({ error: "Use DELETE /invoices/:id to cancel an invoice (runs stock reversal + audit)." });
    return;
  }

  const invoiceId = params.data.id;
  const data = parsed.data;
  const isFullEdit = Array.isArray(data.items);

  // ─────────────── Mode 1: header-only patch ───────────────
  if (!isFullEdit) {
    const updates: Record<string, unknown> = {};
    if (data.status !== undefined) updates.status = data.status;
    if (data.dueDate !== undefined) {
      if (data.dueDate === null || data.dueDate === "") {
        updates.dueDate = null;
      } else {
        const d = new Date(data.dueDate);
        if (Number.isNaN(d.getTime())) {
          res.status(400).json({ error: "Invalid dueDate" });
          return;
        }
        updates.dueDate = d;
      }
    }
    const [inv] = await db
      .update(invoicesTable)
      .set(updates)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.id, invoiceId)))
      .returning();
    if (!inv) { res.status(404).json({ error: "Invoice not found" }); return; }
    const items = await db.select().from(invoiceItemsTable).where(and(eq(invoiceItemsTable.companyId, companyId), eq(invoiceItemsTable.invoiceId, inv.id)));
    res.json(formatInvoice(inv, items));
    return;
  }

  // ─────────────── Mode 2: full edit with stock + ledger reversal ───────────────
  if (!data.items || data.items.length === 0) {
    res.status(400).json({ error: "Full edit requires at least one line item" });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Lock the invoice row for the duration of the txn
    const existingRes = await client.query(`SELECT * FROM invoices WHERE id = $1 AND company_id = $2 FOR UPDATE`, [invoiceId, companyId]);
    if (existingRes.rows.length === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    const existing = existingRes.rows[0];
    if (existing.status === "cancelled") {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Cannot edit a cancelled invoice" });
      return;
    }
    // Block edits when payment has already been collected — changing the customer or
    // totals would desync the payment ledger because payments are customer-level, not
    // invoice-linked. Admin must cancel + re-issue instead.
    if (Number(existing.amount_paid ?? 0) > 0) {
      await client.query("ROLLBACK");
      res.status(409).json({
        error: `Cannot edit invoice — ₹${Number(existing.amount_paid).toFixed(2)} has already been collected. Cancel and re-issue instead.`,
      });
      return;
    }

    // Determine if this is a quotation (before or after edit — either way skip stock/ledger)
    const isQuotationEdit = (data.invoiceType ?? existing.invoice_type) === "quotation";
    const wasQuotation = existing.invoice_type === "quotation";

    // 1. Reverse old line-item stock movements (inward) — skip for quotations
    const oldItemsRes = await client.query(`SELECT * FROM invoice_items WHERE invoice_id = $1 AND company_id = $2`, [invoiceId, companyId]);
    if (!wasQuotation) {
      for (const oi of oldItemsRes.rows) {
        await client.query(
          `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
           VALUES ($1, $2, 'inward', $3, $4, $5, 'invoice_edit_reversal', $6)`,
          [companyId, oi.product_id, oi.qty, `Invoice ${existing.invoice_no} edit — reverse old qty`, invoiceId, session?.userId ?? 1]
        );
        await client.query(`UPDATE products SET current_stock = current_stock + $1 WHERE id = $2 AND company_id = $3`, [oi.qty, oi.product_id, companyId]);
      }
    }
    await client.query(`DELETE FROM invoice_items WHERE invoice_id = $1 AND company_id = $2`, [invoiceId, companyId]);

    // 2. Reverse old customer outstanding + ledger entry — skip for quotations
    const oldGrandTotal = Number(existing.grand_total);
    const oldCustomerId: number | null = existing.customer_id;
    if (oldCustomerId && !wasQuotation) {
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance - $1 WHERE id = $2 AND company_id = $3`,
        [oldGrandTotal, oldCustomerId, companyId]
      );
      const balRes = await client.query(`SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`, [oldCustomerId, companyId]);
      const newBal = balRes.rows[0]?.outstanding_balance ?? 0;
      await client.query(
        `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
         VALUES ($1, $2, NOW(), $3, 0, $4, $5, 'invoice_edit_reversal', $6, $7)`,
        [companyId, oldCustomerId, `Invoice ${existing.invoice_no} edited — reversal`, oldGrandTotal, newBal, invoiceId, existing.invoice_no]
      );
    }

    // 3. Recalculate new totals from new payload (same logic as POST /invoices)
    const isGst = ["gst", "proforma_invoice"].includes(data.invoiceType ?? existing.invoice_type);
    const placeOfSupply = data.placeOfSupply ?? existing.place_of_supply;
    const isInterstate = placeOfSupply !== "Maharashtra";
    let subtotal = 0, totalDiscount = 0, totalTax = 0, cgst = 0, sgst = 0, igst = 0;
    const processedItems = data.items.map((item) => {
      const qty = Number(item.qty);
      const rate = Number(item.rate);
      const discPct = Number(item.discountPct ?? 0);
      const discAmt = Number(item.discountAmt ?? 0);
      const taxPct = isGst ? Number(item.taxPct ?? 0) : 0;
      const cessPct = Number(item.cessPct ?? 0);
      const baseAmt = qty * rate;
      const effectiveDisc = discAmt > 0 ? discAmt : (baseAmt * discPct / 100);
      const taxableAmt = baseAmt - effectiveDisc;
      const taxAmt = taxableAmt * taxPct / 100;
      const cessAmt = taxableAmt * cessPct / 100;
      const amount = taxableAmt + taxAmt + cessAmt;
      subtotal += taxableAmt; totalDiscount += effectiveDisc; totalTax += taxAmt;
      if (isGst) {
        if (isInterstate) igst += taxAmt; else { cgst += taxAmt / 2; sgst += taxAmt / 2; }
      }
      const qtyBoxes = item.qtyBoxes != null ? Number(item.qtyBoxes) : null;
      const litersPerBox = item.litersPerBox != null ? Number(item.litersPerBox) : null;
      const totalLiters = qtyBoxes != null && litersPerBox != null ? qtyBoxes * litersPerBox : null;
      return {
        ...item,
        qty: String(qty), rate: String(rate), mrp: String(item.mrp),
        discountPct: String(discPct), discountAmt: String(effectiveDisc),
        taxPct: String(taxPct), cessPct: String(cessPct),
        netPrice: String(rate - rate * discPct / 100),
        amount: String(amount),
        qtyBoxesVal: qtyBoxes != null ? String(qtyBoxes) : null,
        totalLitersVal: totalLiters != null ? String(totalLiters) : null,
      };
    });
    const freight = Number(data.freight ?? existing.freight ?? 0);
    const roundOff = Number(data.roundOff ?? existing.round_off ?? 0);
    const newGrandTotal = subtotal + totalTax + freight + roundOff;
    const amountPaid = Number(existing.amount_paid ?? 0);
    const balanceDue = isQuotationEdit ? 0 : newGrandTotal - amountPaid;

    // 4. Update invoice header + new totals
    const dueDateVal = data.dueDate === undefined
      ? existing.due_date
      : (data.dueDate === null || data.dueDate === "" ? null : new Date(data.dueDate));

    // Resolve salesman_name canonically whenever salesman_id is provided or already
    // set so the admin invoices list stays accurate after edits/reassignment.
    const resolvedSalesmanId: number | null =
      data.salesmanId === undefined ? (existing.salesman_id ?? null) : data.salesmanId;
    let resolvedSalesmanName: string | null = existing.salesman_name ?? null;
    if (data.salesmanId !== undefined) {
      if (resolvedSalesmanId === null) {
        resolvedSalesmanName = null;
      } else {
        const [sm] = await client.query(
          `SELECT name FROM entities WHERE id = $1 AND company_id = $2`,
          [resolvedSalesmanId, companyId]
        ).then((r) => [r.rows[0]]);
        resolvedSalesmanName = sm?.name ?? null;
      }
    } else if (resolvedSalesmanId !== null && !resolvedSalesmanName) {
      // Heal legacy rows that have salesman_id but no name persisted.
      const [sm] = await client.query(
        `SELECT name FROM entities WHERE id = $1 AND company_id = $2`,
        [resolvedSalesmanId, companyId]
      ).then((r) => [r.rows[0]]);
      resolvedSalesmanName = sm?.name ?? null;
    }

    await client.query(
      `UPDATE invoices SET
         invoice_type = $1, invoice_date = $2, due_date = $3, customer_id = $4, customer_name = $5,
         customer_gstin = $6, billing_address = $7, shipping_address = $8, place_of_supply = $9,
         salesman_id = $10, salesman_name = $11, po_number = $12, e_way_bill_no = $13,
         subtotal = $14, total_discount = $15, total_tax = $16, cgst = $17, sgst = $18, igst = $19,
         freight = $20, round_off = $21, grand_total = $22, balance_due = $23, status = $24
       WHERE id = $25 AND company_id = $26`,
      [
        data.invoiceType ?? existing.invoice_type,
        data.invoiceDate ?? existing.invoice_date,
        dueDateVal,
        data.customerId === undefined ? existing.customer_id : data.customerId,
        data.customerName === undefined ? existing.customer_name : data.customerName,
        data.customerGstin === undefined ? existing.customer_gstin : data.customerGstin,
        data.billingAddress === undefined ? existing.billing_address : data.billingAddress,
        data.shippingAddress === undefined ? existing.shipping_address : data.shippingAddress,
        placeOfSupply,
        resolvedSalesmanId,
        resolvedSalesmanName,
        data.poNumber === undefined ? existing.po_number : data.poNumber,
        data.eWayBillNo === undefined ? existing.e_way_bill_no : data.eWayBillNo,
        String(subtotal), String(totalDiscount), String(totalTax),
        String(cgst), String(sgst), String(igst),
        String(freight), String(roundOff), String(newGrandTotal), String(balanceDue),
        data.status ?? existing.status,
        invoiceId,
        companyId,
      ]
    );

    // 5. Insert new line items + outward stock movements (skip stock for quotations)
    for (const item of processedItems) {
      const prodName = (await db.select({ name: productsTable.name }).from(productsTable).where(and(eq(productsTable.companyId, companyId), eq(productsTable.id, item.productId))))[0]?.name ?? "Unknown";
      await client.query(
        `INSERT INTO invoice_items (company_id, invoice_id, product_id, product_name, hsn_code, qty, qty_boxes, total_liters, unit, rate, mrp, discount_pct, discount_amt, tax_pct, cess_pct, net_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [companyId, invoiceId, item.productId, prodName, null, item.qty, item.qtyBoxesVal, item.totalLitersVal, item.unit, item.rate, item.mrp, item.discountPct, item.discountAmt, item.taxPct, item.cessPct, item.netPrice, item.amount]
      );
      if (!isQuotationEdit) {
        await client.query(
          `INSERT INTO stock_movements (company_id, product_id, type, quantity, reason, reference_id, reference_type, user_id)
           VALUES ($1, $2, 'outward', $3, $4, $5, 'invoice_edit', $6)`,
          [companyId, item.productId, item.qty, `Invoice ${existing.invoice_no} edit — new qty`, invoiceId, session?.userId ?? 1]
        );
        await client.query(`UPDATE products SET current_stock = current_stock - $1 WHERE id = $2 AND company_id = $3`, [item.qty, item.productId, companyId]);
      }
    }

    // 6. Apply new customer outstanding + ledger entry (skip for quotations)
    const newCustomerId: number | null = data.customerId === undefined ? oldCustomerId : data.customerId;
    if (newCustomerId && !isQuotationEdit) {
      await client.query(
        `UPDATE entities SET outstanding_balance = outstanding_balance + $1 WHERE id = $2 AND company_id = $3`,
        [newGrandTotal, newCustomerId, companyId]
      );
      const balRes = await client.query(`SELECT outstanding_balance FROM entities WHERE id = $1 AND company_id = $2`, [newCustomerId, companyId]);
      const newBal = balRes.rows[0]?.outstanding_balance ?? 0;
      await client.query(
        `INSERT INTO ledger_entries (company_id, entity_id, date, description, debit, credit, balance, type, reference_id, reference_no)
         VALUES ($1, $2, NOW(), $3, $4, 0, $5, 'invoice_edit', $6, $7)`,
        [companyId, newCustomerId, `Invoice ${existing.invoice_no} (edited)`, newGrandTotal, newBal, invoiceId, existing.invoice_no]
      );
    }

    // 7. Audit log
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, 'invoice_edited', $2, $3, $4, $5)`,
      [
        companyId,
        `Invoice ${existing.invoice_no} edited: ₹${oldGrandTotal} → ₹${newGrandTotal.toFixed(2)} (${oldItemsRes.rows.length} → ${processedItems.length} items)`,
        session?.userId ?? 1,
        session?.name ?? "Unknown",
        JSON.stringify({
          invoiceId, invoiceNo: existing.invoice_no,
          oldGrandTotal, newGrandTotal, oldItemCount: oldItemsRes.rows.length, newItemCount: processedItems.length,
          oldCustomerId, newCustomerId,
        }),
      ]
    );

    await client.query("COMMIT");

    const [fullInv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.id, invoiceId)));
    const newItems = await db.select().from(invoiceItemsTable).where(and(eq(invoiceItemsTable.companyId, companyId), eq(invoiceItemsTable.invoiceId, invoiceId)));
    res.json(formatInvoice(fullInv, newItems));
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to edit invoice");
    res.status(500).json({ error: "Failed to edit invoice" });
  } finally {
    client.release();
  }
});

// DELETE /invoices/:id  — admin only
router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const session = (req as any).session;
  const companyId = getCompanyId(req);
  if (session?.role !== "admin") {
    res.status(403).json({ error: "Only admins can cancel invoices" });
    return;
  }
  const params = DeleteInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const client = await pool.connect();

  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // Existence check first — distinguish 404 (no such invoice) from 409
    // (exists but already cancelled). Read inside the txn client so it
    // participates in the SERIALIZABLE snapshot.
    const existsRes = await client.query(
      `SELECT id FROM invoices WHERE id = $1 AND company_id = $2`,
      [params.data.id, companyId]
    );
    if (existsRes.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    // Business policy (per admin request): cancelling an invoice — whether GST
    // or non-GST — does NOT touch inventory. Stock is intentionally left as-is
    // because physical goods have usually already left the premises by the time
    // a bill is voided. The cancellation is recorded in the audit log so the
    // discrepancy is fully traceable.
    //
    // Conditional UPDATE ... RETURNING gives us atomic idempotency: if a
    // concurrent request already flipped the status to 'cancelled', rowCount
    // will be 0 and we respond 409 without double-writing an audit row.
    const updated = await client.query(
      `UPDATE invoices
         SET status = 'cancelled'
       WHERE id = $1 AND company_id = $2 AND status <> 'cancelled'
       RETURNING id, invoice_no, invoice_type, grand_total, customer_id, customer_name`,
      [params.data.id, companyId]
    );
    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(409).json({ error: "Invoice is already cancelled" });
      return;
    }
    const inv = {
      invoiceNo: updated.rows[0].invoice_no,
      invoiceType: updated.rows[0].invoice_type,
      grandTotal: updated.rows[0].grand_total,
      customerId: updated.rows[0].customer_id,
      customerName: updated.rows[0].customer_name,
    };

    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, 'invoice_cancelled', $2, $3, $4, $5)`,
      [
        companyId,
        `${inv.invoiceType === "gst" ? "GST" : "Non-GST"} invoice ${inv.invoiceNo} cancelled by admin — stock NOT reversed per policy`,
        session?.userId ?? 1,
        session?.name ?? "Unknown",
        JSON.stringify({
          invoiceId: params.data.id,
          invoiceNo: inv.invoiceNo,
          invoiceType: inv.invoiceType,
          grandTotal: Number(inv.grandTotal),
          customerId: inv.customerId,
          customerName: inv.customerName,
        }),
      ]
    );

    await client.query("COMMIT");
    res.sendStatus(204);
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err }, "Failed to delete invoice");
    res.status(500).json({ error: "Failed to delete invoice" });
  } finally {
    client.release();
  }
});

function formatInvoice(inv: any, items: any[]) {
  return {
    id: inv.id,
    invoiceNo: inv.invoiceNo,
    invoiceDate: inv.invoiceDate?.toISOString?.() ?? inv.invoiceDate,
    dueDate: inv.dueDate ? (inv.dueDate?.toISOString?.() ?? inv.dueDate) : null,
    invoiceType: inv.invoiceType,
    customerId: inv.customerId ?? null,
    customerName: inv.customerName ?? null,
    customerGstin: inv.customerGstin ?? null,
    billingAddress: inv.billingAddress ?? null,
    shippingAddress: inv.shippingAddress ?? null,
    placeOfSupply: inv.placeOfSupply,
    salesmanId: inv.salesmanId ?? null,
    salesmanName: inv.salesmanName ?? null,
    poNumber: inv.poNumber ?? null,
    eWayBillNo: inv.eWayBillNo ?? null,
    subtotal: Number(inv.subtotal),
    totalDiscount: Number(inv.totalDiscount),
    totalTax: Number(inv.totalTax),
    cgst: Number(inv.cgst),
    sgst: Number(inv.sgst),
    igst: Number(inv.igst),
    freight: Number(inv.freight),
    roundOff: Number(inv.roundOff),
    grandTotal: Number(inv.grandTotal),
    amountPaid: Number(inv.amountPaid),
    balanceDue: Number(inv.balanceDue),
    status: inv.status,
    items: items.map(formatItem),
    createdAt: inv.createdAt?.toISOString?.() ?? inv.createdAt,
  };
}

function formatItem(i: any) {
  return {
    id: i.id,
    invoiceId: i.invoiceId,
    productId: i.productId,
    productName: i.productName,
    hsnCode: i.hsnCode ?? null,
    qty: Number(i.qty),
    qtyBoxes: i.qtyBoxes != null ? Number(i.qtyBoxes) : null,
    totalLiters: i.totalLiters != null ? Number(i.totalLiters) : null,
    unit: i.unit,
    rate: Number(i.rate),
    mrp: Number(i.mrp),
    discountPct: Number(i.discountPct),
    discountAmt: Number(i.discountAmt),
    taxPct: Number(i.taxPct),
    cessPct: Number(i.cessPct),
    netPrice: Number(i.netPrice),
    amount: Number(i.amount),
  };
}

export default router;
