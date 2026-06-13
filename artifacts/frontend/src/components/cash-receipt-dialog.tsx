import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X } from "lucide-react";
import type { AccountTransaction } from "@workspace/api-client-react";

const formatRs = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  other: "Other",
};

export function CashReceiptDialog({
  txn,
  onClose,
}: {
  txn: AccountTransaction | null;
  onClose: () => void;
}) {
  const open = txn !== null;
  if (!open || !txn) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent />
      </Dialog>
    );
  }

  const isIn = txn.direction === "in";
  const handlePrint = () => window.print();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md print:max-w-full print:shadow-none">
        <DialogHeader className="print:hidden">
          <DialogTitle>{isIn ? "Receipt" : "Payment Voucher"}</DialogTitle>
        </DialogHeader>

        <div id="cash-receipt-print" className="border rounded-md p-5 bg-white text-black space-y-3 print:border-0 print:p-0">
          <div className="text-center border-b pb-3">
            <div className="text-lg font-bold tracking-tight">SHRADHA ENTERPRISES</div>
            <div className="text-xs text-muted-foreground">Vipro Lubricants &middot; Lubricating Oil &amp; Grease</div>
            <div className={`mt-2 inline-block px-3 py-1 text-xs font-semibold rounded ${isIn ? "bg-green-100 text-green-800" : "bg-rose-100 text-rose-800"}`}>
              {isIn ? "CASH RECEIPT (PAYMENT IN)" : "PAYMENT VOUCHER (PAYMENT OUT)"}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-y-2 text-xs">
            <div className="text-muted-foreground">Receipt No.</div>
            <div className="font-mono font-semibold text-right" data-testid="receipt-no">{txn.receiptNo ?? `#${txn.id}`}</div>

            <div className="text-muted-foreground">Date</div>
            <div className="text-right">{new Date(txn.createdAt).toLocaleString("en-IN")}</div>

            <div className="text-muted-foreground">Account</div>
            <div className="text-right font-medium">{txn.accountName ?? `#${txn.accountId}`}</div>

            <div className="text-muted-foreground">Mode</div>
            <div className="text-right capitalize">{MODE_LABELS[txn.mode] ?? txn.mode}</div>

            {txn.partyName && (
              <>
                <div className="text-muted-foreground">{isIn ? "Received From" : "Paid To"}</div>
                <div className="text-right font-medium">{txn.partyName}</div>
              </>
            )}
            {txn.partyMobile && (
              <>
                <div className="text-muted-foreground">Mobile</div>
                <div className="text-right font-mono">{txn.partyMobile}</div>
              </>
            )}
            {txn.partyEntityId && (
              <>
                <div className="text-muted-foreground">Customer ID</div>
                <div className="text-right font-mono text-xs">#{txn.partyEntityId}</div>
              </>
            )}
          </div>

          <div className={`border-t border-b py-3 text-center ${isIn ? "bg-green-50" : "bg-rose-50"}`}>
            <div className="text-xs text-muted-foreground uppercase">Amount</div>
            <div className={`text-2xl font-bold tabular-nums ${isIn ? "text-green-700" : "text-rose-700"}`} data-testid="receipt-amount">
              {formatRs(Number(txn.amount))}
            </div>
          </div>

          {txn.notes && (
            <div className="text-xs">
              <div className="text-muted-foreground">Notes</div>
              <div className="italic">{txn.notes}</div>
            </div>
          )}

          <div className="pt-4 mt-2 border-t grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="text-muted-foreground">{isIn ? "Received By" : "Issued By"}</div>
              <div className="font-semibold">{txn.createdByName ?? "—"}</div>
              <div className="text-muted-foreground capitalize">
                {txn.createdByRole ?? ""}{txn.createdById ? ` · User ID: ${txn.createdById}` : ""}
              </div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">Signature</div>
              <div className="mt-6 border-t border-dashed pt-1">Authorised</div>
            </div>
          </div>

          {txn.balanceAfter !== null && txn.balanceAfter !== undefined && (
            <div className="text-[10px] text-muted-foreground text-right pt-1">
              Balance after this entry: <span className="font-mono">{formatRs(Number(txn.balanceAfter))}</span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 print:hidden">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-1" /> Close
          </Button>
          <Button onClick={handlePrint} data-testid="button-print-receipt">
            <Printer className="w-4 h-4 mr-1" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
