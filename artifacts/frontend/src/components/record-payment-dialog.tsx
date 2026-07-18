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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  const [success, setSuccess] = useState<{ receiptId: string; approved: boolean } | null>(null);
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
          if (invoiceId) queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(invoiceId) });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          setSuccess({ receiptId: payment.receiptId ?? "", approved: payment.status === "approved" });
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
      <DialogContent className="sm:max-w-md print:hidden">
        <DialogHeader className={success ? "print:hidden" : ""}>
          <DialogTitle className="flex items-center gap-2">
            <IndianRupee className="w-5 h-5 text-primary" />
            {invoiceNo ? `Record Payment — ${invoiceNo}` : `Record Payment${entityName ? ` — ${entityName}` : ""}`}
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <>
            <div className="py-6 flex flex-col items-center gap-3 text-center">
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
            </div>

            {/* Printable receipt — hidden on screen, shown only for print/PDF */}
            <div className="hidden print:block p-6 text-sm">
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
                {invoiceNo && <div><span className="text-muted-foreground">Against Invoice: </span>{invoiceNo}</div>}
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
            </div>
          </>
        ) : (
          <div className="space-y-4 py-2">
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
                max={maxAmount != null ? Number(maxAmount) : undefined}
                step="any"
                value={amount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAmount(maxAmount != null ? Math.min(v, Number(maxAmount)) : v);
                }}
                data-testid="input-pay-amount"
              />
              {maxAmount != null ? (
                <p className="text-xs text-muted-foreground">
                  Balance due: ₹{Number(maxAmount).toLocaleString()}{totalAmount != null ? ` of ₹${Number(totalAmount).toLocaleString()}` : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Not tied to a specific invoice — any amount beyond what's owed becomes advance credit.
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
              <Button variant="outline" onClick={() => window.print()} data-testid="button-print-receipt">
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
