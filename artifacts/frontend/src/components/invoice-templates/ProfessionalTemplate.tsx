// Professional — corporate slate look. FROM / BILL TO cards with dark headers,
// clean rules, restrained accent. Suited to GST B2B invoices.

import { format } from "date-fns";
import { TemplateBody, CustomerBlock, companyTitle, brandInitials } from "./parts";
import type { TemplateProps, TemplateTheme } from "./types";

const theme: TemplateTheme = {
  headBg: "bg-slate-800",
  headText: "text-white",
  rule: "border border-slate-300",
  totalRow: "bg-slate-800 text-white",
  accentText: "text-slate-700",
};

export function ProfessionalTemplate({ invoice, maps, settings, computed }: TemplateProps) {
  const companyName = settings.companyName || "Company Name";
  return (
    <div className="invoice-sheet bg-white text-black font-sans p-6">
      <div className="flex items-start justify-between border-b-4 border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          {settings.showLogo && (
            <div className="flex h-12 w-12 items-center justify-center rounded bg-slate-800 text-base font-bold text-white">
              {brandInitials(companyName)}
            </div>
          )}
          <div>
            <div className="text-lg font-bold text-slate-900">{companyName}</div>
            {settings.addressLine && <div className="text-[11px] text-slate-600">{settings.addressLine}</div>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-light uppercase tracking-[0.15em] text-slate-800">
            {companyTitle(computed)}
          </div>
          <div className="text-[11px] text-slate-500">#{invoice.invoiceNo}</div>
        </div>
      </div>

      <div className="my-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-slate-300 bg-slate-300">
        <div className="bg-white">
          <div className="bg-slate-800 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            From
          </div>
          <div className="p-3 text-[11px] leading-relaxed">
            <div className="font-semibold">{companyName}</div>
            {settings.contact && <div>Contact: {settings.contact}</div>}
            {settings.email && <div>{settings.email}</div>}
            {computed.isGst && settings.gstin && <div className="font-mono">GSTIN: {settings.gstin}</div>}
          </div>
        </div>
        <div className="bg-white">
          <div className="bg-slate-800 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
            Bill To
          </div>
          <div className="p-3">
            <CustomerBlock invoice={invoice} computed={computed} />
          </div>
        </div>
      </div>

      <div className="mb-3 flex gap-6 text-[11px] text-slate-600">
        <span>Date: <span className="font-semibold text-slate-900">{format(new Date(invoice.invoiceDate), "dd-MM-yyyy")}</span></span>
        <span>Place of Supply: <span className="font-semibold text-slate-900">{computed.placeOfSupply}</span></span>
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
