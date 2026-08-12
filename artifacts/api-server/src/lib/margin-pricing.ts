// Mirrors the margin formula in artifacts/frontend/src/pages/price-list.tsx
// (marginedPrices / "Apply Margin") so a purchase-triggered sale-price
// suggestion and the Price List page's own margin math never drift apart.
const DEFAULT_NON_GST_MARGIN_PCT = 10;
const DEFAULT_RETAIL_MARGIN_PCT = 15;
const DEFAULT_WHOLESALE_MARGIN_PCT = 12;
const DEFAULT_GST_RATE = 18;

export interface MarginInputs {
  nonGstMarginPct: number | null;
  retailMarginPct: number | null;
  wholesaleMarginPct: number | null;
}

export interface MarginedPrices {
  nonGstPrice: number;
  retailPrice: number;
  wholesalePrice: number;
}

export function computeMarginedPrices(
  purchasePrice: number,
  margins: MarginInputs,
  taxRate: number | null,
): MarginedPrices {
  const nonGstPct = margins.nonGstMarginPct ?? DEFAULT_NON_GST_MARGIN_PCT;
  const retailPct = margins.retailMarginPct ?? DEFAULT_RETAIL_MARGIN_PCT;
  const wholesalePct = margins.wholesaleMarginPct ?? DEFAULT_WHOLESALE_MARGIN_PCT;
  const gstFactor = 1 + (taxRate || DEFAULT_GST_RATE) / 100;
  return {
    nonGstPrice: Math.round(purchasePrice * (1 + nonGstPct / 100) * 100) / 100,
    retailPrice: Math.round(purchasePrice * (1 + retailPct / 100) * 100) / 100,
    wholesalePrice: Math.round(((purchasePrice * (1 + wholesalePct / 100)) / gstFactor) * 100) / 100,
  };
}
