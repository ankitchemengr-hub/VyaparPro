// A5 Compact — the faithful legacy Shradha landscape bill (default template).
// Layout is preserved pixel-for-pixel; only the header/terms are now data-driven
// from print settings, with fallbacks to the original Shradha literals so the
// seeded company renders byte-identically to the original hardcoded version.

import { format } from "date-fns";
import { inr, num, lineLiters, rupeesInWords } from "./helpers";
import type { TemplateProps } from "./types";

const DEFAULT_TERMS = [
  "Goods once sold will not be taken back.",
  "Interest @ 24% p.a. on overdue bills.",
  "Subject to Solapur jurisdiction.",
];

export function A5CompactTemplate({ invoice, maps, settings, computed }: TemplateProps) {
  const { lpbByProduct, upbByProduct } = maps;
  const { isGst, isInterstate, placeOfSupply, totalQty, totalLtr, totalBox, hasAnyDisc, roundOff, items } =
    computed;

  const companyName = settings.companyName || "SHRADHA ENTERPRISES";
  // Legacy badge rendering: first word on line 1, abbreviated second word on
  // line 2 (e.g. "SHRADHA" / "ENT.") to stay faithful to the original sheet.
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

  return (
    <div className="invoice-sheet bg-white text-black border border-black text-[12px] leading-snug font-sans">
      {/* Title bar */}
      <div className="grid grid-cols-3 items-center border-b border-black px-3 py-1.5">
        <div className="text-[11px]">&nbsp;</div>
        <div className="text-center font-semibold tracking-wide text-sm">
          {isGst ? "TAX INVOICE" : "INVOICE"}
        </div>
        <div className="text-right text-[11px] italic">(Original Copy)</div>
      </div>

      {/* Header: company info + invoice meta */}
      <div className="grid grid-cols-12 border-b border-black">
        <div className="col-span-7 border-r border-black p-3 flex gap-3">
          {settings.showLogo && (
            <div className="w-16 h-16 rounded-full border border-black flex items-center justify-center text-[10px] text-center shrink-0">
              {logoLine1}
              {logoLine2 && (
                <>
                  <br />
                  {logoLine2}
                </>
              )}
            </div>
          )}
          <div className="flex-1">
            <div className="font-bold text-lg tracking-wide">{companyName}</div>
            <div className="text-[12px]">{addressLine}</div>
            <div className="text-[12px]">Contact : {contact}</div>
            {isGst && gstin && <div className="text-[12px]">GSTIN :- {gstin}</div>}
          </div>
        </div>
        <div className="col-span-5 p-3">
          <div className="grid grid-cols-[100px_10px_1fr] gap-y-2">
            <div className="font-medium">Invoice No.</div>
            <div>:</div>
            <div className="font-bold italic">{invoice.invoiceNo}</div>
            <div className="font-medium">Date</div>
            <div>:</div>
            <div className="font-bold italic">
              {format(new Date(invoice.invoiceDate), "dd-MM-yyyy")}
            </div>
          </div>
        </div>
      </div>

      {/* Customer + delivery terms + A/c balance */}
      <div className="grid grid-cols-12 border-b border-black">
        <div className="col-span-7 border-r border-black p-3 space-y-1">
          <div className="font-bold">{invoice.customerName || "Cash Sale"}</div>
          {invoice.billingAddress && (
            <div className="whitespace-pre-line text-[12px]">{invoice.billingAddress}</div>
          )}
          <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 text-[12px] pt-1">
            <span>PoS:</span>
            <span>{placeOfSupply}</span>
            {isGst && invoice.customerGstin && (
              <>
                <span>GSTIN:</span>
                <span className="font-mono">{invoice.customerGstin}</span>
              </>
            )}
          </div>
        </div>
        <div className="col-span-5 p-3">
          <div className="grid grid-cols-[100px_10px_1fr] gap-y-2 text-[12px]">
            <div className="font-medium">Delivery Terms</div>
            <div>:</div>
            <div>&nbsp;</div>
            <div className="font-medium">A/c Balance</div>
            <div>:</div>
            <div className="font-bold italic">
              ₹ {inr(invoice.balanceDue ?? 0)} {Number(invoice.balanceDue ?? 0) > 0 ? "Dr" : ""}
            </div>
          </div>
        </div>
      </div>

      {/* Items table */}
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-black bg-white">
            <th className="border-r border-black px-2 py-1 text-left w-10">SNo</th>
            <th className="border-r border-black px-2 py-1 text-left">PARTICULARS</th>
            {isGst && <th className="border-r border-black px-2 py-1 text-left w-20">HSN</th>}
            <th className="border-r border-black px-2 py-1 text-right w-14">QTY</th>
            <th className="border-r border-black px-2 py-1 text-left w-12">Unit</th>
            <th className="border-r border-black px-2 py-1 text-right w-16">LTR/KGS</th>
            <th className="border-r border-black px-2 py-1 text-right w-16">BOX</th>
            <th className="border-r border-black px-2 py-1 text-right w-20">RATE</th>
            {hasAnyDisc && <th className="border-r border-black px-2 py-1 text-right w-16">DISC.</th>}
            {isGst && <th className="border-r border-black px-2 py-1 text-right w-12">GST</th>}
            <th className="px-2 py-1 text-right w-24">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td
              colSpan={isGst ? (hasAnyDisc ? 11 : 10) : hasAnyDisc ? 10 : 9}
              className="px-2 py-0.5 font-semibold"
            >
              PRODUCT:-
            </td>
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
                <td className="border-r border-black px-2 py-1 align-top">{idx + 1}</td>
                <td className="border-r border-black px-2 py-1 align-top font-semibold">
                  {item.productName}
                </td>
                {isGst && (
                  <td className="border-r border-black px-2 py-1 align-top font-mono">
                    {item.hsnCode ?? ""}
                  </td>
                )}
                <td className="border-r border-black px-2 py-1 text-right align-top">
                  {num(item.qty, 0)}
                </td>
                <td className="border-r border-black px-2 py-1 align-top uppercase">{item.unit}</td>
                <td className="border-r border-black px-2 py-1 text-right align-top">
                  {ltr > 0 ? num(ltr, 3) : ""}
                </td>
                <td className="border-r border-black px-2 py-1 text-right align-top">
                  {boxCount > 0 ? num(boxCount, 2) : ""}
                </td>
                <td className="border-r border-black px-2 py-1 text-right align-top">
                  ₹ {inr(item.rate)}
                </td>
                {hasAnyDisc && (
                  <td className="border-r border-black px-2 py-1 text-right align-top">{disc}</td>
                )}
                {isGst && (
                  <td className="border-r border-black px-2 py-1 text-right align-top">
                    {Number(item.taxPct) || 0}%
                  </td>
                )}
                <td className="px-2 py-1 text-right align-top font-semibold">
                  ₹ {inr(item.amount)}
                </td>
              </tr>
            );
          })}
          {settings.fillerRows &&
            Array.from({ length: Math.max(0, 6 - items.length) }).map((_, i) => (
              <tr key={`pad-${i}`}>
                <td className="border-r border-black px-2 py-3">&nbsp;</td>
                <td className="border-r border-black px-2 py-3"></td>
                {isGst && <td className="border-r border-black px-2 py-3"></td>}
                <td className="border-r border-black px-2 py-3"></td>
                <td className="border-r border-black px-2 py-3"></td>
                <td className="border-r border-black px-2 py-3"></td>
                <td className="border-r border-black px-2 py-3"></td>
                <td className="border-r border-black px-2 py-3"></td>
                {hasAnyDisc && <td className="border-r border-black px-2 py-3"></td>}
                {isGst && <td className="border-r border-black px-2 py-3"></td>}
                <td className="px-2 py-3"></td>
              </tr>
            ))}
          {/* Totals row — Qty and Ltr sit directly under their own columns */}
          <tr className="border-t border-black font-semibold bg-white">
            <td className="border-r border-black px-2 py-1"></td>
            <td className="border-r border-black px-2 py-1 text-right">Total</td>
            {isGst && <td className="border-r border-black px-2 py-1"></td>}
            <td className="border-r border-black px-2 py-1 text-right" data-testid="text-total-qty">
              {num(totalQty, 0)}
            </td>
            <td className="border-r border-black px-2 py-1"></td>
            <td className="border-r border-black px-2 py-1 text-right" data-testid="text-total-ltr">
              {totalLtr > 0 ? num(totalLtr, 3) : ""}
            </td>
            <td className="border-r border-black px-2 py-1 text-right" data-testid="text-total-box">
              {totalBox > 0 ? num(totalBox, 2) : ""}
            </td>
            <td className="border-r border-black px-2 py-1"></td>
            {hasAnyDisc && <td className="border-r border-black px-2 py-1"></td>}
            {isGst && <td className="border-r border-black px-2 py-1"></td>}
            <td className="px-2 py-1 text-right">₹ {inr(invoice.grandTotal)}</td>
          </tr>
        </tbody>
      </table>

      {/* Footer: words + QR + totals */}
      <div className="grid grid-cols-12 border-t border-black">
        <div className="col-span-5 border-r border-black p-3 flex flex-col">
          {settings.showAmountInWords && (
            <div>
              <div className="font-semibold">Amount in Words :</div>
              <div className="italic mt-1">{rupeesInWords(invoice.grandTotal)}</div>
            </div>
          )}
          {settings.showTerms && (
            <div className="mt-3 text-[11px]">
              <div className="font-semibold">Terms &amp; Conditions:</div>
              <ol className="list-decimal list-inside mt-1 space-y-0.5">
                {terms.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className="col-span-2 border-r border-black p-2 flex flex-col items-center justify-center text-center">
          {settings.showQr && (
            <>
              <div className="w-20 h-20 border border-black flex items-center justify-center text-[8px] text-muted-foreground">
                QR / UPI
              </div>
              <div className="text-[9px] mt-1 font-semibold">Scan &amp; Pay</div>
            </>
          )}
        </div>
        <div className="col-span-5 p-0 flex flex-col">
          <table className="w-full text-[12px]">
            <tbody>
              <tr className="border-b border-black">
                <td className="px-3 py-1.5 font-semibold">Sub Total</td>
                <td className="px-3 py-1.5 text-right font-semibold">₹ {inr(invoice.subtotal)}</td>
              </tr>
              {(invoice.totalDiscount ?? 0) > 0 && (
                <tr className="border-b border-black">
                  <td className="px-3 py-1.5">Less Discount</td>
                  <td className="px-3 py-1.5 text-right">₹ {inr(invoice.totalDiscount ?? 0)}</td>
                </tr>
              )}
              {isGst && !isInterstate && (
                <>
                  <tr className="border-b border-black">
                    <td className="px-3 py-1.5">Add CGST</td>
                    <td className="px-3 py-1.5 text-right">₹ {inr(invoice.cgst ?? 0)}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="px-3 py-1.5">Add SGST</td>
                    <td className="px-3 py-1.5 text-right">₹ {inr(invoice.sgst ?? 0)}</td>
                  </tr>
                </>
              )}
              {isGst && isInterstate && (
                <tr className="border-b border-black">
                  <td className="px-3 py-1.5">Add IGST</td>
                  <td className="px-3 py-1.5 text-right">₹ {inr(invoice.igst ?? 0)}</td>
                </tr>
              )}
              {(invoice.freight ?? 0) > 0 && (
                <tr className="border-b border-black">
                  <td className="px-3 py-1.5">Freight</td>
                  <td className="px-3 py-1.5 text-right">₹ {inr(invoice.freight ?? 0)}</td>
                </tr>
              )}
              {roundOff !== 0 && (
                <tr className="border-b border-black">
                  <td className="px-3 py-1.5">Round Off ({roundOff > 0 ? "+" : "-"})</td>
                  <td className="px-3 py-1.5 text-right">₹ {inr(Math.abs(roundOff))}</td>
                </tr>
              )}
              <tr className="border-t-2 border-black bg-white">
                <td className="px-3 py-2 font-bold text-sm">TOTAL</td>
                <td className="px-3 py-2 text-right font-bold text-sm">₹ {inr(invoice.grandTotal)}</td>
              </tr>
              <tr>
                <td colSpan={2} className="px-3 pt-2 pb-1 text-right font-semibold">
                  For, {companyName}
                </td>
              </tr>
              {settings.showSignature && (
                <tr>
                  <td
                    colSpan={2}
                    className="px-3 pt-10 pb-1 text-right text-[11px] border-t border-black"
                  >
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
