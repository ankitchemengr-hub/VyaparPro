// Single shared "record a customer payment" dialog — used from the Invoices
// list (₹ icon per row), Invoice Detail ("Record Payment"), and the Payments
// page ("Log Payment", with no invoice pre-selected — a general/advance
// payment). One implementation means the invoice-application bug (invoiceId
// being silently stripped server-side) only needed fixing once, and every
// entry point gets the same receipt + print behavior for free.

import { useEffect, useState } from "react";
import {
  useLogPayment,
  useListAccounts,
  useGetEntity,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  getListPaymentsQueryKey,
  getListAccountsQueryKey,
  getGetEntityQueryKey,
  type PaymentAllocation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { printWithTitle } from "@/lib/print-with-title";
import {
  Loader2, IndianRupee, Banknote, Smartphone, CreditCard, Building2,
  CheckCircle2, Hash, Printer,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useGetPrintSettings } from "@workspace/api-client-react";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import { rupeesInWords } from "@/components/invoice-templates/helpers";

type PayMode = "cash" | "upi" | "cheque" | "bank_transfer" | "other";

const modeLabels: Record<PayMode, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

const modeIcons: Record<PayMode, React.ReactNode> = {
  cash: <Banknote className="w-4 h-4" />,
  upi: <Smartphone className="w-4 h-4" />,
  cheque: <CreditCard className="w-4 h-4" />,
  bank_transfer: <Building2 className="w-4 h-4" />,
  other: <IndianRupee className="w-4 h-4" />,
};

const accountTypeForMode: Record<string, string> = {
  cash: "cash",
  upi: "upi",
  cheque: "bank",
  bank_transfer: "bank",
  other: "",
};

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function computeReceiptPreview(formatString: string, nextNumber: number): string {
  const d = new Date();
  const y4 = String(d.getFullYear());
  const y2 = y4.slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const mmm = MONTH_ABBR[d.getMonth()];
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const fy = `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
  return formatString
    .replace(/YYYY/g, y4).replace(/YY/g, y2)
    .replace(/MMM/g, mmm).replace(/MM/g, mm)
    .replace(/FY/g, fy).replace(/SEQ/g, String(nextNumber));
}

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected customer — omit to let the server resolve a walk-in customer. */
  entityId?: number | null;
  entityName?: string | null;
  /** If set, this payment also reduces this specific invoice's own balance. */
  invoiceId?: number | null;
  invoiceNo?: string | null;
  /** Caps the amount field and shows "Balance due: X of Y" — omit for a general/advance payment with no cap. */
  maxAmount?: number | null;
  totalAmount?: number | null;
}

export function RecordPaymentDialog({
  open, onOpenChange, entityId, entityName, invoiceId, invoiceNo, maxAmount, totalAmount,
}: RecordPaymentDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logPayment = useLogPayment();
  const { data: accounts } = useListAccounts();
  const { data: settingsData } = useGetPrintSettings();
  const logo = useCompanyLogo();
  const settings = { ...(FALLBACK_PRINT_SETTINGS), ...(settingsData ?? {}), logo };

  const { data: entity } = useGetEntity(entityId ?? 0, {
    query: { enabled: !!entityId && open, queryKey: getGetEntityQueryKey(entityId ?? 0) },
  });
  const advanceCredit = entity && Number(entity.outstandingBalance) < 0 ? Math.abs(Number(entity.outstandingBalance)) : 0;

  const [amount, setAmount] = useState(0);
  const [mode, setMode] = useState<PayMode>("cash");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [accountError, setAccountError] = useState(false);
  const [success, setSuccess] = useState<{
    receiptId: string; approved: boolean; allocations: PaymentAllocation[]; balanceBefore: number | null;
  } | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const matchingAccounts = (accounts ?? []).filter(
    (a) => a.isActive && accountTypeForMode[mode] && a.type === accountTypeForMode[mode],
  );

  useEffect(() => {
    if (!open) return;
    setAmount(maxAmount != null ? Number(maxAmount) : 0);
    setMode("cash");
    setRef("");
    setNotes("");
    setAccountError(false);
    setSuccess(null);
    setReceiptPreview(null);
  }, [open, maxAmount]);

  useEffect(() => {
    if (!matchingAccounts.length) { setAccountId(null); return; }
    if (!accountId || !matchingAccounts.some((a) => a.id === accountId)) {
      setAccountId(matchingAccounts[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, accounts]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/number-series", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const recSeries = data.find((s: any) => s.seriesType === "payment_receipt");
        if (recSeries?.formatString) {
          setReceiptPreview(computeReceiptPreview(recSeries.formatString, recSeries.nextNumber));
        }
      })
      .catch(() => {});
  }, [open]);

  const handleSubmit = () => {
    if (matchingAccounts.length > 0 && !accountId) {
      setAccountError(true);
      return;
    }
    setAccountError(false);

    logPayment.mutate(
      {
        data: {
          ...(entityId ? { customerId: entityId } : {}),
          ...(invoiceId ? { invoiceId } : {}),
          amount,
          mode,
          ...(accountId ? { accountId } : {}),
          notes: [
            invoiceNo ? `Invoice ${invoiceNo}` : "",
            ref ? `Ref: ${ref}` : "",
            notes,
          ].filter(Boolean).join(" | ") || undefined,
        },
      },
      {
        onSuccess: (payment) => {
          const allocations = payment.allocations ?? [];
          // Allocation can spill across several invoices, not just the one
          // pinned (if any) — invalidate every invoice this payment actually
          // touched, plus the broad list for the Invoices page.
          for (const a of allocations) {
            queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(a.invoiceId) });
          }
          if (invoiceId && !allocations.some((a) => a.invoiceId === invoiceId)) {
            queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
          }
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          if (entityId) queryClient.invalidateQueries({ queryKey: getGetEntityQueryKey(entityId) });
          setSuccess({
            receiptId: payment.receiptId ?? "",
            approved: payment.status === "approved",
            allocations,
            balanceBefore: entity ? Number(entity.outstandingBalance) : null,
          });
          toast({
            title: payment.status === "approved" ? "Payment recorded" : "Payment logged — pending approval",
            description: `Receipt ${payment.receiptId} • ₹${amount.toLocaleString()} via ${modeLabels[mode]}`,
          });
        },
        onError: async (err: any) => {
          let desc = err?.message ?? "Server error";
          try {
            const body = err?.response ? await err.response.json() : null;
            if (body?.error) desc = String(body.error).slice(0, 300);
          } catch {}
          toast({ title: "Failed to record payment", description: desc, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!logPayment.isPending) onOpenChange(o); }}>
      {/* print:block on the receipt div alone only toggles ITS OWN display —
          it does nothing to hide the page behind this dialog, so a bare
          window.print() printed the whole Invoices list underneath (37
          pages). Hiding that page via `visibility: hidden` alone isn't
          enough either: an invisible-but-still-laid-out 453-row table still
          reserves its full page height, so the fixed-position receipt just
          got reprinted across dozens of otherwise-blank pages. Since this
          dialog's content is portaled outside #root by Radix, collapsing
          #root's layout entirely removes the invoices list from the
          printed page count instead of merely hiding its ink.

          On invoice pages the mounted invoice-template renderer carries its
          own `@media print { body * { visibility: hidden } }` rule. This
          receipt is portaled to <body>, outside that renderer's print area,
          so #root:display-none alone leaves it visibility:hidden and the
          sheet prints blank — re-assert visibility for its own subtree and
          pin it to the top of the page.

          CRITICAL: this <style> is a child of Radix <Dialog> Root, which
          renders its children even while closed. It MUST be gated on `open`
          — an always-present `#root { display: none }` rule blanks every
          OTHER print flow on the host page (e.g. printing the invoice
          itself from Invoice Detail, where this dialog is always mounted). */}
      {open && (
        <style>{`
          @media print {
            #root { display: none !important; }
            .payment-receipt-print-area, .payment-receipt-print-area * {
              visibility: visible !important;
              color: #000 !important;
            }
            .payment-receipt-print-area {
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
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-primary" />
            {invoiceNo ? `Record Payment — ${invoiceNo}` : `Record Payment${entityName ? ` — ${entityName}` : ""}`}
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <>
            <div className="py-6 flex flex-col items-center gap-3 text-center print:hidden">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-lg">{success.approved ? "Payment Recorded" : "Payment Logged"}</p>
              {success.receiptId && (
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                  <Hash className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono text-sm font-medium">{success.receiptId}</span>
                </div>
              )}
              <p className="text-sm text-muted-foreground">₹{amount.toLocaleString()} via {modeLabels[mode]}</p>
              {!success.approved && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Pending admin approval before the ledger is updated.
                </p>
              )}
              {success.allocations.length > 0 && (
                <div className="w-full text-left border rounded-md divide-y text-xs">
                  {success.allocations.map((a) => (
                    <div key={a.invoiceId} className="flex items-center justify-between px-3 py-1.5 gap-2">
                      <span className="font-mono">{a.invoiceNo}</span>
                      <span>₹{a.allocatedAmount.toLocaleString()}</span>
                      <span className={a.status === "paid" ? "text-green-600 font-medium" : "text-amber-600 font-medium"}>
                        {a.status === "paid" ? "PAID" : "PARTIALLY PAID"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Printable receipt — hidden on screen, shown only for print/PDF */}
            <div className="hidden print:block payment-receipt-print-area p-6 text-sm">
              <div className="flex items-center gap-3 mb-4">
                {settings.logo && <img src={settings.logo} alt="" className="h-10 w-10 object-contain" />}
                <div>
                  <div className="font-bold text-lg">{settings.companyName || "Payment Receipt"}</div>
                  <div className="text-xs text-muted-foreground">Payment Receipt</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div><span className="text-muted-foreground">Receipt No: </span>{success.receiptId}</div>
                <div><span className="text-muted-foreground">Date: </span>{new Date().toLocaleDateString("en-IN")}</div>
                <div><span className="text-muted-foreground">Received From: </span>{entityName ?? "—"}</div>
                {success.balanceBefore != null && (
                  <div><span className="text-muted-foreground">Balance Before: </span>₹{success.balanceBefore.toLocaleString()}</div>
                )}
                <div><span className="text-muted-foreground">Mode: </span>{modeLabels[mode]}</div>
                {!success.approved && <div><span className="text-muted-foreground">Status: </span>Pending approval</div>}
              </div>
              <div className="border-t border-b py-3 my-3">
                <div className="flex justify-between font-bold text-base">
                  <span>Amount</span>
                  <span>₹{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{rupeesInWords(amount)}</div>
              </div>

              {success.allocations.length > 0 && (
                <div className="mb-3">
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
                      {success.allocations.map((a) => (
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
              {success.balanceBefore != null && (
                <div className="text-xs text-muted-foreground">
                  Customer balance: ₹{success.balanceBefore.toLocaleString()} → ₹{(success.balanceBefore - amount).toLocaleString()}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4 py-2 print:hidden">
            <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
              <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <span className="text-xs text-muted-foreground">Receipt No. (auto-generated)</span>
                <p className="font-mono text-sm font-medium">
                  {receiptPreview ?? <span className="text-muted-foreground italic">Loading…</span>}
                </p>
              </div>
            </div>

            {advanceCredit > 0 && (
              <div className="text-xs bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 rounded-md px-3 py-2">
                ₹{advanceCredit.toLocaleString()} advance credit already available for this customer.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount Received (₹)</Label>
              <Input
                id="pay-amount"
                type="number"
                min={0}
                step="any"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                data-testid="input-pay-amount"
              />
              {maxAmount != null ? (
                <p className="text-xs text-muted-foreground">
                  Balance due: ₹{Number(maxAmount).toLocaleString()}{totalAmount != null ? ` of ₹${Number(totalAmount).toLocaleString()}` : ""}
                  {" — payment settles this customer's latest outstanding bill first, then works back through older ones."}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not tied to a specific invoice — applies to this customer's latest outstanding invoice first, then older ones; any amount beyond what's owed becomes advance credit.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Payment Mode</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["cash", "upi", "cheque", "bank_transfer", "other"] as PayMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setAccountError(false); }}
                    className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                      mode === m
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    {modeIcons[m]}
                    {modeLabels[m]}
                  </button>
                ))}
              </div>
            </div>

            {matchingAccounts.length > 0 && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  Deposit to Account <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={accountId ? String(accountId) : ""}
                  onValueChange={(v) => { setAccountId(v ? Number(v) : null); setAccountError(false); }}
                >
                  <SelectTrigger className={accountError ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select account (required)" />
                  </SelectTrigger>
                  <SelectContent>
                    {matchingAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{a.name}</span>
                          {a.identifier && <span className="text-xs text-muted-foreground">({a.identifier})</span>}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {accountError && (
                  <p className="text-xs text-destructive">Please select an account to deposit the payment.</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pay-ref">Reference / Cheque No. <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="pay-ref"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
                placeholder="UPI txn ID, cheque number…"
                data-testid="input-pay-ref"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="pay-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any remarks…"
                data-testid="input-pay-notes"
              />
            </div>
          </div>
        )}

        <DialogFooter className="print:hidden">
          {success ? (
            <>
              <Button variant="outline" onClick={() => printWithTitle(success.receiptId)} data-testid="button-print-receipt">
                <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={logPayment.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={logPayment.isPending || amount <= 0}
                data-testid="button-submit-payment"
              >
                {logPayment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Record ₹{amount.toLocaleString()} {modeLabels[mode]}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
