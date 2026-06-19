// Reusable, settings-aware building blocks shared by the new design templates.
// The legacy A5 Compact template stays self-contained to guarantee zero visual
// regression; everything else composes these so column logic lives in one place.

import { inr, num, lineLiters, rupeesInWords } from "./helpers";
import type { Computed, ProductMaps, PrintSettings, TemplateTheme } from "./types";

interface ItemsTableProps {
  computed: Computed;
  settings: PrintSettings;
  maps: ProductMaps;
  theme: TemplateTheme;
  grandTotal: number;
}

export function ItemsTable({ computed, settings, maps, theme, grandTotal }: ItemsTableProps) {
  const { items, isGst, hasAnyDisc, totalQty, totalLtr, totalBox } = computed;
  const { lpbByProduct, upbByProduct } = maps;
  const showHsn = isGst && settings.showHsn;
  const showLtr = settings.showLtrColumn;
  const showBox = settings.showBoxColumn;
  const cell = `px-2 py-1.5 ${theme.rule}`;
  const minRows = settings.fillerRows ? 6 : 0;

  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr className={`${theme.headBg} ${theme.headText} text-left`}>
          <th className={`${cell} w-10`}>#</th>
          <th className={cell}>PARTICULARS</th>
          {showHsn && <th className={`${cell} w-20`}>HSN</th>}
          <th className={`${cell} w-14 text-right`}>QTY</th>
          <th className={`${cell} w-12`}>UNIT</th>
          {showLtr && <th className={`${cell} w-16 text-right`}>LTR/KGS</th>}
          {showBox && <th className={`${cell} w-16 text-right`}>BOX</th>}
          <th className={`${cell} w-20 text-right`}>RATE</th>
          {hasAnyDisc && <th className={`${cell} w-16 text-right`}>DISC.</th>}
          {isGst && <th className={`${cell} w-12 text-right`}>GST</th>}
          <th className={`${cell} w-24 text-right`}>AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item: any, idx: number) => {
          const ltr = lineLiters(item, lpbByProduct.get(Number(item.productId)));
          const upb = upbByProduct.get(Number(item.productId)) || 0;
          const boxCount = upb > 0 ? (Number(item.qty) || 0) / upb : 0;
          const disc =
            (Number(item.discountPct) || 0) > 0
              ? `${item.discountPct}%`
              : (Number(item.discountAmt) || 0) > 0
                ? `₹${inr(item.discountAmt)}`
                : "";
          return (
            <tr key={item.id} data-testid={`row-item-${item.id}`}>
              <td className={`${cell} align-top`}>{idx + 1}</td>
              <td className={`${cell} align-top font-medium`}>{item.productName}</td>
              {showHsn && <td className={`${cell} align-top font-mono`}>{item.hsnCode ?? ""}</td>}
              <td className={`${cell} align-top text-right`}>{num(item.qty, 0)}</td>
              <td className={`${cell} align-top uppercase`}>{item.unit}</td>
              {showLtr && <td className={`${cell} align-top text-right`}>{ltr > 0 ? num(ltr, 3) : ""}</td>}
              {showBox && <td className={`${cell} align-top text-right`}>{boxCount > 0 ? num(boxCount, 2) : ""}</td>}
              <td className={`${cell} align-top text-right`}>₹ {inr(item.rate)}</td>
              {hasAnyDisc && <td className={`${cell} align-top text-right`}>{disc}</td>}
              {isGst && <td className={`${cell} align-top text-right`}>{Number(item.taxPct) || 0}%</td>}
              <td className={`${cell} align-top text-right font-semibold`}>₹ {inr(item.amount)}</td>
            </tr>
          );
        })}
        {Array.from({ length: Math.max(0, minRows - items.length) }).map((_, i) => (
          <tr key={`pad-${i}`}>
            <td className={`${cell} py-3`}>&nbsp;</td>
            <td className={cell}></td>
            {showHsn && <td className={cell}></td>}
            <td className={cell}></td>
            <td className={cell}></td>
            {showLtr && <td className={cell}></td>}
            {showBox && <td className={cell}></td>}
            <td className={cell}></td>
            {hasAnyDisc && <td className={cell}></td>}
            {isGst && <td className={cell}></td>}
            <td className={cell}></td>
          </tr>
        ))}
        <tr className={`${theme.headBg} ${theme.headText} font-semibold`}>
          <td className={cell}></td>
          <td className={`${cell} text-right`}>Total</td>
          {showHsn && <td className={cell}></td>}
          <td className={`${cell} text-right`} data-testid="text-total-qty">{num(totalQty, 0)}</td>
          <td className={cell}></td>
          {showLtr && <td className={`${cell} text-right`} data-testid="text-total-ltr">{totalLtr > 0 ? num(totalLtr, 3) : ""}</td>}
          {showBox && <td className={`${cell} text-right`} data-testid="text-total-box">{totalBox > 0 ? num(totalBox, 2) : ""}</td>}
          <td className={cell}></td>
          {hasAnyDisc && <td className={cell}></td>}
          {isGst && <td className={cell}></td>}
          <td className={`${cell} text-right`}>₹ {inr(grandTotal)}</td>
        </tr>
      </tbody>
    </table>
  );
}

interface TotalsPanelProps {
  invoice: any;
  computed: Computed;
  theme: TemplateTheme;
}

export function TotalsPanel({ invoice, computed, theme }: TotalsPanelProps) {
  const { isGst, isInterstate, roundOff } = computed;
  const row = "flex justify-between py-1";
  return (
    <div className="w-full text-[12px]">
      <div className={row}>
        <span className="font-medium">Sub Total</span>
        <span>₹ {inr(invoice.subtotal)}</span>
      </div>
      {(invoice.totalDiscount ?? 0) > 0 && (
        <div className={row}>
          <span>Less Discount</span>
          <span>₹ {inr(invoice.totalDiscount ?? 0)}</span>
        </div>
      )}
      {isGst && !isInterstate && (
        <>
          <div className={row}>
            <span>Add CGST</span>
            <span>₹ {inr(invoice.cgst ?? 0)}</span>
          </div>
          <div className={row}>
            <span>Add SGST</span>
            <span>₹ {inr(invoice.sgst ?? 0)}</span>
          </div>
        </>
      )}
      {isGst && isInterstate && (
        <div className={row}>
          <span>Add IGST</span>
          <span>₹ {inr(invoice.igst ?? 0)}</span>
        </div>
      )}
      {(invoice.freight ?? 0) > 0 && (
        <div className={row}>
          <span>Freight</span>
          <span>₹ {inr(invoice.freight ?? 0)}</span>
        </div>
      )}
      {roundOff !== 0 && (
        <div className={row}>
          <span>Round Off ({roundOff > 0 ? "+" : "-"})</span>
          <span>₹ {inr(Math.abs(roundOff))}</span>
        </div>
      )}
      <div className={`mt-1 flex justify-between px-2 py-2 font-bold text-sm ${theme.totalRow}`}>
        <span>TOTAL</span>
        <span>₹ {inr(invoice.grandTotal)}</span>
      </div>
    </div>
  );
}

interface DocumentFooterProps {
  invoice: any;
  settings: PrintSettings;
  theme: TemplateTheme;
}

export function DocumentFooter({ invoice, settings, theme }: DocumentFooterProps) {
  const terms = (settings.terms ?? []).filter((t) => t && t.trim().length > 0);
  const bankLines = [
    settings.bankName && `Bank: ${settings.bankName}`,
    settings.bankAccount && `A/c: ${settings.bankAccount}`,
    settings.bankIfsc && `IFSC: ${settings.bankIfsc}`,
    settings.bankBranch && `Branch: ${settings.bankBranch}`,
    settings.upiId && `UPI: ${settings.upiId}`,
  ].filter(Boolean) as string[];
  return (
    <div className="mt-3 space-y-3">
      {settings.showAmountInWords && (
        <div className={`border-t pt-2 text-[11px] ${theme.rule}`}>
          <span className="font-semibold">Amount in words: </span>
          <span className={theme.accentText}>{rupeesInWords(Number(invoice.grandTotal) || 0)}</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          {settings.showBankDetails && bankLines.length > 0 && (
            <div className="text-[10px] leading-relaxed">
              <div className={`font-semibold ${theme.accentText}`}>Bank Details</div>
              {bankLines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
          {settings.showTerms && terms.length > 0 && (
            <div className="text-[10px] leading-relaxed">
              <div className={`font-semibold ${theme.accentText}`}>Terms &amp; Conditions</div>
              <ol className="list-decimal pl-4">
                {terms.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>
          )}
          {settings.footerNote && (
            <div className="text-[10px] italic text-gray-500">{settings.footerNote}</div>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 text-center">
          {settings.showQr && (
            <div className={`flex h-16 w-16 items-center justify-center border text-[8px] text-gray-400 ${theme.rule}`}>
              QR
            </div>
          )}
          {settings.showSignature && (
            <div className="pt-6 text-[10px]">
              <div className={`border-t px-4 pt-1 ${theme.rule}`}>Authorised Signatory</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Invoice title (TAX INVOICE for GST, INVOICE otherwise).
export function companyTitle(computed: Computed): string {
  return computed.isGst ? "TAX INVOICE" : "INVOICE";
}

// Bill-to block, data-driven from the invoice. Field names match the API/legacy
// A5 template (customerName / billingAddress / customerGstin).
export function CustomerBlock({ invoice, computed }: { invoice: any; computed: Computed }) {
  return (
    <div className="text-[11px] leading-relaxed">
      <div className="font-bold text-[12px]">{invoice.customerName || "Cash Sale"}</div>
      {invoice.billingAddress && (
        <div className="whitespace-pre-line">{invoice.billingAddress}</div>
      )}
      <div className="mt-0.5">PoS: {computed.placeOfSupply}</div>
      {computed.isGst && invoice.customerGstin && (
        <div className="font-mono">GSTIN: {invoice.customerGstin}</div>
      )}
    </div>
  );
}

// Items table + totals panel + document footer, themed. Shared by all the new
// design templates so the body stays consistent; only the header differs.
interface TemplateBodyProps {
  invoice: any;
  maps: ProductMaps;
  settings: PrintSettings;
  computed: Computed;
  theme: TemplateTheme;
}

export function TemplateBody({ invoice, maps, settings, computed, theme }: TemplateBodyProps) {
  return (
    <>
      <ItemsTable
        computed={computed}
        settings={settings}
        maps={maps}
        theme={theme}
        grandTotal={Number(invoice.grandTotal) || 0}
      />
      <div className="mt-3 flex justify-end">
        <div className="w-72">
          <TotalsPanel invoice={invoice} computed={computed} theme={theme} />
        </div>
      </div>
      <DocumentFooter invoice={invoice} settings={settings} theme={theme} />
    </>
  );
}

// Two-letter brand initials derived from the company name for the logo chip.
export function brandInitials(name: string): string {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
