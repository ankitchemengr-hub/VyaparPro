/**
 * WhatsApp Service Layer
 *
 * Abstracts Meta Cloud API so the ERP architecture stays unchanged when the
 * API key / phone-number-id is configured. Right now every call is logged to
 * the DB and returns a stub success result — no real HTTP request is made.
 *
 * To connect Meta Cloud API:
 *  1. Set env vars: WA_PHONE_NUMBER_ID, WA_ACCESS_TOKEN
 *  2. Uncomment the fetch() block inside sendViaMetaCloudApi()
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type WaMessageType =
  | "invoice_pdf"
  | "order_confirmation"
  | "payment_reminder"
  | "outstanding_reminder"
  | "dispatch_status"
  | "vehicle_details";

export type WaDeliveryStatus = "sent" | "delivered" | "failed" | "pending";

export interface WaSendParams {
  companyId: number;
  toNumber: string;
  messageType: WaMessageType;
  messageBody: string;
  customerId?: number | null;
  customerName?: string | null;
  referenceId?: number | null;
  referenceType?: string | null;
}

export interface WaSendResult {
  success: boolean;
  logId?: number;
  messageId?: string;
  error?: string;
}

// ─── Meta Cloud API stub ──────────────────────────────────────────────────────

async function sendViaMetaCloudApi(toNumber: string, body: string): Promise<{ messageId: string }> {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const accessToken   = process.env.WA_ACCESS_TOKEN;

  if (phoneNumberId && accessToken) {
    // ── Live path (uncomment when credentials are configured) ─────────────
    // const res = await fetch(
    //   `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    //   {
    //     method: "POST",
    //     headers: {
    //       Authorization: `Bearer ${accessToken}`,
    //       "Content-Type": "application/json",
    //     },
    //     body: JSON.stringify({
    //       messaging_product: "whatsapp",
    //       to: toNumber.startsWith("+") ? toNumber : `91${toNumber}`,
    //       type: "text",
    //       text: { body },
    //     }),
    //   },
    // );
    // if (!res.ok) throw new Error(`Meta API error ${res.status}: ${await res.text()}`);
    // const json = await res.json();
    // return { messageId: json.messages?.[0]?.id ?? "unknown" };
    logger.warn("WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN are set but live send is commented out — stub used");
  }

  // Stub: simulate a successful send without hitting any external API
  return { messageId: `stub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
}

// ─── Main send function ───────────────────────────────────────────────────────

export async function sendWhatsAppMessage(params: WaSendParams): Promise<WaSendResult> {
  let status: WaDeliveryStatus = "pending";
  let messageId: string | null = null;
  let errorText: string | null = null;

  try {
    const result = await sendViaMetaCloudApi(params.toNumber, params.messageBody);
    messageId = result.messageId;
    status = "sent";
  } catch (err: any) {
    errorText = err?.message ?? "Unknown error";
    status = "failed";
    logger.warn({ err, toNumber: params.toNumber, messageType: params.messageType }, "WhatsApp send failed");
  }

  // Always write a log row regardless of success/failure
  let logId: number | undefined;
  try {
    const logRes = await pool.query(
      `INSERT INTO whatsapp_logs
         (company_id, customer_id, customer_name, mobile_number, message_type,
          message_body, reference_id, reference_type, delivery_status, wa_message_id, error_text)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        params.companyId,
        params.customerId ?? null,
        params.customerName ?? null,
        params.toNumber,
        params.messageType,
        params.messageBody,
        params.referenceId ?? null,
        params.referenceType ?? null,
        status,
        messageId,
        errorText,
      ],
    );
    logId = logRes.rows[0]?.id;
  } catch (logErr) {
    logger.error({ logErr }, "Failed to write whatsapp_logs row");
  }

  if (status === "failed") {
    return { success: false, logId, error: errorText ?? "Send failed" };
  }
  return { success: true, logId, messageId: messageId ?? undefined };
}

// ─── Message template helpers ─────────────────────────────────────────────────

export function buildInvoiceMessage(opts: {
  customerName: string; invoiceNo: string; grandTotal: number; companyName: string;
}): string {
  return `Dear *${opts.customerName}*,\n\nYour invoice *${opts.invoiceNo}* of ₹${opts.grandTotal.toLocaleString("en-IN")} from *${opts.companyName}* has been generated.\n\nThank you for your business! 🙏`;
}

export function buildOrderConfirmationMessage(opts: {
  customerName: string; invoiceNo: string; companyName: string;
}): string {
  return `Dear *${opts.customerName}*,\n\nYour order *${opts.invoiceNo}* has been *confirmed* by *${opts.companyName}* ✅\n\nWe will keep you updated on the delivery status.`;
}

export function buildPaymentReminderMessage(opts: {
  customerName: string; invoiceNo: string; amount: number; companyName: string;
}): string {
  return `Dear *${opts.customerName}*,\n\n⚠️ Friendly reminder: Your payment of ₹${opts.amount.toLocaleString("en-IN")} for invoice *${opts.invoiceNo}* is due.\n\nPlease arrange payment at the earliest convenience.\n\n— *${opts.companyName}*`;
}

export function buildOutstandingReminderMessage(opts: {
  customerName: string; outstandingAmount: number; companyName: string;
}): string {
  return `Dear *${opts.customerName}*,\n\n⚠️ You have an outstanding balance of ₹${opts.outstandingAmount.toLocaleString("en-IN")} with *${opts.companyName}*.\n\nKindly clear your dues at the earliest. Contact us for any queries.\n\n— *${opts.companyName}*`;
}

export function buildDispatchStatusMessage(opts: {
  customerName: string; invoiceNo: string; transporterName?: string | null;
  vehicleNumber?: string | null; lrNumber?: string | null; companyName: string;
}): string {
  let msg = `Dear *${opts.customerName}*,\n\n🚚 Your order *${opts.invoiceNo}* has been *dispatched* by *${opts.companyName}*.`;
  if (opts.transporterName) msg += `\n📦 Transporter: ${opts.transporterName}`;
  if (opts.vehicleNumber)   msg += `\n🚛 Vehicle No: *${opts.vehicleNumber}*`;
  if (opts.lrNumber)        msg += `\n📋 LR No: ${opts.lrNumber}`;
  msg += "\n\nThank you for your business! 🙏";
  return msg;
}

export function buildVehicleDetailsMessage(opts: {
  customerName: string; vehicleNumber: string; transporterName?: string | null;
  lrNumber?: string | null; companyName: string;
}): string {
  let msg = `Dear *${opts.customerName}*,\n\n🚛 Vehicle details for your delivery from *${opts.companyName}*:\n\nVehicle No: *${opts.vehicleNumber}*`;
  if (opts.transporterName) msg += `\nTransporter: ${opts.transporterName}`;
  if (opts.lrNumber)        msg += `\nLR No: ${opts.lrNumber}`;
  return msg;
}
