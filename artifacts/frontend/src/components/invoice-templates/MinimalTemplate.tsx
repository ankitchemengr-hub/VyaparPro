// Minimal — airy, typography-led layout. Thin rules, generous whitespace, a
// single amber accent. No heavy fills; lets the data breathe.

import { format } from "date-fns";
import { TemplateBody, CustomerBlock, companyTitle } from "./parts";
import type { TemplateProps, TemplateTheme } from "./types";

const theme: TemplateTheme = {
  headBg: "bg-white",
  headText: "text-gray-500",
  rule: "border-b border-gray-200",
  totalRow: "border-t-2 border-gray-900 text-gray-900",
  accentText: "text-amber-600",
};

export function MinimalTemplate({ invoice, maps, settings, computed }: TemplateProps) {
  const companyName = settings.companyName || "Company Name";
  return (
    <div className="invoice-sheet bg-white text-gray-900 font-sans p-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-semibold tracking-tight">{companyName}</div>
          <div className="mt-1 h-0.5 w-12 bg-amber-500" />
          <div className="mt-2 text-[11px] text-gray-500">
            {[settings.addressLine, settings.contact, settings.email]
              .filter(Boolean)
              .join("  ·  ")}
          </div>
          {computed.isGst && settings.gstin && (
            <div className="text-[11px] text-gray-500">GSTIN {settings.gstin}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs font-medium uppercase tracking-[0.3em] text-amber-600">
            {companyTitle(computed)}
          </div>
          <div className="mt-1 text-lg font-semibold">{invoice.invoiceNo}</div>
          <div className="text-[11px] text-gray-500">
            {format(new Date(invoice.invoiceDate), "dd MMM yyyy")}
          </div>
        </div>
      </div>

      <div className="my-6 grid grid-cols-2 gap-8 text-[11px]">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-400">
            Billed To
          </div>
          <CustomerBlock invoice={invoice} computed={computed} />
        </div>
        <div className="text-right">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-gray-400">
            Place of Supply
          </div>
          <div>{computed.placeOfSupply}</div>
        </div>
      </div>

      <TemplateBody
        invoice={invoice}
        maps={maps}
        settings={settings}
        computed={computed}
        theme={theme}
      />
    </div>
  );
}
