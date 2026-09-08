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

  // Legacy A5-landscape cash-memo, printed on the A4 paper every shop loads.
  // An A5-landscape sheet (~210 x 148mm) is exactly the TOP HALF of an A4
  // portrait page, so lay it out there full-width, bottom half left blank —
  // the classic tear-off bill-book format. The on-screen sheet has generous
  // padding + decorative blank filler rows that push a normal bill past
  // ~200mm (onto a 2nd page); print clamps all of that vertical air right
  // down so a typical bill lands inside the top ~half. Kept at a readable
  // ~10.5px (not the old 9px squeeze) with a full border box.
  if (meta.id === "a5-compact") {
    return `
    @page { size: 210mm 297mm; margin: 5mm; }
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
        transform: none !important;
        box-shadow: none !important;
        display: block !important;
      }
      .invoice-scale-wrapper {
        width: auto !important;
        height: auto !important;
        overflow: visible !important;
        transform: none !important;
      }
      .invoice-print-area .invoice-sheet {
        width: 100% !important;
        min-height: 120mm !important;
        font-size: 10.5px !important;
        line-height: 1.18 !important;
        color: #000 !important;
        background: #fff !important;
        border: 1.5px solid #000 !important;
        transform: none !important;
        margin: 0 !important;
        box-shadow: none !important;
      }
      /* Squeeze the roomy on-screen spacing for print so the bill lands in
         the top ~half of the A4 sheet instead of overflowing to page 2. */
      .invoice-print-area .invoice-sheet [class~="p-3"] { padding: 3px 7px !important; }
      .invoice-print-area .invoice-sheet [class~="p-2"] { padding: 3px 5px !important; }
      .invoice-print-area .invoice-sheet [class~="px-3"] { padding-left: 7px !important; padding-right: 7px !important; }
      .invoice-print-area .invoice-sheet [class~="pt-10"] { padding-top: 10px !important; }
      .invoice-print-area .invoice-sheet [class~="pt-4"] { padding-top: 3px !important; }
      .invoice-print-area .invoice-sheet [class~="mt-3"],
      .invoice-print-area .invoice-sheet [class~="mt-2"] { margin-top: 2px !important; }
      .invoice-print-area .invoice-sheet [class~="gap-y-2"] { row-gap: 2px !important; }
      .invoice-print-area .invoice-sheet [class~="space-y-3"] > * + * { margin-top: 2px !important; }
      .invoice-print-area .invoice-sheet [class~="space-y-1"] > * + * { margin-top: 1px !important; }
      /* Decorative blank filler rows + all table cells: hairline vertical
         padding (they otherwise eat ~25mm on a 3-line bill). */
      .invoice-print-area .invoice-sheet [class~="py-3"],
      .invoice-print-area .invoice-sheet [class~="py-2"],
      .invoice-print-area .invoice-sheet [class~="py-1.5"] { padding-top: 1px !important; padding-bottom: 1px !important; }
      .invoice-print-area .invoice-sheet table { width: 100% !important; }
      .invoice-print-area .invoice-sheet td,
      .invoice-print-area .invoice-sheet th {
        padding: 1px 5px !important;
        border-color: #000 !important;
      }
      .sidebar, .topbar, .no-print, button, nav { display: none !important; }
    }
  `;
  }

  // `size: A4 landscape` is valid CSS, but several browser/print-driver
  // combinations only honor the paper-size keyword and silently ignore the
  // portrait/landscape keyword next to it — the page prints in the same
  // orientation regardless of what's selected. Explicit width×height (with
  // the two swapped for landscape) is universally respected since it isn't
  // relying on the browser to interpret the orientation keyword at all.
  const PAGE_DIMENSIONS_MM: Record<"A4" | "A5", [number, number]> = {
    A4: [210, 297],
    A5: [148, 210],
  };
  const [w, h] = PAGE_DIMENSIONS_MM[paper as "A4" | "A5"] ?? PAGE_DIMENSIONS_MM.A4;
  const sizeRule = orientation === "landscape" ? `${h}mm ${w}mm` : `${w}mm ${h}mm`;
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
