// Classic — traditional fully-bordered tax invoice in neutral ink. Centered
// title bar, company block left, invoice meta box right. Works at A4 or A5.

import { format } from "date-fns";
import { TemplateBody, CustomerBlock, companyTitle, brandInitials } from "./parts";
import type { TemplateProps, TemplateTheme } from "./types";

const theme: TemplateTheme = {
  headBg: "bg-gray-100",
  headText: "text-gray-900",
  rule: "border border-gray-400",
  totalRow: "bg-gray-200",
  accentText: "text-gray-900",
};

export function ClassicTemplate({ invoice, maps, settings, computed }: TemplateProps) {
  const companyName = settings.companyName || "Company Name";
  return (
    <div className="invoice-sheet bg-white text-black font-sans border-2 border-gray-800 p-5">
      <div className="border-b-2 border-gray-800 pb-2 text-center text-base font-bold tracking-[0.2em]">
        {companyTitle(computed)}
      </div>
      <div className="grid grid-cols-2 gap-4 border-b border-gray-400 py-3">
        <div className="flex gap-3">
          {settings.showLogo && (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-gray-800 text-sm font-bold">
              {brandInitials(companyName)}
            </div>
          )}
          <div>
            <div className="text-lg font-bold tracking-wide">{companyName}</div>
            {settings.addressLine && <div className="text-[11px]">{settings.addressLine}</div>}
            {settings.contact && <div className="text-[11px]">Contact: {settings.contact}</div>}
            {settings.email && <div className="text-[11px]">{settings.email}</div>}
            {computed.isGst && settings.gstin && (
              <div className="text-[11px]">GSTIN: {settings.gstin}</div>
            )}
          </div>
        </div>
        <div className="text-[11px]">
          <div className="grid grid-cols-[90px_1fr] gap-y-1">
            <span className="font-medium">Invoice No.</span>
            <span className="font-bold">{invoice.invoiceNo}</span>
            <span className="font-medium">Date</span>
            <span className="font-bold">{format(new Date(invoice.invoiceDate), "dd-MM-yyyy")}</span>
            <span className="font-medium">Place of Supply</span>
            <span>{computed.placeOfSupply}</span>
          </div>
        </div>
      </div>
      <div className="border-b border-gray-400 py-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
          Bill To
        </div>
        <CustomerBlock invoice={invoice} computed={computed} />
      </div>
      <div className="pt-3">
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
