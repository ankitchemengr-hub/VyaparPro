// Renders an invoice using whichever template id is requested, injecting that
// template's @page print CSS and isolating the sheet so only it prints.
//
// The sheet itself is a fixed real-world paper width (A4/A5) with no
// responsive treatment — that's correct for printing, but on a phone screen
// it just overflows the viewport. ScreenFitInvoiceSheet below shrinks the
// whole sheet to fit its container using CSS zoom (not transform — zoom
// reflows layout at the zoomed size, so there's no separate wrapper box to
// keep in sync with the visually-scaled content, unlike transform: scale).
// The injected print CSS resets zoom back to 1 for the actual printed/PDF
// output so nothing about the paper document changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { getTemplate } from "./registry";
import { computeTotals, getPrintCss, getWatermarkCss } from "./helpers";
import type { ProductMaps, PrintSettings } from "./types";

interface InvoiceTemplateRendererProps {
  invoice: any;
  maps: ProductMaps;
  settings: PrintSettings;
  templateId?: string | null;
  className?: string;
}

function ScreenFitInvoiceSheet({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const recalc = () => {
      // `sheet` is display:inline-block (see className below), so its own
      // scrollWidth here is genuinely the content's natural/intrinsic width
      // — not "however wide the container happens to be", which is what a
      // plain block-level div would report instead (it stretches to fill
      // its container by default). zoom reflows layout, so once a zoom is
      // already applied we have to divide it back out to recover the true
      // 100% natural width.
      const currentZoom = sheet.style.zoom ? Number(sheet.style.zoom) : 1;
      const naturalWidth = sheet.scrollWidth / (currentZoom || 1);
      // Small safety margin so the sheet doesn't sit edge-to-edge on screen.
      const available = container.clientWidth * 0.96;
      if (!naturalWidth || !available) return;
      setZoom(Math.min(1, available / naturalWidth));
    };

    recalc();
    // Web fonts often finish loading after this first measurement, which can
    // widen text enough to blow past the zoomed sheet's right edge — recalc
    // once more when they're actually ready.
    document.fonts?.ready?.then(recalc).catch(() => {});

    // Observe `container` for viewport/layout changes, and `sheet` for content
    // that changes the invoice's own natural size after mount (e.g. late image
    // loads) without the `children` prop identity changing. Naively observing
    // `sheet` would turn every zoom write into another resize event and
    // compound rounding error each pass until zoom drifts to ~0 — guarded here
    // by only updating state when the recomputed zoom actually differs.
    const recalcIfChanged = () => {
      const current = sheet.style.zoom ? Number(sheet.style.zoom) : 1;
      const naturalWidth = sheet.scrollWidth / (current || 1);
      const available = container.clientWidth * 0.96;
      if (!naturalWidth || !available) return;
      const next = Math.min(1, available / naturalWidth);
      if (Math.abs(next - current) > 0.005) setZoom(next);
    };
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    const sheetRo = new ResizeObserver(recalcIfChanged);
    sheetRo.observe(sheet);
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      sheetRo.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [children]);

  return (
    <div ref={containerRef} className="w-full overflow-x-auto print:overflow-visible">
      <div
        ref={sheetRef}
        className={`${className} inline-block align-top`}
        style={{ zoom } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
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

  return (
    <>
      <style>
        {getPrintCss(meta, settings.paperSize, settings.orientation)}
        {getWatermarkCss(settings.watermarkImage, settings.showWatermark)}
      </style>
      <ScreenFitInvoiceSheet className={`invoice-print-area ${className}`}>
        <Template invoice={invoice} maps={maps} settings={settings} computed={computed} />
      </ScreenFitInvoiceSheet>
    </>
  );
}
