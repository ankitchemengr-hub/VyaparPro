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
  const { lpbByProduct, upbByProduct } = maps;
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
export function getPrintCss(meta: TemplateMeta): string {
  const sizeRule = `${meta.paper} ${meta.orientation}`;
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
  return `
    @page { size: ${sizeRule}; margin: ${meta.paper === "A5" ? "5mm" : "8mm"}; }
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
      }
      .sidebar, .topbar, .no-print, button, nav { display: none !important; }
      ${legacy}
    }
  `;
}
