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
  const params = new URLSearchParams({
    pa,
    pn: settings.companyName || "Merchant",
    cu: "INR",
  });
  if (Number.isFinite(amount) && amount > 0) {
    params.set("am", amount.toFixed(2));
  }
  if (invoice?.invoiceNo) {
    params.set("tn", `Invoice ${invoice.invoiceNo}`);
  }
  return `upi://pay?${params.toString()}`;
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

// Print stylesheet tailored to a template's paper size + orientation. Isolates
// the `.invoice-print-area` so only the sheet prints, hiding all app chrome.
// `paperOverride`/`orientationOverride` let Print Settings force a different
// paper size/orientation than the template's own default (e.g. print a
// portrait template landscape) without needing a per-template redesign.
export function getPrintCss(
  meta: TemplateMeta,
  paperOverride?: "auto" | "A4" | "A5" | null,
  orientationOverride?: "auto" | "portrait" | "landscape" | null,
): string {
  const paper = paperOverride && paperOverride !== "auto" ? paperOverride : meta.paper;
  const orientation = orientationOverride && orientationOverride !== "auto" ? orientationOverride : meta.orientation;
  const sizeRule = `${paper} ${orientation}`;
  // The legacy a5-compact bill must print byte-identically to the original
  // hardcoded sheet, so reproduce its exact width/font/padding overrides.
  const legacy =
    meta.id === "a5-compact"
      ? `
      .invoice-print-area .invoice-sheet {
        width: 200mm !important;
        min-height: 138mm !important;
        font-size: 9px !important;
        line-height: 1.25 !important;
        color: #000 !important;
        background: #fff !important;
        border: 1px solid #000 !important;
      }
      .invoice-print-area .invoice-sheet td,
      .invoice-print-area .invoice-sheet th { padding: 2px 4px !important; }`
      : "";
  // The other four templates (Modern/Professional/Classic/Minimal) are the
  // same component for both their -a4 and -a5 registry entries — nothing
  // about their own markup/CSS actually shrinks for A5. Left alone, printing
  // one on A5 constrains `.invoice-print-area` to the A5 page's ~138mm
  // content width (see `width: 100%` below), which *reflows* the same A4-
  // designed content into a much narrower column — making it taller, not
  // shorter, and overflowing a 2-item invoice onto a second page with the
  // totals cut off the first sheet. Fix: lay the sheet out at its natural
  // A4-ish width first (so text wraps exactly as designed), then shrink the
  // whole result with `zoom` (unlike `transform`, zoom reflows and is
  // respected for print pagination) to fit A5's usable width.
  const a5Shrink =
    paper === "A5" && meta.id !== "a5-compact"
      ? `
      .invoice-print-area .invoice-sheet {
        width: 190mm !important;
        zoom: 0.72;
      }`
      : "";
  return `
    @page { size: ${sizeRule}; margin: ${paper === "A5" ? "5mm" : "8mm"}; }
    @media print {
      html, body {
        background: #fff !important;
        margin: 0 !important;
        padding: 0 !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body * { visibility: hidden !important; }
      .invoice-print-area, .invoice-print-area * { visibility: visible !important; }
      .invoice-print-area {
        position: absolute !important;
        left: 0 !important; top: 0 !important;
        width: 100% !important;
        box-shadow: none !important;
        transform: none !important;
        display: block !important;
      }
      .invoice-scale-wrapper {
        width: auto !important;
        height: auto !important;
        overflow: visible !important;
      }
      .sidebar, .topbar, .no-print, button, nav { display: none !important; }
      ${legacy}
      ${a5Shrink}
    }
  `;
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
    .invoice-print-area .invoice-sheet { position: relative; }
    .invoice-print-area .invoice-sheet::before {
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
