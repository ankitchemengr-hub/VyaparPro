import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { pool, db, productsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { generateSeriesNumber } from "../lib/number-series";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

const ORDER_STATUSES = [
  "pending",
  "processing",
  "production",
  "ready_for_dispatch",
  "dispatched",
  "delivered",
  "done",
  "cancelled",
] as const;
type OrderStatus = typeof ORDER_STATUSES[number];

// Statuses that should trigger workload-card creation (manufacturing demand).
const PRODUCTION_STATUSES = new Set(["processing", "production"]);

function formatOrder(row: any) {
  return {
    id: row.id,
    orderNo: row.order_no ?? null,
    userId: row.user_id ?? null,
    entityId: row.entity_id ?? null,
    customerName: row.customer_name,
    customerMobile: row.customer_mobile ?? null,
    status: row.status as OrderStatus,
    isDraft: row.is_draft ?? false,
    totalItems: Number(row.total_items ?? 0),
    totalAmount: Number(row.total_amount ?? 0),
    notes: row.notes ?? null,
    adminRemarks: row.admin_remarks ?? null,
    vehicleNumber: row.vehicle_number ?? null,
    driverName: row.driver_name ?? null,
    dispatchDate: row.dispatch_date?.toISOString ? row.dispatch_date.toISOString() : (row.dispatch_date ?? null),
    dispatchStatus: row.dispatch_status ?? null,
    createdAt: row.created_at?.toISOString ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at?.toISOString ? row.updated_at.toISOString() : row.updated_at,
  };
}

function formatItem(r: any) {
  return {
    id: r.id,
    orderId: r.order_id,
    productId: r.product_id,
    productName: r.product_name,
    unit: r.unit ?? null,
    qty: Number(r.qty),
    unitPrice: Number(r.unit_price),
    lineTotal: Number(r.line_total),
    workloadCardId: r.workload_card_id ?? null,
  };
}

// POST /customer-orders — customer (own) or admin
router.post("/customer-orders", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (
    session.role !== "customer" &&
    session.role !== "admin" &&
    session.role !== "salesman"
  ) {
    res.status(403).json({ error: "Not allowed to place orders" });
    return;
  }

  const companyId = getCompanyId(req);

  const body = req.body ?? {};
  const isDraft = body.isDraft === true;
  const items: Array<{ productId: number; qty: number }> = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    res.status(400).json({ error: "Order must have at least one item" });
    return;
  }

  // Resolve customer info — prefer linked entity for role=customer
  let customerName = String(body.customerName ?? session.name ?? session.username ?? "").trim();
  let customerMobile = String(body.customerMobile ?? "").trim() || null;
  let entityId: number | null = body.entityId != null ? Number(body.entityId) : null;

  if (session.role === "customer") {
    const entRows = await pool.query(
      `SELECT id, name, mobile FROM entities WHERE user_id = $1 AND type = 'customer' AND company_id = $2 LIMIT 1`,
      [session.userId, companyId]
    );
    if (entRows.rows[0]) {
      entityId = entRows.rows[0].id;
      if (!customerName) customerName = entRows.rows[0].name;
      if (!customerMobile) customerMobile = entRows.rows[0].mobile ?? null;
    }
  }
  if (!customerName) customerName = session.name ?? session.username ?? "Customer";

  // Fetch product info for pricing snapshot
  const productIds = Array.from(new Set(items.map((i) => Number(i.productId)).filter((x) => Number.isFinite(x))));
  const products = productIds.length
    ? await db.select().from(productsTable).where(and(eq(productsTable.companyId, companyId), inArray(productsTable.id, productIds)))
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  let totalAmount = 0;
  let totalItems = 0;
  const resolvedItems: Array<{
    productId: number; productName: string; unit: string | null; qty: number; unitPrice: number; lineTotal: number;
  }> = [];

  for (const it of items) {
    const pid = Number(it.productId);
    const qty = Number(it.qty);
    if (!Number.isFinite(pid) || !Number.isFinite(qty) || qty <= 0) continue;
    const p = byId.get(pid);
    if (!p) continue;
    // Salesman-created orders are quoted at the wholesale (B2B) tier, matching
    // the salesman order-entry UI; customers are billed at retail.
    const price =
      session.role === "salesman"
        ? Number(p.wholesalePrice ?? p.retailPrice ?? 0)
        : Number(p.retailPrice ?? 0);
    const lineTotal = qty * price;
    resolvedItems.push({
      productId: pid,
      productName: p.name,
      unit: p.unit ?? null,
      qty,
      unitPrice: price,
      lineTotal,
    });
    totalAmount += lineTotal;
    totalItems += qty;
  }
  if (resolvedItems.length === 0) {
    res.status(400).json({ error: "No valid items in order" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Customer-placed orders go directly to "processing" so the manufacturing
    // team sees them on the workload board immediately.
    // Drafts (salesman work-in-progress) stay pending with no manufacturing demand.
    const initialStatus = isDraft
      ? "pending"
      : session.role === "customer"
        ? "processing"
        : "pending";
    const ins = await client.query(
      `INSERT INTO customer_orders
         (company_id, user_id, entity_id, customer_name, customer_mobile, status, is_draft, total_items, total_amount, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [companyId, session.userId, entityId, customerName, customerMobile, initialStatus, isDraft, totalItems, totalAmount, body.notes ?? null]
    );
    const order = ins.rows[0];

    // Order numbers come from the configurable `order` series. Drafts are
    // work-in-progress and don't burn a number until submitted.
    const orderNo = isDraft
      ? `DRAFT-${order.id}`
      : await generateSeriesNumber(client, "order", companyId);
    await client.query(`UPDATE customer_orders SET order_no = $1 WHERE id = $2 AND company_id = $3`, [orderNo, order.id, companyId]);
    order.order_no = orderNo;

    for (const it of resolvedItems) {
      const itemIns = await client.query(
        `INSERT INTO customer_order_items
           (company_id, order_id, product_id, product_name, unit, qty, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [companyId, order.id, it.productId, it.productName, it.unit, it.qty, it.unitPrice, it.lineTotal]
      );
      // Auto-create workload card for customer orders so manufacturing
      // sees the demand right away. Drafts never generate demand.
      if (!isDraft && PRODUCTION_STATUSES.has(initialStatus)) {
        const wlIns = await client.query(
          `INSERT INTO workload_cards (company_id, product_id, target_qty, status, order_type, reference_order_id)
           VALUES ($1, $2, $3, 'pending', 'customer_backorder', $4)
           RETURNING id`,
          [companyId, it.productId, it.qty, order.id]
        );
        await client.query(
          `UPDATE customer_order_items SET workload_card_id = $1 WHERE id = $2 AND company_id = $3`,
          [wlIns.rows[0].id, itemIns.rows[0].id, companyId]
        );
      }
    }
    // ── Commission generation ──────────────────────────────────────────────
    // When a non-draft order is placed by a tracked customer who has an
    // assigned salesman with an active commission period, snapshot the
    // commission into commission_transactions (same logic as invoices.ts).
    if (!isDraft && entityId) {
      const custRes = await client.query(
        `SELECT assigned_salesman_id, commission_expiry_date FROM entities WHERE id = $1 AND company_id = $2`,
        [entityId, companyId]
      );
      const cust = custRes.rows[0];
      if (
        cust?.assigned_salesman_id &&
        (!cust.commission_expiry_date || new Date(cust.commission_expiry_date) > new Date())
      ) {
        const salesmanId = cust.assigned_salesman_id;
        const smRes = await client.query(
          `SELECT name FROM entities WHERE id = $1 AND company_id = $2`,
          [salesmanId, companyId]
        );
        const salesmanName: string = smRes.rows[0]?.name ?? "";

        let totalCommission = 0;
        let totalLiters = 0;
        for (const it of resolvedItems) {
          const p = byId.get(it.productId);
          const commPerLiter = Number((p as any)?.commissionPerLiter ?? 0);
          totalLiters += it.qty;
          totalCommission += it.qty * commPerLiter;
        }

        if (totalCommission > 0 || totalLiters > 0) {
          await client.query(
            `INSERT INTO commission_transactions
               (company_id, invoice_id, invoice_no, salesman_id, salesman_name,
                customer_id, customer_name, total_liters, commission_amount, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')`,
            [
              companyId,
              order.id,
              orderNo,
              salesmanId,
              salesmanName,
              entityId,
              customerName,
              String(totalLiters),
              String(totalCommission),
            ]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.status(201).json(formatOrder(order));
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    req.log?.error({ err }, "customer-order create failed");
    res.status(500).json({ error: err?.message ?? "Server error" });
  } finally {
    client.release();
  }
});

// GET /customer-orders — admin: all; customer: own
router.get("/customer-orders", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const companyId = getCompanyId(req);
  const status = typeof req.query.status === "string" ? String(req.query.status) : null;
  const params: any[] = [companyId];
  const where: string[] = [`company_id = $1`];

  if (session.role === "customer" || session.role === "salesman") {
    params.push(session.userId);
    where.push(`user_id = $${params.length}`);
  } else if (session.role !== "admin" && session.role !== "manufacturing" && session.role !== "store") {
    // Manufacturing and store workers need to see all orders (dispatch queue etc.).
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const sqlText = `SELECT * FROM customer_orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 200`;
  const result = await pool.query(sqlText, params);
  res.json(result.rows.map(formatOrder));
});

// GET /customer-orders/:id — admin or owner
router.get("/customer-orders/:id", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const companyId = getCompanyId(req);
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const head = await pool.query(`SELECT * FROM customer_orders WHERE id = $1 AND company_id = $2`, [id, companyId]);
  const order = head.rows[0];
  if (!order) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (session.role === "customer" || session.role === "salesman") {
    if (order.user_id !== session.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  } else if (session.role !== "admin" && session.role !== "manufacturing" && session.role !== "store") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const itemsRes = await pool.query(`SELECT * FROM customer_order_items WHERE order_id = $1 AND company_id = $2 ORDER BY id ASC`, [id, companyId]);
  res.json({
    ...formatOrder(order),
    items: itemsRes.rows.map(formatItem),
  });
});

// Status transitions each non-admin role is allowed to perform.
const SALESMAN_STATUSES = new Set(["processing", "production", "cancelled"]);
const MANUFACTURING_STATUSES = new Set([
  "production",
  "ready_for_dispatch",
  "dispatched",
  "delivered",
]);

// PATCH /customer-orders/:id/status — admin (any), salesman (own draft submit),
// manufacturing (production/dispatch lifecycle).
router.patch("/customer-orders/:id/status", async (req, res): Promise<void> => {
  const session = (req as any).session;
  const role = session?.role;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (role !== "admin" && role !== "salesman" && role !== "manufacturing") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const companyId = getCompanyId(req);
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const newStatus = String(req.body?.status ?? "");
  if (!(ORDER_STATUSES as readonly string[]).includes(newStatus)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }
  const adminRemarks: string | null = req.body?.adminRemarks ?? null;
  const vehicleNumber: string | null = req.body?.vehicleNumber ?? null;
  const driverName: string | null = req.body?.driverName ?? null;
  const dispatchDate: string | null = req.body?.dispatchDate ?? null;
  // Submitting a draft clears the draft flag; otherwise leave it untouched.
  const isDraft: boolean | null = typeof req.body?.isDraft === "boolean" ? req.body.isDraft : null;
  // Keep a lightweight dispatch_status mirror in sync with key lifecycle states.
  const dispatchStatus =
    newStatus === "ready_for_dispatch"
      ? "ready"
      : newStatus === "dispatched"
        ? "dispatched"
        : newStatus === "delivered"
          ? "delivered"
          : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingRes = await client.query(
      `SELECT * FROM customer_orders WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [id, companyId]
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Per-role transition rules (admin is unrestricted). These validate the
    // actual from->to transition, not just the target status, so non-admin
    // roles cannot force illogical lifecycle jumps (e.g. cancelled->production).
    const fromStatus = String(existing.status);
    if (role === "salesman") {
      // Salesmen may only act on their OWN order, and only to submit a still-
      // draft/pending order into the live pipeline or to cancel it.
      const isOwn = existing.user_id === session.userId;
      const submittable = existing.is_draft === true || fromStatus === "pending";
      if (!isOwn || !submittable || !SALESMAN_STATUSES.has(newStatus)) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    } else if (role === "manufacturing") {
      // Manufacturing drives forward production/dispatch transitions only.
      const allowedFrom: Record<string, string[]> = {
        production: ["processing", "production"],
        ready_for_dispatch: ["processing", "production", "ready_for_dispatch"],
        dispatched: ["ready_for_dispatch", "dispatched"],
        delivered: ["dispatched", "delivered"],
      };
      const validFrom = allowedFrom[newStatus];
      if (!MANUFACTURING_STATUSES.has(newStatus) || !validFrom || !validFrom.includes(fromStatus)) {
        await client.query("ROLLBACK");
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }

    // On transition into production, create workload cards for each item that
    // doesn't already have one. Never resurrect demand for terminal/post-
    // production states (cancelled/dispatched/delivered/done).
    const NON_PRODUCIBLE = new Set(["cancelled", "dispatched", "delivered", "done"]);
    if (PRODUCTION_STATUSES.has(newStatus) && !PRODUCTION_STATUSES.has(existing.status) && !NON_PRODUCIBLE.has(fromStatus)) {
      const itemsRes = await client.query(
        `SELECT * FROM customer_order_items WHERE order_id = $1 AND company_id = $2`,
        [id, companyId]
      );
      for (const it of itemsRes.rows) {
        if (it.workload_card_id) continue;
        const ins = await client.query(
          `INSERT INTO workload_cards (company_id, product_id, target_qty, status, order_type, reference_order_id)
           VALUES ($1, $2, $3, 'pending', 'customer_backorder', $4)
           RETURNING id`,
          [companyId, it.product_id, it.qty, id]
        );
        await client.query(
          `UPDATE customer_order_items SET workload_card_id = $1 WHERE id = $2 AND company_id = $3`,
          [ins.rows[0].id, it.id, companyId]
        );
      }
    }

    const upd = await client.query(
      `UPDATE customer_orders
         SET status = $1,
             admin_remarks = COALESCE($2, admin_remarks),
             vehicle_number = COALESCE($3, vehicle_number),
             driver_name = COALESCE($4, driver_name),
             dispatch_date = COALESCE($5, dispatch_date),
             dispatch_status = COALESCE($6, dispatch_status),
             is_draft = COALESCE($7, is_draft),
             updated_at = NOW()
       WHERE id = $8 AND company_id = $9
       RETURNING *`,
      [
        newStatus,
        adminRemarks,
        vehicleNumber,
        driverName,
        dispatchDate ? new Date(dispatchDate) : null,
        dispatchStatus,
        isDraft,
        id,
        companyId,
      ]
    );
    await client.query("COMMIT");
    res.json(formatOrder(upd.rows[0]));
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    req.log?.error({ err }, "customer-order status update failed");
    res.status(500).json({ error: err?.message ?? "Server error" });
  } finally {
    client.release();
  }
});

export default router;
