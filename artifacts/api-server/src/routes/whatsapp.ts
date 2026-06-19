import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import {
  sendWhatsAppMessage,
  buildInvoiceMessage,
  buildOrderConfirmationMessage,
  buildPaymentReminderMessage,
  buildOutstandingReminderMessage,
  buildDispatchStatusMessage,
  buildVehicleDetailsMessage,
} from "../lib/whatsapp";

const router: IRouter = Router();

const READ_ROLES  = new Set(["admin", "accountant"]);
const WRITE_ROLES = new Set(["admin"]);

function requireRead(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !READ_ROLES.has(role)) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}
function requireWrite(req: any, res: any): boolean {
  const role = (req as any).session?.role;
  if (!role || !WRITE_ROLES.has(role)) { res.status(403).json({ error: "Forbidden — admin only" }); return false; }
  return true;
}

// ─────────────────────────────────────────────────────────────
// WhatsApp Number on Entity (stored as patch column)
// ─────────────────────────────────────────────────────────────

// GET /whatsapp/entity/:id/number
router.get("/whatsapp/entity/:id/number", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  const entityId = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      `SELECT whatsapp_number FROM entities WHERE company_id = $1 AND id = $2`,
      [companyId, entityId],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Entity not found" }); return; }
    res.json({ whatsappNumber: result.rows[0].whatsapp_number ?? null });
  } catch (err) {
    logger.error({ err }, "GET /whatsapp/entity/:id/number failed");
    res.status(500).json({ error: "Failed to fetch WhatsApp number" });
  }
});

// PATCH /whatsapp/entity/:id/number
router.patch("/whatsapp/entity/:id/number", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const entityId = parseInt(req.params.id, 10);
  const { whatsappNumber } = req.body ?? {};
  const cleaned = whatsappNumber?.toString().replace(/\D/g, "").slice(-10) || null;
  try {
    const result = await pool.query(
      `UPDATE entities SET whatsapp_number = $1 WHERE company_id = $2 AND id = $3 RETURNING id`,
      [cleaned, companyId, entityId],
    );
    if (result.rows.length === 0) { res.status(404).json({ error: "Entity not found" }); return; }
    res.json({ whatsappNumber: cleaned });
  } catch (err) {
    logger.error({ err }, "PATCH /whatsapp/entity/:id/number failed");
    res.status(500).json({ error: "Failed to update WhatsApp number" });
  }
});

// ─────────────────────────────────────────────────────────────
// WhatsApp Logs
// ─────────────────────────────────────────────────────────────

// GET /whatsapp/logs
router.get("/whatsapp/logs", async (req, res): Promise<void> => {
  if (!requireRead(req, res)) return;
  const companyId = getCompanyId(req);
  const { customerId, messageType, from, to, limit: limitQ } = req.query as any;
  const params: any[] = [companyId];
  let where = "WHERE company_id = $1";
  if (customerId) { params.push(parseInt(customerId, 10)); where += ` AND customer_id = $${params.length}`; }
  if (messageType) { params.push(messageType); where += ` AND message_type = $${params.length}`; }
  if (from) { params.push(new Date(from + "T00:00:00")); where += ` AND sent_at >= $${params.length}`; }
  if (to)   { params.push(new Date(to + "T23:59:59")); where += ` AND sent_at <= $${params.length}`; }
  const rowLimit = Math.min(parseInt(limitQ ?? "200", 10), 500);
  try {
    const result = await pool.query(
      `SELECT * FROM whatsapp_logs ${where} ORDER BY sent_at DESC LIMIT ${rowLimit}`,
      params,
    );
    res.json(result.rows.map(fmtLog));
  } catch (err) {
    logger.error({ err }, "GET /whatsapp/logs failed");
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// ─────────────────────────────────────────────────────────────
// Send Endpoints
// ─────────────────────────────────────────────────────────────

// POST /whatsapp/send/invoice
router.post("/whatsapp/send/invoice", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const { invoiceId, toNumber, messageType = "invoice_pdf" } = req.body ?? {};
  if (!invoiceId || !toNumber) { res.status(400).json({ error: "invoiceId and toNumber are required" }); return; }
  try {
    // Fetch invoice + company info
    const invRes = await pool.query(
      `SELECT i.invoice_no, i.grand_total, i.balance_due,
              e.name AS customer_name, e.id AS customer_id,
              c.name AS company_name
       FROM invoices i
       LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.company_id = $1 AND i.id = $2`,
      [companyId, invoiceId],
    );
    if (invRes.rows.length === 0) { res.status(404).json({ error: "Invoice not found" }); return; }
    const inv = invRes.rows[0];

    const body = messageType === "order_confirmation"
      ? buildOrderConfirmationMessage({ customerName: inv.customer_name ?? "Customer", invoiceNo: inv.invoice_no, companyName: inv.company_name ?? "us" })
      : buildInvoiceMessage({ customerName: inv.customer_name ?? "Customer", invoiceNo: inv.invoice_no, grandTotal: Number(inv.grand_total ?? 0), companyName: inv.company_name ?? "us" });

    const result = await sendWhatsAppMessage({
      companyId, toNumber,
      messageType,
      messageBody: body,
      customerId: inv.customer_id ?? null,
      customerName: inv.customer_name ?? null,
      referenceId: invoiceId,
      referenceType: "invoice",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /whatsapp/send/invoice failed");
    res.status(500).json({ error: "Failed to send WhatsApp message" });
  }
});

// POST /whatsapp/send/payment-reminder
router.post("/whatsapp/send/payment-reminder", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const { invoiceId, customerId, toNumber } = req.body ?? {};
  if (!toNumber) { res.status(400).json({ error: "toNumber is required" }); return; }
  try {
    let customerName = "Customer", invoiceNo = "", amount = 0, companyName = "us";
    if (invoiceId) {
      const invRes = await pool.query(
        `SELECT i.invoice_no, i.balance_due, e.name AS cname, c.name AS coname
         FROM invoices i
         LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
         LEFT JOIN companies c ON c.id = i.company_id
         WHERE i.company_id = $1 AND i.id = $2`,
        [companyId, invoiceId],
      );
      if (invRes.rows[0]) {
        const r = invRes.rows[0];
        customerName = r.cname ?? customerName;
        invoiceNo = r.invoice_no;
        amount = Number(r.balance_due ?? 0);
        companyName = r.coname ?? companyName;
      }
    } else if (customerId) {
      const cRes = await pool.query(
        `SELECT e.name, e.outstanding_balance, c.name AS coname
         FROM entities e LEFT JOIN companies c ON c.id = e.company_id
         WHERE e.company_id = $1 AND e.id = $2`,
        [companyId, customerId],
      );
      if (cRes.rows[0]) {
        customerName = cRes.rows[0].name ?? customerName;
        amount = Number(cRes.rows[0].outstanding_balance ?? 0);
        companyName = cRes.rows[0].coname ?? companyName;
      }
    }

    const body = buildPaymentReminderMessage({ customerName, invoiceNo, amount, companyName });
    const result = await sendWhatsAppMessage({
      companyId, toNumber,
      messageType: "payment_reminder",
      messageBody: body,
      customerId: customerId ?? null,
      customerName,
      referenceId: invoiceId ?? null,
      referenceType: invoiceId ? "invoice" : null,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /whatsapp/send/payment-reminder failed");
    res.status(500).json({ error: "Failed to send" });
  }
});

// POST /whatsapp/send/outstanding-reminder
router.post("/whatsapp/send/outstanding-reminder", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const { customerId, toNumber } = req.body ?? {};
  if (!customerId || !toNumber) { res.status(400).json({ error: "customerId and toNumber are required" }); return; }
  try {
    const cRes = await pool.query(
      `SELECT e.name, e.outstanding_balance, c.name AS coname
       FROM entities e LEFT JOIN companies c ON c.id = e.company_id
       WHERE e.company_id = $1 AND e.id = $2`,
      [companyId, customerId],
    );
    const r = cRes.rows[0];
    const body = buildOutstandingReminderMessage({
      customerName: r?.name ?? "Customer",
      outstandingAmount: Number(r?.outstanding_balance ?? 0),
      companyName: r?.coname ?? "us",
    });
    const result = await sendWhatsAppMessage({
      companyId, toNumber,
      messageType: "outstanding_reminder",
      messageBody: body,
      customerId,
      customerName: r?.name ?? null,
      referenceId: null, referenceType: null,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /whatsapp/send/outstanding-reminder failed");
    res.status(500).json({ error: "Failed to send" });
  }
});

// POST /whatsapp/send/dispatch-status
router.post("/whatsapp/send/dispatch-status", async (req, res): Promise<void> => {
  if (!requireWrite(req, res)) return;
  const companyId = getCompanyId(req);
  const { dispatchId, toNumber, messageType = "dispatch_status" } = req.body ?? {};
  if (!dispatchId || !toNumber) { res.status(400).json({ error: "dispatchId and toNumber are required" }); return; }
  try {
    const dRes = await pool.query(
      `SELECT d.invoice_no, d.transporter_name, d.vehicle_number, d.lr_number,
              c.name AS company_name
       FROM dispatches d
       LEFT JOIN companies c ON c.id = d.company_id
       WHERE d.company_id = $1 AND d.id = $2`,
      [companyId, dispatchId],
    );
    if (dRes.rows.length === 0) { res.status(404).json({ error: "Dispatch not found" }); return; }
    const d = dRes.rows[0];

    // Fetch customer from linked invoice if available
    let customerName = "Customer", customerId: number | null = null;
    if (d.invoice_no) {
      const iRes = await pool.query(
        `SELECT e.name, e.id FROM invoices i
         LEFT JOIN entities e ON e.id = i.customer_id AND e.company_id = i.company_id
         WHERE i.company_id = $1 AND i.invoice_no = $2 LIMIT 1`,
        [companyId, d.invoice_no],
      );
      if (iRes.rows[0]) { customerName = iRes.rows[0].name ?? customerName; customerId = iRes.rows[0].id ?? null; }
    }

    const body = messageType === "vehicle_details"
      ? buildVehicleDetailsMessage({ customerName, vehicleNumber: d.vehicle_number ?? "N/A", transporterName: d.transporter_name, lrNumber: d.lr_number, companyName: d.company_name ?? "us" })
      : buildDispatchStatusMessage({ customerName, invoiceNo: d.invoice_no ?? "Your Order", transporterName: d.transporter_name, vehicleNumber: d.vehicle_number, lrNumber: d.lr_number, companyName: d.company_name ?? "us" });

    const result = await sendWhatsAppMessage({
      companyId, toNumber,
      messageType,
      messageBody: body,
      customerId,
      customerName,
      referenceId: dispatchId,
      referenceType: "dispatch",
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "POST /whatsapp/send/dispatch-status failed");
    res.status(500).json({ error: "Failed to send" });
  }
});

// ─────────────────────────────────────────────────────────────

function fmtLog(r: any) {
  return {
    id: r.id,
    customerId: r.customer_id ?? null,
    customerName: r.customer_name ?? null,
    mobileNumber: r.mobile_number,
    messageType: r.message_type,
    messageBody: r.message_body,
    referenceId: r.reference_id ?? null,
    referenceType: r.reference_type ?? null,
    deliveryStatus: r.delivery_status,
    waMessageId: r.wa_message_id ?? null,
    errorText: r.error_text ?? null,
    sentAt: r.sent_at?.toISOString?.() ?? r.sent_at,
  };
}

export default router;
