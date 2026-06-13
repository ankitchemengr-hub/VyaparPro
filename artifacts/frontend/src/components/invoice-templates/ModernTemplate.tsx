// Modern — the on-brand Vipro design. Warm amber/saffron header band, white
// title, rounded brand chip. This is the flagship "looks best" template.

import { format } from "date-fns";
import { TemplateBody, CustomerBlock, companyTitle, brandInitials } from "./parts";
import type { TemplateProps, TemplateTheme } from "./types";

const theme: TemplateTheme = {
  headBg: "bg-amber-600",
  headText: "text-white",
  rule: "border border-amber-200",
  totalRow: "bg-amber-100 text-amber-900",
  accentText: "text-amber-700",
};

export function ModernTemplate({ invoice, maps, settings, computed }: TemplateProps) {
  const companyName = settings.companyName || "Company Name";
  return (
    <div className="invoice-sheet bg-white text-black font-sans">
      <div className="bg-gradient-to-r from-amber-600 to-amber-500 px-6 py-4 text-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {settings.showLogo && (
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-lg font-bold backdrop-blur">
                {brandInitials(companyName)}
              </div>
            )}
            <div>
              <div className="text-xl font-extrabold tracking-wide">{companyName}</div>
              <div className="text-[11px] opacity-90">
                {[settings.addressLine, settings.contact].filter(Boolean).join("  •  ")}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold uppercase tracking-[0.2em]">{companyTitle(computed)}</div>
            {computed.isGst && settings.gstin && (
              <div className="text-[11px] opacity-90">GSTIN: {settings.gstin}</div>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="mb-4 grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Bill To
            </div>
            <CustomerBlock invoice={invoice} computed={computed} />
          </div>
          <div className="rounded-lg border border-amber-100 p-3 text-[11px]">
            <div className="grid grid-cols-[90px_1fr] gap-y-1.5">
              <span className="text-gray-500">Invoice No.</span>
              <span className="font-bold">{invoice.invoiceNo}</span>
              <span className="text-gray-500">Date</span>
              <span className="font-bold">
                {format(new Date(invoice.invoiceDate), "dd-MM-yyyy")}
              </span>
              <span className="text-gray-500">Place of Supply</span>
              <span>{computed.placeOfSupply}</span>
            </div>
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
    </div>
  );
}
