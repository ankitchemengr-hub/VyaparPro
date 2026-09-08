// On-screen only preview of an invoice sheet. The sheet is authored at a
// fixed real-world paper width; on a narrow viewport this shrinks the whole
// thing with transform:scale so it fits its container, wrapped in a div
// explicitly sized to the scaled footprint (transform doesn't reflow, so
// without that wrapper the container would still be forced to the sheet's
// full unscaled width).
//
// Printing does NOT go through here — InvoiceTemplateRenderer portals a
// separate, unscaled copy to <body> and the print CSS hides #root — so this
// component carries no @media print / beforeprint logic at all. The whole
// subtree is display:none during print via `#root { display: none }`.

import { useEffect, useRef, useState } from "react";

export function ScreenFitInvoiceSheet({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ scale: number; width?: number; height?: number }>({ scale: 1 });

  useEffect(() => {
    const container = containerRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const recalc = () => {
      // transform never reflows, so scrollWidth/Height are the true natural
      // size regardless of the scale currently applied.
      const naturalWidth = sheet.scrollWidth;
      const naturalHeight = sheet.scrollHeight;
      const available = container.clientWidth * 0.96;
      if (!naturalWidth || !available) return;
      const scale = Math.min(1, available / naturalWidth);
      setDims({ scale, width: naturalWidth * scale, height: naturalHeight * scale });
    };

    recalc();
    // Web fonts can widen text after the first measure — remeasure when ready.
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
    <div ref={containerRef} className="w-full overflow-x-auto">
      <div
        className="invoice-scale-wrapper"
        style={{
          width: dims.width,
          height: dims.height,
          overflow: dims.width ? "hidden" : "visible",
        }}
      >
        <div
          ref={sheetRef}
          className={`${className} inline-block align-top`}
          style={{ transform: `scale(${dims.scale})`, transformOrigin: "top left" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
