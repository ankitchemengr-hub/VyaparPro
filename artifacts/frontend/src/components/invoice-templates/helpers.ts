// Shared pure helpers for every invoice template. Extracted verbatim from the
// original invoice-detail print layout so all templates compute identical values.

import type { Computed, ProductMaps, TemplateMeta } from "./types";

export const inr = (n: number) =>
  (Number(n) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const num = (n: any, d = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return v.toLocaleString("en-IN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
};

// Per-line liters: prefer explicit totalLiters from API, else multiply qty by the
// product's litersPerBox (from products catalog), else infer if unit itself is litres.
export function lineLiters(item: any, productLpb?: number | null): number {
  if (
    item.totalLiters != null &&
    Number.isFinite(Number(item.totalLiters)) &&
    Number(item.totalLiters) > 0
  ) {
    return Number(item.totalLiters);
  }
  const lpb = Number(productLpb ?? 0);
  if (lpb > 0) return (Number(item.qty) || 0) * lpb;
  const u = String(item.unit ?? "").toLowerCase();
  if (["ltr", "l", "liter", "litre", "liters", "litres"].includes(u)) {
    return Number(item.qty) || 0;
  }
  return 0;
}

// UPI deep link for the "Scan & Pay" QR. Amount always comes live from the
// invoice's grand total (not a fixed setting), so it stays correct without
// any manual edit — only the payee UPI ID is configured, in Print Settings.
export function buildUpiUri(settings: { upiId?: string; companyName?: string }, invoice: any): string | null {
  const pa = (settings.upiId ?? "").trim();
  if (!pa) return null;
  const amount = Number(invoice?.grandTotal);
  // Built manually with encodeURIComponent (percent-encoding, spaces as %20)
  // instead of URLSearchParams — URLSearchParams uses form-encoding (spaces
  // as `+`), which several UPI apps parse just loosely enough to show the
  // payee name/amount before failing strict validation with "Unable to scan
  // QR" once they hit the literal `+` characters.
  const parts: string[] = [
    `pa=${encodeURIComponent(pa)}`,
    `pn=${encodeURIComponent(settings.companyName || "Merchant")}`,
    `cu=INR`,
  ];
  if (Number.isFinite(amount) && amount > 0) {
    parts.push(`am=${encodeURIComponent(amount.toFixed(2))}`);
  }
  if (invoice?.invoiceNo) {
    parts.push(`tn=${encodeURIComponent(`Invoice ${invoice.invoiceNo}`)}`);
  }
  return `upi://pay?${parts.join("&")}`;
}

// Number → Indian English words (rupees only, no paise).
export function rupeesInWords(n: number): string {
  const rupees = Math.floor(Math.abs(Number(n) || 0));
  if (rupees === 0) return "Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number): string =>
    x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? " " + ones[x % 10] : "");
  const three = (x: number): string =>
    x >= 100 ? ones[Math.floor(x / 100)] + " Hundred" + (x % 100 ? " " + two(x % 100) : "") : two(x);
  let x = rupees;
  const crore = Math.floor(x / 10000000); x %= 10000000;
  const lakh = Math.floor(x / 100000); x %= 100000;
  const thousand = Math.floor(x / 1000); x %= 1000;
  const hundred = x;
  let out = "";
  if (crore) out += three(crore) + " Crore ";
  if (lakh) out += two(lakh) + " Lakh ";
  if (thousand) out += two(thousand) + " Thousand ";
  if (hundred) out += three(hundred);
  return "Rupees " + out.trim() + " Only";
}

// Derive all the totals/flags a template needs from the raw invoice + product maps.
export function computeTotals(invoice: any, maps: ProductMaps): Computed {
  if (!invoice) {
    return { items: [], isGst: false, isInterstate: false, placeOfSupply: "Maharashtra", totalQty: 0, totalLtr: 0, totalBox: 0, hasAnyDisc: false, roundOff: 0 };
  }
  const { lpbByProduct, upbByProduct } = maps ?? { lpbByProduct: new Map(), upbByProduct: new Map() };
  const items = invoice.items ?? [];
  const isGst = invoice.invoiceType === "gst";
  const placeOfSupply = invoice.placeOfSupply ?? "Maharashtra";
  const isInterstate = placeOfSupply !== "Maharashtra";
  const totalQty = items.reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0);
  const totalLtr = items.reduce(
    (s: number, i: any) => s + lineLiters(i, lpbByProduct.get(Number(i.productId))),
    0,
  );
  const totalBox = items.reduce((s: number, i: any) => {
    const upb = upbByProduct.get(Number(i.productId)) || 0;
    return s + (upb > 0 ? (Number(i.qty) || 0) / upb : 0);
  }, 0);
  const hasAnyDisc = items.some(
    (i: any) => (Number(i.discountPct) || 0) > 0 || (Number(i.discountAmt) || 0) > 0,
  );
  const roundOff = Number(invoice.roundOff) || 0;
  return { items, isGst, isInterstate, placeOfSupply, totalQty, totalLtr, totalBox, hasAnyDisc, roundOff };
}

// Print stylesheet for the invoice sheet.
//
// InvoiceTemplateRenderer portals a copy of the sheet (`.invoice-print-portal`)
// straight to <body>; during @media print this CSS hides `#root` (the whole
// app — sidebar, header, on-screen preview, every closed dialog's still-mounted
// markup) so nothing reserves page height or leaves the sheet hidden, and the
// portal copy prints on its own. `.invoice-print-portal` is display:none on
// screen. `paperOverride`/`orientationOverride` let Print Settings force a
// different paper size/orientation than the template's own default.
export function getPrintCss(
  meta: TemplateMeta,
  paperOverride?: "auto" | "A4" | "A5" | null,
  orientationOverride?: "auto" | "portrait" | "landscape" | null,
): string {
  const paper = paperOverride && paperOverride !== "auto" ? paperOverride : meta.paper;
  const orientation =
    orientationOverride && orientationOverride !== "auto" ? orientationOverride : meta.orientation;

  // The shared print shell: drop the app, show only the portaled sheet.
  const shell = (pageRule: string, sheetRules: string, extra = "") => `
    .invoice-print-portal { display: none; }
    @page { ${pageRule} }
    @media print {
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      /* Drop the whole app plus any open dialog / toast portal — only the
         sheet below (a direct child of <body>) survives. */
      #root { display: none !important; }
      body > *:not(.invoice-print-portal) { display: none !important; }
      .invoice-print-portal { display: block !important; }
      .invoice-print-portal .invoice-sheet {
        color: #000 !important;
        background: #fff !important;
        box-shadow: none !important;
        margin: 0 !important;
        ${sheetRules}
      }
      ${extra}
    }
  `;

  // Legacy cash-memo, re-laid out as a genuine A5 PORTRAIT page (148 x 210mm)
  // with a 4mm print-safe margin — no transform:scale / zoom. Printed on A5
  // paper it lands 1:1; printed on A4 (print dialog left at Default / 100%
  // scale) it keeps its true A5 size in a corner of the sheet. The 4mm margin
  // keeps the border off every printer's unprintable edge.
  if (meta.id === "a5-compact") {
    const pageRule = "size: 148mm 210mm; margin: 4mm;";
    const sheetRules =
      `width: 100% !important; min-height: 202mm !important; ` +
      `display: flex !important; flex-direction: column !important; ` +
      `font-size: 8px !important; line-height: 1.2 !important; ` +
      `border: 1.5px solid #000 !important;`;
    const a5 = `
      /* The item grid takes all the height left between the customer block
         and the footer; its growing spacer row absorbs the slack so a short
         bill's Total row + footer still land at the bottom of the page. */
      .invoice-print-portal .a5c-items { flex: 1 1 auto !important; }
      .invoice-print-portal .a5c-grow td { height: 100% !important; padding: 0 !important; }
      .invoice-print-portal .a5c-fill td,
      .invoice-print-portal .a5c-fill .a5c-fill-cell { height: 4.4mm !important; padding: 0 3px !important; }
      .invoice-print-portal .invoice-sheet td,
      .invoice-print-portal .invoice-sheet th { border-color: #000 !important; }
    `;
    return shell(pageRule, sheetRules, a5);
  }

  // The other templates (Modern/Professional/Classic/Minimal) are one
  // component for both their -a4 and -a5 entries. Explicit width×height
  // (swapped for landscape) since several drivers ignore the portrait/
  // landscape keyword. For A5, lay the A4-designed sheet out wide so text
  // wraps as designed, then `zoom` the whole result down to fit.
  const PAGE_DIMENSIONS_MM: Record<"A4" | "A5", [number, number]> = {
    A4: [210, 297],
    A5: [148, 210],
  };
  const [w, h] = PAGE_DIMENSIONS_MM[paper as "A4" | "A5"] ?? PAGE_DIMENSIONS_MM.A4;
  const wh = orientation === "landscape" ? `${h}mm ${w}mm` : `${w}mm ${h}mm`;
  const pageRule = `size: ${wh}; margin: ${paper === "A5" ? "5mm" : "8mm"};`;
  const sheetRules =
    paper === "A5" ? `width: 190mm !important; zoom: 0.72;` : `width: 100% !important;`;
  return shell(pageRule, sheetRules);
}

// Faint background watermark, layered behind the sheet's own content via a
// negative-z-index ::before pseudo-element (a real DOM sibling would paint
// over in-flow content by default, since positioned z-index:0 descendants
// paint after non-positioned in-flow ones — negative z-index is what pushes
// it behind). Applies on-screen and in print alike; opaque cells (table
// headers, totals rows) still occlude it in their own area, same as any
// paper watermark would.
export function getWatermarkCss(watermarkImage?: string | null, show?: boolean): string {
  if (!show || !watermarkImage) return "";
  return `
    .invoice-print-area .invoice-sheet,
    .invoice-print-portal .invoice-sheet { position: relative; }
    .invoice-print-area .invoice-sheet::before,
    .invoice-print-portal .invoice-sheet::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: -1;
      background-image: url("${watermarkImage}");
      background-size: 60% auto;
      background-position: center;
      background-repeat: no-repeat;
      opacity: 0.08;
      pointer-events: none;
    }
  `;
}
