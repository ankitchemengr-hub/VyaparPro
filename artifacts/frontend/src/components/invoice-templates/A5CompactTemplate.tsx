// A5 Compact — the legacy Shradha cash-memo, re-laid out as a genuine
// A5 PORTRAIT sheet (148 x 210mm). Same content, same column set and the
// same data-driven header/terms as before — only the geometry and typography
// are tuned so the whole bill fits inside one 148 x 210mm page without any
// transform:scale / zoom hack. The print @page rule for this template
// (getPrintCss, "a5-compact" branch) declares the matching 148 x 210mm page.

import { format } from "date-fns";
import { inr, num, lineLiters, rupeesInWords } from "./helpers";
import { PaymentQr, CompanyLogo } from "./parts";
import type { TemplateProps } from "./types";

const DEFAULT_TERMS = [
  "Goods once sold will not be taken back.",
  "Interest @ 24% p.a. on overdue bills.",
  "Subject to Solapur jurisdiction.",
];

// Pad a short bill with blank ruled rows so the item grid fills the page down
// to the footer instead of leaving a big gap. ~22 lines fills one A5 page; a
// bill longer than that simply flows onto a second A5 page.
const TARGET_ROWS = 22;

export function A5CompactTemplate({ invoice, maps, settings, computed }: TemplateProps) {
  const { lpbByProduct, upbByProduct } = maps;
  const { isGst, isInterstate, placeOfSupply, totalQty, totalLtr, totalBox, hasAnyDisc, roundOff, items } =
    computed;

  const companyName = (isGst && settings.gstLegalName) || settings.companyName || "SHRADHA ENTERPRISES";
  const logoWords = companyName.split(/\s+/).filter(Boolean);
  const logoLine1 = logoWords[0] ?? "";
  const logoLine2 = logoWords[1] ? `${logoWords[1].slice(0, 3).toUpperCase()}.` : "";
  const addressLine = settings.addressLine || "SOLAPUR";
  const contact = settings.contact || "9921338726";
  const gstin = settings.gstin || "27BFTPC0657J1Z5";
  const terms =
    (settings.terms ?? []).filter((t) => t && t.trim().length > 0).length > 0
      ? settings.terms!.filter((t) => t && t.trim().length > 0)
      : DEFAULT_TERMS;

  // Column count for the "PRODUCT:-" label row's colSpan.
  const colCount = 8 + (isGst ? 2 : 0) + (hasAnyDisc ? 1 : 0);
  const fillerCount = settings.fillerRows ? Math.max(0, TARGET_ROWS - items.length) : 0;

  const cell = "border-r border-black px-1 py-0.5 align-top";
  const fillerCell = "border-r border-black a5c-fill-cell";

  return (
    <div className="invoice-sheet a5c-sheet flex flex-col w-[148mm] min-h-[210mm] bg-white text-black border-2 border-black font-sans text-[8px] leading-tight">
      {/* Title bar */}
      <div className="grid grid-cols-3 items-center border-b border-black px-2 py-0.5">
        <div>&nbsp;</div>
        <div className="text-center font-bold tracking-wide text-[10px]">
          {isGst ? "TAX INVOICE" : "INVOICE"}
        </div>
        <div className="text-right text-[7px] italic">(Original Copy)</div>
      </div>

      {/* Header: company + invoice meta */}
      <div className="grid grid-cols-[1fr_auto] border-b border-black">
        <div className="border-r border-black p-2 flex gap-2">
          {settings.showLogo && (
            <CompanyLogo
              logo={settings.logo}
              name={companyName}
              className="w-10 h-10 rounded-full border border-black flex items-center justify-center text-[6px] text-center shrink-0 leading-none"
              fallback={
                <>
                  {logoLine1}
                  {logoLine2 && (
                    <>
                      <br />
                      {logoLine2}
                    </>
                  )}
                </>
              }
            />
          )}
          <div className="min-w-0">
            <div className="font-bold text-[13px] tracking-wide leading-tight">{companyName}</div>
            <div className="text-[7.5px]">{addressLine}</div>
            <div className="text-[7.5px]">Contact : {contact}</div>
            {isGst && gstin && <div className="text-[7.5px]">GSTIN : {gstin}</div>}
          </div>
        </div>
        <div className="p-2 w-[52mm]">
          <div className="grid grid-cols-[auto_6px_1fr] gap-y-1 text-[8px]">
            <div className="font-medium">Invoice No.</div>
            <div>:</div>
            <div className="font-bold italic">{invoice.invoiceNo}</div>
            <div className="font-medium">Date</div>
            <div>:</div>
            <div className="font-bold italic">{format(new Date(invoice.invoiceDate), "dd-MM-yyyy")}</div>
          </div>
        </div>
      </div>

      {/* Customer + A/c balance */}
      <div className="grid grid-cols-[1fr_auto] border-b border-black">
        <div className="border-r border-black p-2 space-y-0.5">
          <div className="font-bold text-[9px]">{invoice.customerName || "Cash Sale"}</div>
          {invoice.billingAddress && (
            <div className="whitespace-pre-line text-[7.5px] leading-tight">{invoice.billingAddress}</div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[7.5px] pt-0.5">
            <span>PoS: {placeOfSupply}</span>
            {invoice.customerMobile && <span>Mobile: <span className="font-mono">{invoice.customerMobile}</span></span>}
            {isGst && invoice.customerGstin && (
              <span>GSTIN: <span className="font-mono">{invoice.customerGstin}</span></span>
            )}
          </div>
        </div>
        <div className="p-2 w-[52mm]">
          <div className="grid grid-cols-[auto_6px_1fr] gap-y-1 text-[8px]">
            <div className="font-medium">Delivery Terms</div>
            <div>:</div>
            <div>&nbsp;</div>
            <div className="font-medium">A/c Balance</div>
            <div>:</div>
            <div className="font-bold italic">
              {invoice.customerBalanceAfter != null ? (
                <>₹ {inr(Math.abs(invoice.customerBalanceAfter))} {invoice.customerBalanceAfter > 0 ? "Dr" : invoice.customerBalanceAfter < 0 ? "Cr" : ""}</>
              ) : (
                <>₹ {inr(invoice.balanceDue ?? 0)} {Number(invoice.balanceDue ?? 0) > 0 ? "Dr" : ""}</>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Items table — grows to fill the page height */}
      <table className="a5c-items w-full table-fixed border-collapse text-[7.5px] flex-1">
        <colgroup>
          <col className="w-[16px]" />
          <col />
          {isGst && <col className="w-[30px]" />}
          <col className="w-[24px]" />
          <col className="w-[26px]" />
          <col className="w-[40px]" />
          <col className="w-[32px]" />
          <col className="w-[26px]" />
          {hasAnyDisc && <col className="w-[28px]" />}
          {isGst && <col className="w-[22px]" />}
          <col className="w-[48px]" />
        </colgroup>
        <thead>
          <tr className="border-y border-black bg-neutral-200 font-semibold">
            <th className={`${cell} text-left`}>SNo</th>
            <th className={`${cell} text-left`}>PARTICULARS</th>
            {isGst && <th className={`${cell} text-left`}>HSN</th>}
            <th className={`${cell} text-left`}>Unit</th>
            <th className={`${cell} text-right`}>QTY</th>
            <th className={`${cell} text-right`}>RATE</th>
            <th className={`${cell} text-right`}>LTR/KGS</th>
            <th className={`${cell} text-right`}>BOX</th>
            {hasAnyDisc && <th className={`${cell} text-right`}>DISC.</th>}
            {isGst && <th className={`${cell} text-right`}>GST</th>}
            <th className="px-1 py-0.5 text-right align-top">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={colCount} className="px-1 py-0.5 font-semibold">PRODUCT:-</td>
          </tr>
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
                <td className={cell}>{idx + 1}</td>
                <td className={`${cell} font-semibold break-words`}>{item.productName}</td>
                {isGst && <td className={`${cell} font-mono`}>{item.hsnCode ?? ""}</td>}
                <td className={`${cell} uppercase`}>{item.unit}</td>
                <td className={`${cell} text-right`}>{num(item.qty, 0)}</td>
                <td className={`${cell} text-right`}>₹ {inr(item.rate)}</td>
                <td className={`${cell} text-right`}>{ltr > 0 ? num(ltr, 3) : ""}</td>
                <td className={`${cell} text-right`}>{boxCount > 0 ? num(boxCount, 2) : ""}</td>
                {hasAnyDisc && <td className={`${cell} text-right`}>{disc}</td>}
                {isGst && <td className={`${cell} text-right`}>{Number(item.taxPct) || 0}%</td>}
                <td className="px-1 py-0.5 text-right align-top font-semibold">₹ {inr(item.amount)}</td>
              </tr>
            );
          })}
          {Array.from({ length: fillerCount }).map((_, i) => (
            <tr key={`pad-${i}`} className="a5c-fill">
              <td className={fillerCell}>&nbsp;</td>
              <td className={fillerCell}></td>
              {isGst && <td className={fillerCell}></td>}
              <td className={fillerCell}></td>
              <td className={fillerCell}></td>
              <td className={fillerCell}></td>
              <td className={fillerCell}></td>
              <td className={fillerCell}></td>
              {hasAnyDisc && <td className={fillerCell}></td>}
              {isGst && <td className={fillerCell}></td>}
              <td className="a5c-fill-cell"></td>
            </tr>
          ))}
          {/* Growing spacer: absorbs any leftover page height so the Total
              row + footer land at the bottom even on a very short bill. */}
          <tr className="a5c-grow" aria-hidden="true">
            <td className={fillerCell}></td>
            <td className={fillerCell}></td>
            {isGst && <td className={fillerCell}></td>}
            <td className={fillerCell}></td>
            <td className={fillerCell}></td>
            <td className={fillerCell}></td>
            <td className={fillerCell}></td>
            <td className={fillerCell}></td>
            {hasAnyDisc && <td className={fillerCell}></td>}
            {isGst && <td className={fillerCell}></td>}
            <td className="a5c-fill-cell"></td>
          </tr>
          {/* Totals row */}
          <tr className="border-t border-black font-semibold">
            <td className={cell}></td>
            <td className={`${cell} text-right`}>Total</td>
            {isGst && <td className={cell}></td>}
            <td className={cell}></td>
            <td className={`${cell} text-right`} data-testid="text-total-qty">{num(totalQty, 0)}</td>
            <td className={cell}></td>
            <td className={`${cell} text-right`} data-testid="text-total-ltr">{totalLtr > 0 ? num(totalLtr, 3) : ""}</td>
            <td className={`${cell} text-right`} data-testid="text-total-box">{totalBox > 0 ? num(totalBox, 2) : ""}</td>
            {hasAnyDisc && <td className={cell}></td>}
            {isGst && <td className={cell}></td>}
            <td className="px-1 py-0.5 text-right">₹ {inr(invoice.grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* Footer: words + QR + totals */}
      <div className="grid grid-cols-12 border-t-2 border-black">
        <div className="col-span-5 border-r border-black p-2 flex flex-col gap-1.5">
          {settings.showAmountInWords && (
            <div>
              <div className="font-semibold text-[7px]">Amount in Words :</div>
              <div className="italic text-[7px] leading-snug">{rupeesInWords(invoice.grandTotal)}</div>
            </div>
          )}
          {settings.showTerms && (
            <div className="text-[6.5px] leading-snug">
              <div className="font-semibold">Terms &amp; Conditions:</div>
              <ol className="list-decimal list-inside">
                {terms.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className="col-span-2 border-r border-black p-1 flex flex-col items-center justify-center text-center">
          {settings.showQr && (
            <>
              <PaymentQr invoice={invoice} settings={settings} size={54} rule="border-black" />
              <div className="text-[6.5px] mt-0.5 font-semibold">Scan &amp; Pay</div>
            </>
          )}
        </div>
        <div className="col-span-5">
          <table className="w-full text-[7.5px]">
            <tbody>
              <tr className="border-b border-black">
                <td className="px-2 py-0.5 font-semibold">Sub Total</td>
                <td className="px-2 py-0.5 text-right font-semibold">₹ {inr(invoice.subtotal)}</td>
              </tr>
              {invoice.customerBalanceBefore != null && invoice.customerBalanceBefore !== 0 && (
                <tr className="border-b border-black">
                  <td className="px-2 py-0.5">Balance B/F {invoice.customerBalanceBefore < 0 ? "(Cr)" : ""}</td>
                  <td className="px-2 py-0.5 text-right">₹ {inr(Math.abs(invoice.customerBalanceBefore))}</td>
                </tr>
              )}
              {(invoice.totalDiscount ?? 0) > 0 && (
                <tr className="border-b border-black">
                  <td className="px-2 py-0.5">Less Discount</td>
                  <td className="px-2 py-0.5 text-right">₹ {inr(invoice.totalDiscount ?? 0)}</td>
                </tr>
              )}
              {isGst && !isInterstate && (
                <>
                  <tr className="border-b border-black">
                    <td className="px-2 py-0.5">Add CGST</td>
                    <td className="px-2 py-0.5 text-right">₹ {inr(invoice.cgst ?? 0)}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="px-2 py-0.5">Add SGST</td>
                    <td className="px-2 py-0.5 text-right">₹ {inr(invoice.sgst ?? 0)}</td>
                  </tr>
                </>
              )}
              {isGst && isInterstate && (
                <tr className="border-b border-black">
                  <td className="px-2 py-0.5">Add IGST</td>
                  <td className="px-2 py-0.5 text-right">₹ {inr(invoice.igst ?? 0)}</td>
                </tr>
              )}
              {(invoice.freight ?? 0) > 0 && (
                <tr className="border-b border-black">
                  <td className="px-2 py-0.5">Freight</td>
                  <td className="px-2 py-0.5 text-right">₹ {inr(invoice.freight ?? 0)}</td>
                </tr>
              )}
              {roundOff !== 0 && (
                <tr className="border-b border-black">
                  <td className="px-2 py-0.5">Round Off ({roundOff > 0 ? "+" : "-"})</td>
                  <td className="px-2 py-0.5 text-right">₹ {inr(Math.abs(roundOff))}</td>
                </tr>
              )}
              <tr className="border-t-2 border-black">
                <td className="px-2 py-1 font-bold text-[10px]">TOTAL</td>
                <td className="px-2 py-1 text-right font-bold text-[10px]">₹ {inr(invoice.grandTotal)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="px-2 pt-1 pb-0.5 text-right font-semibold">For, {companyName}</td>
              </tr>
              {settings.showSignature && (
                <tr>
                  <td colSpan={2} className="px-2 pt-6 pb-0.5 text-right text-[7px] border-t border-black">
                    Authorized Signature
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
