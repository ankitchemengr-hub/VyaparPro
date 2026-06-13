// Renders an invoice using whichever template id is requested, injecting that
// template's @page print CSS and isolating the sheet so only it prints.

import { useMemo } from "react";
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
      <div className={`invoice-print-area ${className}`}>
        <Template invoice={invoice} maps={maps} settings={settings} computed={computed} />
      </div>
    </>
  );
}
