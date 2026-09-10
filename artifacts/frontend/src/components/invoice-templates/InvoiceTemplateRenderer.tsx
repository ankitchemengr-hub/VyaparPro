// Renders an invoice two ways from one template:
//
//  1. An on-screen preview (ScreenFitInvoiceSheet) — the sheet is a fixed
//     real-world paper width, so on a phone it's shrunk with transform:scale
//     to fit the viewport. Screen only; never involved in printing.
//
//  2. A print-only copy portaled to <body> (`.invoice-print-portal`). During
//     @media print the injected CSS sets `#root { display: none }`, which
//     removes the entire app — sidebar, header, the preview above, every
//     closed dialog's still-mounted markup — so none of it can reserve page
//     height or leave the sheet hidden. The portal copy, being a direct child
//     of <body>, then prints on its own with nothing to fight. This mirrors
//     how every print-capable dialog in the app already works and is why the
//     old visibility:hidden + position:absolute approach (which left trailing
//     blank pages, and on some drivers a fully blank sheet) is gone.

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { getTemplate } from "./registry";
import { computeTotals, getPrintCss, getWatermarkCss } from "./helpers";
import { ScreenFitInvoiceSheet } from "./ScreenFitInvoiceSheet";
import type { ProductMaps, PrintSettings } from "./types";

interface InvoiceTemplateRendererProps {
  invoice: any;
  maps: ProductMaps;
  settings: PrintSettings;
  templateId?: string | null;
  className?: string;
}

export function InvoiceTemplateRenderer({
  invoice,
  maps,
  settings,
  templateId,
  className = "",
}: InvoiceTemplateRendererProps) {
  const meta = getTemplate(templateId ?? settings.defaultTemplate);
  const Template = meta.component;
  const computed = useMemo(() => computeTotals(invoice, maps), [invoice, maps]);

  const css =
    getPrintCss(meta, settings.paperSize, settings.orientation) +
    getWatermarkCss(settings.watermarkImage, settings.showWatermark);

  const sheet = <Template invoice={invoice} maps={maps} settings={settings} computed={computed} />;

  return (
    <>
      <style>{css}</style>

      <ScreenFitInvoiceSheet className={`invoice-print-area ${className}`}>
        {sheet}
      </ScreenFitInvoiceSheet>

      {typeof document !== "undefined" &&
        createPortal(
          <div className="invoice-print-portal" aria-hidden="true">
            {sheet}
          </div>,
          document.body,
        )}
    </>
  );
}
