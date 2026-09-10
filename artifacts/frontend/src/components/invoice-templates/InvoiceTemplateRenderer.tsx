// Renders an invoice using whichever template id is requested, injecting that
// template's @page print CSS and isolating the sheet so only it prints.
//
// The sheet itself is a fixed real-world paper width (A4/A5) with no
// responsive treatment — that's correct for printing, but on a phone screen
// it just overflows the viewport. ScreenFitInvoiceSheet below shrinks the
// whole sheet to fit its container using transform: scale, wrapped in a
// div explicitly sized to the scaled footprint (transform doesn't reflow
// layout, so without that wrapper the container would still be forced to
// the sheet's full unscaled width). An earlier version used CSS `zoom`
// instead — simpler (it reflows, so no wrapper was needed) but `zoom` is a
// legacy, non-standard property with real cross-browser/mobile quirks, and
// it silently failed to render at all on at least one mobile browser.
// transform is a long-standardized property with uniform support everywhere.
// The injected print CSS resets the transform/wrapper back to natural size
// for the actual printed/PDF output so nothing about the paper document changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
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
  const [dims, setDims] = useState<{ scale: number; width?: number; height?: number }>({ scale: 1 });
  // The on-screen fit-to-container scale must be OFF for print/PDF — the sheet
  // has to go to paper at its true size. A print stylesheet's
  // `transform: none !important` is meant to handle this, but a stray recalc
  // fired by the print-media reflow can re-stamp a fresh inline
  // `transform: scale(x)` mid-print, so the sheet lands shrunken in a corner.
  // Drop the transform in React itself, synchronously, before the browser
  // snapshots for print, and restore it afterwards.
  const [isPrinting, setIsPrinting] = useState(false);

  useEffect(() => {
    const before = () => flushSync(() => setIsPrinting(true));
    const after = () => setIsPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    const mql = window.matchMedia?.("print");
    const onMedia = (e: MediaQueryListEvent) => flushSync(() => setIsPrinting(e.matches));
    mql?.addEventListener?.("change", onMedia);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      mql?.removeEventListener?.("change", onMedia);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const recalc = () => {
      // Unlike CSS zoom, transform never reflows layout, so `sheet`'s own
      // scrollWidth/Height always reflect its true natural size regardless
      // of whatever scale is currently applied — no reverse-division needed.
      const naturalWidth = sheet.scrollWidth;
      const naturalHeight = sheet.scrollHeight;
      // Small safety margin so the sheet doesn't sit edge-to-edge on screen.
      const available = container.clientWidth * 0.96;
      if (!naturalWidth || !available) return;
      const scale = Math.min(1, available / naturalWidth);
      setDims({ scale, width: naturalWidth * scale, height: naturalHeight * scale });
    };

    recalc();
    // Web fonts often finish loading after this first measurement, which can
    // widen text enough to blow past the scaled sheet's right edge — recalc
    // once more when they're actually ready.
    document.fonts?.ready?.then(recalc).catch(() => {});

    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [children]);

  return (
    <div ref={containerRef} className="w-full overflow-x-auto print:overflow-visible">
      {/* Explicitly sized to the scaled footprint so the page layout reserves
          the right amount of space; overflow hidden clips the sheet's own
          unscaled (full-size) layout box, which transform leaves behind. */}
      <div
        className="invoice-scale-wrapper"
        style={
          isPrinting
            ? { width: "auto", height: "auto", overflow: "visible" }
            : { width: dims.width, height: dims.height, overflow: dims.width ? "hidden" : "visible" }
        }
      >
        <div
          ref={sheetRef}
          className={`${className} inline-block align-top`}
          style={
            isPrinting
              ? { transform: "none" }
              : { transform: `scale(${dims.scale})`, transformOrigin: "top left" }
          }
        >
          {children}
        </div>
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
