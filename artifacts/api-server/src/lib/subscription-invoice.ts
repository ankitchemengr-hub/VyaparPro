// GST tax invoices for SHRADHA ERP subscription payments (website portal).
//
// Flow: a verified Razorpay payment is activated exactly once (verify OR the
// webhook, whichever lands first — see activateAndInvoicePayment), a tax
// invoice is issued in the same transaction with the next number of the
// financial year (SE/2026-27/0001), and after commit the PDF is emailed to
// the customer. The PDF is rendered on demand from the stored invoice row, so
// the download and the email attachment are always identical.
//
// Prices on the pricing page are BEFORE GST; 18% GST is added on top at
// checkout (CGST 9% + SGST 9% inside Maharashtra, IGST 18% outside).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendMail } from "./mailer";

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

// Supplier on every invoice — keep in step with the website's legal pages
// (artifacts/website/src/lib/legal.ts).
export const SELLER = {
  brand: "SHRADHA ERP",
  legalName: "Yash Enterprises",
  addressLines: ["03, Ganesh Nagar, Bale", "Solapur – 413255, Maharashtra"],
  state: "Maharashtra",
  stateCode: "27",
  gstin: "27BFTPC0657J1Z5",
  email: "support@shradhaerp.com",
  phone: "+91 98607 99449",
} as const;

// SAC 997331 — licensing services for the right to use computer software.
// Confirm with your CA; changing it only affects invoices issued afterwards.
export const SAC_CODE = "997331";
export const GST_RATE = 18;
const INVOICE_PREFIX = "SE";

const CYCLE_LABEL: Record<string, string> = {
  monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly",
};

// ─────────────────────────── schema ───────────────────────────

let schemaReady: Promise<void> | null = null;
export function ensureSubscriptionInvoiceSchema(): Promise<void> {
  schemaReady ??= pool.query(`
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS city TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS state TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_type TEXT;
    ALTER TABLE companies ADD COLUMN IF NOT EXISTS referral_code TEXT;
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12, 2);
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12, 2);
    ALTER TABLE subscription_payments ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;
    -- Payments that succeeded before activated_at existed were already applied
    -- to their subscription — mark them so a re-sent verify can't extend twice.
    UPDATE subscription_payments SET activated_at = COALESCE(verified_at, created_at)
      WHERE status = 'success' AND activated_at IS NULL;
    CREATE TABLE IF NOT EXISTS subscription_invoice_counters (
      fy TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subscription_invoices (
      id SERIAL PRIMARY KEY,
      invoice_no TEXT NOT NULL UNIQUE,
      fy TEXT NOT NULL,
      company_id INTEGER NOT NULL,
      payment_id INTEGER NOT NULL UNIQUE,
      invoice_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      buyer_name TEXT NOT NULL,
      buyer_gstin TEXT,
      buyer_address TEXT,
      buyer_state TEXT,
      buyer_email TEXT,
      buyer_mobile TEXT,
      place_of_supply TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      period_start TIMESTAMP WITH TIME ZONE NOT NULL,
      period_end TIMESTAMP WITH TIME ZONE NOT NULL,
      taxable NUMERIC(12, 2) NOT NULL,
      cgst NUMERIC(12, 2) NOT NULL DEFAULT 0,
      sgst NUMERIC(12, 2) NOT NULL DEFAULT 0,
      igst NUMERIC(12, 2) NOT NULL DEFAULT 0,
      total NUMERIC(12, 2) NOT NULL,
      razorpay_payment_id TEXT,
      emailed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS subscription_invoices_company_idx ON subscription_invoices(company_id);
  `).then(() => undefined).catch((err) => {
    schemaReady = null; // retry next time rather than caching the failure
    logger.error({ err }, "Could not ensure subscription invoice schema");
    throw err;
  });
  return schemaReady;
}
ensureSubscriptionInvoiceSchema().catch(() => {});

// ─────────────────────────── money ───────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

export function withGst(base: number): { taxable: number; gst: number; total: number } {
  const taxable = round2(base);
  const gst = round2(taxable * GST_RATE / 100);
  return { taxable, gst, total: round2(taxable + gst) };
}

// Indian financial year (April–March) of a date, e.g. "2026-27".
export function financialYear(d: Date): string {
  // Indian time, so a payment at 1 a.m. on 1 April lands in the new year.
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function isSameState(stateOrGstin: { state?: string | null; gstin?: string | null }): boolean {
  const g = (stateOrGstin.gstin ?? "").trim();
  if (/^\d{2}/.test(g)) return g.slice(0, 2) === SELLER.stateCode;
  const s = (stateOrGstin.state ?? "").trim().toLowerCase();
  // Unknown buyer state → place of supply is the supplier's location.
  return s === "" || s === SELLER.state.toLowerCase() || s === "mh";
}

// ─────────────────────────── company details ───────────────────────────

export async function saveCompanyBillingDetails(
  q: Queryable,
  companyId: number,
  d: { gstin?: string | null; city?: string | null; state?: string | null; businessType?: string | null; referralCode?: string | null },
): Promise<void> {
  await ensureSubscriptionInvoiceSchema();
  const clean = (v?: string | null) => (v && v.trim() ? v.trim() : null);
  await q.query(
    `UPDATE companies SET gstin = $1, city = $2, state = $3, business_type = $4, referral_code = $5 WHERE id = $6`,
    [clean(d.gstin)?.toUpperCase() ?? null, clean(d.city), clean(d.state), clean(d.businessType), clean(d.referralCode), companyId],
  );
}

// ─────────────────────────── issuing ───────────────────────────

// Issues the invoice for a successful payment — idempotent (one invoice per
// payment). Must run inside the caller's transaction, after the subscription
// row has been extended (the billed period is read from it).
export async function issueInvoiceForPayment(
  client: Queryable,
  paymentId: number,
  period: { start: Date; end: Date },
): Promise<{ id: number; invoiceNo: string; created: boolean }> {
  await ensureSubscriptionInvoiceSchema();
  const existing = await client.query(`SELECT id, invoice_no FROM subscription_invoices WHERE payment_id = $1`, [paymentId]);
  if (existing.rows[0]) return { id: existing.rows[0].id, invoiceNo: existing.rows[0].invoice_no, created: false };

  const { rows: [p] } = await client.query(`SELECT * FROM subscription_payments WHERE id = $1`, [paymentId]);
  const { rows: [c] } = await client.query(`SELECT * FROM companies WHERE id = $1`, [p.company_id]);
  const { rows: [plan] } = await client.query(`SELECT name FROM subscription_plans WHERE slug = $1`, [p.plan_tier]);
  const { rows: [admin] } = await client.query(
    `SELECT username FROM users WHERE company_id = $1 AND role = 'admin' ORDER BY id ASC LIMIT 1`,
    [p.company_id],
  );

  // Older orders (before GST was added on top) have no split stored: treat
  // the amount paid as GST-inclusive so the invoice still totals correctly.
  const total = round2(Number(p.amount));
  const taxable = p.taxable_amount != null ? round2(Number(p.taxable_amount)) : round2(total / (1 + GST_RATE / 100));
  const gst = round2(total - taxable);
  const intra = isSameState({ state: c?.state, gstin: c?.gstin });
  const cgst = intra ? round2(gst / 2) : 0;
  const sgst = intra ? round2(gst - cgst) : 0;
  const igst = intra ? 0 : gst;

  const invoiceDate = new Date();
  const fy = financialYear(invoiceDate);
  const { rows: [counter] } = await client.query(
    `INSERT INTO subscription_invoice_counters (fy, last_seq) VALUES ($1, 1)
     ON CONFLICT (fy) DO UPDATE SET last_seq = subscription_invoice_counters.last_seq + 1
     RETURNING last_seq`,
    [fy],
  );
  const invoiceNo = `${INVOICE_PREFIX}/${fy}/${String(counter.last_seq).padStart(4, "0")}`;

  const buyerEmail = c?.email || (admin?.username?.includes("@") ? admin.username : null);
  const buyerAddress = [c?.address, c?.city, c?.state].filter((v: unknown) => typeof v === "string" && v.trim()).join(", ") || null;
  const placeOfSupply = intra
    ? `${SELLER.state} (${SELLER.stateCode})`
    : (c?.gstin && /^\d{2}/.test(c.gstin) ? `${c.state ?? "State"} (${c.gstin.slice(0, 2)})` : (c?.state ?? "Outside Maharashtra"));

  const { rows: [inv] } = await client.query(
    `INSERT INTO subscription_invoices
       (invoice_no, fy, company_id, payment_id, invoice_date, buyer_name, buyer_gstin, buyer_address, buyer_state,
        buyer_email, buyer_mobile, place_of_supply, plan_name, billing_cycle, period_start, period_end,
        taxable, cgst, sgst, igst, total, razorpay_payment_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING id`,
    [
      invoiceNo, fy, p.company_id, paymentId, invoiceDate, c?.name ?? "Customer", c?.gstin ?? null, buyerAddress,
      c?.state ?? null, buyerEmail, c?.mobile ?? null, placeOfSupply, plan?.name ?? p.plan_tier, p.billing_cycle,
      period.start, period.end, taxable, cgst, sgst, igst, total, p.razorpay_payment_id ?? null,
    ],
  );
  return { id: inv.id, invoiceNo, created: true };
}

// ─────────────────────────── email ───────────────────────────

export async function emailInvoice(invoiceId: number): Promise<boolean> {
  try {
    const { rows: [inv] } = await pool.query(`SELECT * FROM subscription_invoices WHERE id = $1`, [invoiceId]);
    if (!inv || !inv.buyer_email) {
      if (inv) logger.warn({ invoiceId }, "Subscription invoice not emailed — customer has no email");
      return false;
    }
    const pdf = await renderInvoicePdf(inv);
    const portal = process.env["PORTAL_APPLICATION_URL"] ?? "";
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #0f172a;">
        <h2 style="color: #2563eb; margin-bottom: 4px;">Payment received — thank you!</h2>
        <p style="margin-top: 0; color: #475569;">Your ${escapeHtml(SELLER.brand)} subscription is active.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr><td style="padding: 6px 0; color: #64748b;">Invoice no.</td><td style="padding: 6px 0; text-align: right;"><b>${escapeHtml(inv.invoice_no)}</b></td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Plan</td><td style="padding: 6px 0; text-align: right;">${escapeHtml(inv.plan_name)} (${escapeHtml(CYCLE_LABEL[inv.billing_cycle] ?? inv.billing_cycle)})</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b;">Valid till</td><td style="padding: 6px 0; text-align: right;">${fmtDate(new Date(inv.period_end))}</td></tr>
          <tr><td style="padding: 6px 0; color: #64748b; border-top: 1px solid #e2e8f0;">Amount paid</td><td style="padding: 6px 0; text-align: right; border-top: 1px solid #e2e8f0;"><b>&#8377;${money(Number(inv.total))}</b> (incl. GST)</td></tr>
        </table>
        <p>Your GST tax invoice is attached as a PDF.${portal ? ` You can also download it any time from <a href="${escapeHtml(portal)}/payments" style="color: #2563eb;">My Payments</a>.` : ""}</p>
        <p style="color: #64748b; font-size: 13px; margin-top: 24px;">${escapeHtml(SELLER.legalName)} · GSTIN ${SELLER.gstin}<br/>${escapeHtml(SELLER.email)} · ${escapeHtml(SELLER.phone)}</p>
      </div>`;
    const ok = await sendMail(inv.buyer_email, `Your ${SELLER.brand} invoice ${inv.invoice_no}`, html, [
      { filename: `${inv.invoice_no.replace(/\//g, "-")}.pdf`, content: Buffer.from(pdf), contentType: "application/pdf" },
    ]);
    if (ok) await pool.query(`UPDATE subscription_invoices SET emailed_at = NOW() WHERE id = $1`, [invoiceId]);
    return ok;
  } catch (err) {
    logger.error({ err, invoiceId }, "Failed to email subscription invoice");
    return false;
  }
}

// ─────────────────────────── PDF ───────────────────────────

function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}
// Standard PDF fonts only cover WinAnsi — swap out characters they can't draw.
function pdfSafe(s: string): string {
  return String(s ?? "").replace(/[–—]/g, "-").replace(/₹/g, "Rs.").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function twoDigits(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
}
// Indian numbering: crore, lakh, thousand.
export function amountInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  const words = parts.length ? parts.join(" ") : "Zero";
  return `Rupees ${words}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}

export async function renderInvoicePdf(inv: any): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Tax Invoice ${inv.invoice_no}`);
  doc.setAuthor(SELLER.legalName);
  const page = doc.addPage([595.28, 841.89]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = page.getWidth();
  const M = 40;
  const blue = rgb(0.145, 0.388, 0.922);
  const ink = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.39, 0.45, 0.55);
  const line = rgb(0.886, 0.91, 0.941);
  const soft = rgb(0.957, 0.965, 0.98);

  const text = (p: PDFPage, s: string, x: number, y: number, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const f = o.f ?? font, size = o.size ?? 10, str = pdfSafe(s);
    const dx = o.right ? f.widthOfTextAtSize(str, size) : 0;
    p.drawText(str, { x: x - dx, y, size, font: f, color: o.color ?? ink });
  };

  // Header band
  page.drawRectangle({ x: 0, y: 841.89 - 90, width: W, height: 90, color: blue });
  text(page, SELLER.brand, M, 841.89 - 45, { f: bold, size: 22, color: rgb(1, 1, 1) });
  text(page, "Business management, billing & GST software", M, 841.89 - 63, { size: 9, color: rgb(0.86, 0.9, 1) });
  text(page, "TAX INVOICE", W - M, 841.89 - 45, { f: bold, size: 18, color: rgb(1, 1, 1), right: true });
  text(page, "Original for Recipient", W - M, 841.89 - 63, { size: 9, color: rgb(0.86, 0.9, 1), right: true });

  let y = 841.89 - 120;
  // Seller (left) and invoice meta (right)
  text(page, "From", M, y, { size: 8, color: muted });
  text(page, SELLER.legalName, M, y - 14, { f: bold, size: 12 });
  let sy = y - 28;
  for (const l of SELLER.addressLines) { text(page, l, M, sy, { size: 9.5 }); sy -= 13; }
  text(page, `GSTIN: ${SELLER.gstin}`, M, sy, { f: bold, size: 9.5 }); sy -= 13;
  text(page, `${SELLER.email}  |  ${SELLER.phone}`, M, sy, { size: 9, color: muted });

  const metaX = 360;
  const meta: [string, string][] = [
    ["Invoice No.", inv.invoice_no],
    ["Invoice Date", fmtDate(new Date(inv.invoice_date))],
    ["Place of Supply", inv.place_of_supply],
    ["Payment Ref.", inv.razorpay_payment_id ?? "-"],
  ];
  let my = y - 2;
  for (const [k, v] of meta) {
    text(page, k, metaX, my, { size: 9, color: muted });
    text(page, v, W - M, my, { f: bold, size: 9.5, right: true });
    my -= 16;
  }

  // Bill to
  y = Math.min(sy, my) - 26;
  page.drawRectangle({ x: M, y: y - 62, width: W - 2 * M, height: 74, color: soft, borderColor: line, borderWidth: 1 });
  text(page, "Bill To", M + 12, y - 2, { size: 8, color: muted });
  text(page, inv.buyer_name, M + 12, y - 17, { f: bold, size: 12 });
  let by = y - 31;
  if (inv.buyer_address) { text(page, inv.buyer_address, M + 12, by, { size: 9.5 }); by -= 13; }
  text(page, `GSTIN: ${inv.buyer_gstin || "Unregistered"}`, M + 12, by, { size: 9.5 }); by -= 13;
  const contact = [inv.buyer_email, inv.buyer_mobile].filter(Boolean).join("  |  ");
  if (contact) text(page, contact, M + 12, by, { size: 9, color: muted });

  // Items table
  y -= 92;
  const cols = [
    { label: "#", x: M + 10, w: 20 },
    { label: "Description", x: M + 34, w: 250 },
    { label: "SAC", x: M + 300, w: 50 },
    { label: "Qty", x: M + 360, w: 30 },
    { label: "Taxable Value (Rs.)", x: W - M - 10, w: 120, right: true },
  ];
  page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: 24, color: ink });
  for (const c of cols) text(page, c.label, c.x, y, { f: bold, size: 9, color: rgb(1, 1, 1), right: (c as any).right });

  y -= 30;
  const desc = `${SELLER.brand} - ${inv.plan_name} plan (${CYCLE_LABEL[inv.billing_cycle] ?? inv.billing_cycle} subscription)`;
  text(page, "1", cols[0].x, y, { size: 10 });
  text(page, desc, cols[1].x, y, { f: bold, size: 10 });
  text(page, `Service period: ${fmtDate(new Date(inv.period_start))} to ${fmtDate(new Date(inv.period_end))}`, cols[1].x, y - 13, { size: 8.5, color: muted });
  text(page, SAC_CODE, cols[2].x, y, { size: 10 });
  text(page, "1", cols[3].x, y, { size: 10 });
  text(page, money(Number(inv.taxable)), cols[4].x, y, { size: 10, right: true });
  y -= 28;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });

  // Totals
  const tx = 330;
  y -= 20;
  const rows: [string, number, boolean?][] = [["Taxable Value", Number(inv.taxable)]];
  if (Number(inv.igst) > 0) rows.push([`IGST @ ${GST_RATE}%`, Number(inv.igst)]);
  else {
    rows.push([`CGST @ ${GST_RATE / 2}%`, Number(inv.cgst)]);
    rows.push([`SGST @ ${GST_RATE / 2}%`, Number(inv.sgst)]);
  }
  for (const [k, v] of rows) {
    text(page, k, tx, y, { size: 10, color: muted });
    text(page, money(v), W - M - 10, y, { size: 10, right: true });
    y -= 17;
  }
  y -= 10; // breathing room so the total band never covers the last tax row
  page.drawRectangle({ x: tx - 10, y: y - 10, width: W - M - tx + 10, height: 28, color: blue });
  text(page, "Total (Rs.)", tx, y, { f: bold, size: 11.5, color: rgb(1, 1, 1) });
  text(page, money(Number(inv.total)), W - M - 10, y, { f: bold, size: 11.5, color: rgb(1, 1, 1), right: true });

  // Amount in words + paid stamp
  y -= 40;
  text(page, "Amount in words", M, y, { size: 8, color: muted });
  text(page, amountInWords(Number(inv.total)), M, y - 14, { f: bold, size: 10 });
  y -= 44;
  page.drawRectangle({ x: M, y: y - 8, width: 210, height: 26, borderColor: rgb(0.09, 0.64, 0.29), borderWidth: 1.5, color: rgb(0.94, 0.99, 0.95) });
  text(page, `PAID  -  via Razorpay`, M + 12, y, { f: bold, size: 10, color: rgb(0.09, 0.5, 0.24) });

  // Terms + footer
  y -= 46;
  text(page, "Terms", M, y, { f: bold, size: 9 });
  const terms = [
    "1. Tax is payable on reverse charge basis: No.",
    "2. This invoice is for the software subscription period stated above.",
    "3. Refunds are governed by our Refund & Cancellation Policy.",
    `4. For any query write to ${SELLER.email}.`,
    "5. Subject to Solapur jurisdiction.",
  ];
  let ty = y - 14;
  for (const t of terms) { text(page, t, M, ty, { size: 8.5, color: muted }); ty -= 12; }

  text(page, `For ${SELLER.legalName}`, W - M, y, { f: bold, size: 10, right: true });
  text(page, "Authorised Signatory", W - M, y - 44, { size: 8.5, color: muted, right: true });

  page.drawLine({ start: { x: M, y: 58 }, end: { x: W - M, y: 58 }, thickness: 1, color: line });
  text(page, "This is a computer-generated invoice and does not require a physical signature.", W / 2 - font.widthOfTextAtSize("This is a computer-generated invoice and does not require a physical signature.", 8) / 2, 44, { size: 8, color: muted });
  text(page, `${SELLER.legalName}  |  GSTIN ${SELLER.gstin}  |  ${SELLER.email}`, W / 2 - font.widthOfTextAtSize(pdfSafe(`${SELLER.legalName}  |  GSTIN ${SELLER.gstin}  |  ${SELLER.email}`), 8) / 2, 32, { size: 8, color: muted });

  return doc.save();
}
