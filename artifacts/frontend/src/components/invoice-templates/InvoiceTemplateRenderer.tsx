// Renders an invoice using whichever template id is requested, injecting that
// template's @page print CSS and isolating the sheet so only it prints.
//
// The sheet itself is a fixed real-world paper width (A4/A5) with no
// responsive treatment — that's correct for printing, but on a phone screen
// it just overflows the viewport. ScreenFitInvoiceSheet below scales the
// whole sheet down to fit its container on screen (transform: scale, with
// the wrapper's box resized to match so there's no leftover blank space),
// while the injected print CSS forces the scale back to 1 for the actual
// printed/PDF output so nothing about the paper document changes.

import { useEffect, useMemo, useRef, useState } from "react";
import { getTemplate } from "./registry";
import { computeTotals, getPrintCss } from "./helpers";
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
  const [box, setBox] = useState<{ scale: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const recalc = () => {
      const naturalWidth = sheet.scrollWidth;
      const naturalHeight = sheet.scrollHeight;
      const available = container.clientWidth;
      if (!naturalWidth || !available) return;
      const scale = Math.min(1, available / naturalWidth);
      setBox({ scale, width: naturalWidth * scale, height: naturalHeight * scale });
    };

    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    ro.observe(sheet);
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [children]);

  return (
    <div ref={containerRef} className="w-full overflow-x-auto print:overflow-visible">
      <div
        style={box && box.scale < 1 ? { width: box.width, height: box.height } : undefined}
        className="mx-auto print:!w-auto print:!h-auto"
      >
        <div
          ref={sheetRef}
          className={`${className} print:!transform-none`}
          style={
            box && box.scale < 1
              ? { transform: `scale(${box.scale})`, transformOrigin: "top left" }
              : undefined
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
      <style>{getPrintCss(meta)}</style>
      <ScreenFitInvoiceSheet className={`invoice-print-area ${className}`}>
        <Template invoice={invoice} maps={maps} settings={settings} computed={computed} />
      </ScreenFitInvoiceSheet>
    </>
  );
}
