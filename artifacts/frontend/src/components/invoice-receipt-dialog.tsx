// Re-opens the receipt(s) an already-paid invoice was settled with — the
// Invoices list's ₹ action has nothing left to *record* once an invoice is
// fully paid, but the user still needs to reprint what was already
// collected. FIFO allocation means an invoice can be paid off across more
// than one receipt, so this shows a picker when there's more than one.

import { useEffect, useState } from "react";
import {
  useListInvoicePaymentReceipts,
  getListInvoicePaymentReceiptsQueryKey,
  useGetPaymentReceipt,
  getGetPaymentReceiptQueryKey,
  useGetPrintSettings,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, Hash, ChevronLeft } from "lucide-react";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import { rupeesInWords } from "@/components/invoice-templates/helpers";
import { printWithTitle } from "@/lib/print-with-title";

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

export interface InvoiceReceiptDialogProps {
  invoiceId: number | null;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceReceiptDialog({ invoiceId, onOpenChange }: InvoiceReceiptDialogProps) {
  const open = invoiceId != null;
  const { data: settingsData } = useGetPrintSettings();
  const logo = useCompanyLogo();
  const settings = { ...(FALLBACK_PRINT_SETTINGS), ...(settingsData ?? {}), logo };

  const { data: receipts, isLoading: listLoading } = useListInvoicePaymentReceipts(invoiceId ?? 0, {
    query: { enabled: open, queryKey: getListInvoicePaymentReceiptsQueryKey(invoiceId ?? 0) },
  });

  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setSelected(null); return; }
  }, [open, invoiceId]);

  useEffect(() => {
    if (receipts && receipts.length === 1) setSelected(receipts[0].receiptNo);
  }, [receipts]);

  const { data: receipt, isLoading: receiptLoading } = useGetPaymentReceipt(selected ?? "", {
    query: { enabled: !!selected, queryKey: getGetPaymentReceiptQueryKey(selected ?? "") },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      {/* This dialog's content is portaled outside #root by Radix, so
          collapsing #root's layout for print removes the Invoices list
          behind it entirely instead of just hiding its ink (which would
          still reserve page height and print blank pages). The subtree
          rule below additionally re-asserts visibility in case a host page
          print-hides everything with `body * { visibility: hidden }`.

          CRITICAL: this <style> is a child of Radix <Dialog> Root, which
          renders its children even while closed. It MUST be gated on `open`
          — an always-present `#root { display: none }` rule blanks every
          other print flow on the host page. */}
      {open && (
        <style>{`
          @media print {
            #root { display: none !important; }
            .invoice-receipt-print-area, .invoice-receipt-print-area * {
              visibility: visible !important;
              color: #000 !important;
            }
            .invoice-receipt-print-area {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
            }
          }
        `}</style>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="print:hidden">
          <DialogTitle>Payment Receipt</DialogTitle>
        </DialogHeader>

        {listLoading ? (
          <div className="py-10 flex justify-center print:hidden">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !receipts || receipts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground print:hidden">
            No receipt found for this invoice.
          </p>
        ) : !selected ? (
          <div className="space-y-2 print:hidden">
            <p className="text-xs text-muted-foreground">
              This invoice was paid across {receipts.length} receipts — pick one to view.
            </p>
            {receipts.map((r) => (
              <button
                key={r.receiptNo}
                type="button"
                onClick={() => setSelected(r.receiptNo)}
                className="w-full flex items-center justify-between gap-2 p-2.5 border rounded-md text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                data-testid={`option-invoice-receipt-${r.receiptNo}`}
              >
                <span className="flex items-center gap-1.5 font-mono">
                  <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                  {r.receiptNo}
                </span>
                <span className="font-medium">₹{r.amount.toLocaleString()}</span>
              </button>
            ))}
          </div>
        ) : receiptLoading || !receipt ? (
          <div className="py-10 flex justify-center print:hidden">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="invoice-receipt-print-area border rounded-md p-5 text-sm space-y-3" data-testid="invoice-receipt-view">
            <div className="flex items-center gap-3 pb-3 border-b">
              {settings.logo && <img src={settings.logo} alt="" className="h-10 w-10 object-contain" />}
              <div>
                <div className="font-bold text-lg">{settings.companyName || "Payment Receipt"}</div>
                <div className="text-xs text-muted-foreground">Payment Receipt</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className="text-muted-foreground">Receipt No: </span>{receipt.receiptNo}</div>
              <div><span className="text-muted-foreground">Date: </span>{new Date(receipt.date).toLocaleDateString("en-IN")}</div>
              <div><span className="text-muted-foreground">Received From: </span>{receipt.partyName ?? "—"}</div>
              <div><span className="text-muted-foreground">Mode: </span>{MODE_LABELS[receipt.mode] ?? receipt.mode}</div>
              {receipt.customerBalanceBefore != null && (
                <div><span className="text-muted-foreground">Balance Before: </span>₹{receipt.customerBalanceBefore.toLocaleString()}</div>
              )}
              {receipt.status !== "approved" && (
                <div><span className="text-muted-foreground">Status: </span>{receipt.status}</div>
              )}
            </div>
            <div className="border-t border-b py-3">
              <div className="flex justify-between font-bold text-base">
                <span>Amount</span>
                <span>₹{receipt.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">{rupeesInWords(receipt.amount)}</div>
            </div>

            {receipt.allocations && receipt.allocations.length > 0 && (
              <div>
                <div className="font-semibold text-sm mb-1.5">Adjusted Against</div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2">Invoice</th>
                      <th className="text-right py-1 px-2">Invoice Amt</th>
                      <th className="text-right py-1 px-2">Prev. Paid</th>
                      <th className="text-right py-1 px-2">This Payment</th>
                      <th className="text-right py-1 px-2">Remaining</th>
                      <th className="text-right py-1 pl-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipt.allocations.map((a) => (
                      <tr key={a.invoiceId} className="border-b border-dashed">
                        <td className="py-1 pr-2 font-mono">{a.invoiceNo}</td>
                        <td className="text-right py-1 px-2">₹{a.invoiceAmount.toLocaleString()}</td>
                        <td className="text-right py-1 px-2">₹{a.previousPaid.toLocaleString()}</td>
                        <td className="text-right py-1 px-2">₹{a.allocatedAmount.toLocaleString()}</td>
                        <td className="text-right py-1 px-2">₹{a.balanceAfter.toLocaleString()}</td>
                        <td className="text-right py-1 pl-2 font-medium">{a.status === "paid" ? "PAID" : "PARTIALLY PAID"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {receipt.customerBalanceBefore != null && receipt.customerBalanceAfter != null && (
              <div className="text-xs text-muted-foreground">
                Customer balance: ₹{receipt.customerBalanceBefore.toLocaleString()} → ₹{receipt.customerBalanceAfter.toLocaleString()}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="print:hidden">
          {receipts && receipts.length > 1 && selected && (
            <Button variant="ghost" onClick={() => setSelected(null)} className="mr-auto">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          )}
          {selected && receipt && (
            <Button variant="outline" onClick={() => printWithTitle(receipt.receiptNo)} data-testid="button-print-invoice-receipt">
              <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
