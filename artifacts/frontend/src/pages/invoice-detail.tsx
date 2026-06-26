import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  useListProducts,
  useGetPrintSettings,
  useLogPayment,
  useListAccounts,
  getListPaymentsQueryKey,
  getListAccountsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Printer, Loader2, LayoutTemplate, IndianRupee, Banknote, Smartphone, CreditCard, Building2, CheckCircle2, Hash, MessageCircle } from "lucide-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { InvoiceTemplateRenderer } from "@/components/invoice-templates/InvoiceTemplateRenderer";
import { InvoiceTemplateSelector } from "@/components/invoice-templates/InvoiceTemplateSelector";
import { getTemplate } from "@/components/invoice-templates/registry";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";

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

export default function InvoiceDetail() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = Number(params?.id);

  const { data: invoice, isLoading, error } = useGetInvoice(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetInvoiceQueryKey(id) },
  });
  const { data: products } = useListProducts({});
  const { data: settingsData, isLoading: settingsLoading } = useGetPrintSettings();
  const { data: accounts } = useListAccounts();
  const settings = settingsData ?? FALLBACK_PRINT_SETTINGS;

  const logPayment = useLogPayment();

  const [templateOverride, setTemplateOverride] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);

  // WhatsApp send state
  const [waOpen, setWaOpen] = useState(false);
  const [waNumber, setWaNumber] = useState("");
  const [waType, setWaType] = useState<"invoice_pdf" | "order_confirmation">("invoice_pdf");
  const [waSending, setWaSending] = useState(false);

  const openWaDialog = () => {
    // Pre-fill with customer WhatsApp number if available
    if (invoice?.customerId) {
      fetch(`/api/whatsapp/entity/${invoice.customerId}/number`, { credentials: "include" })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.whatsappNumber) setWaNumber(d.whatsappNumber); })
        .catch(() => {});
    }
    setWaOpen(true);
  };

  const handleSendWa = async () => {
    if (!waNumber || !invoice) return;
    setWaSending(true);
    try {
      const res = await fetch("/api/whatsapp/send/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ invoiceId: id, toNumber: waNumber, messageType: waType }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Send failed");
      toast({ title: "WhatsApp sent ✓", description: `Message sent to ${waNumber}` });
      setWaOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to send", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const noPayTypes = new Set(["quotation", "proforma_invoice", "sale_order", "delivery_challan"]);
  const invPayStatus = invoice ? (() => {
    if (invoice.status === "cancelled") return "cancelled";
    if (noPayTypes.has(invoice.invoiceType)) return "na";
    const paid = Number(invoice.amountPaid ?? 0);
    const due = Number(invoice.balanceDue ?? 0);
    const total = Number(invoice.grandTotal ?? 0);
    if (total > 0 && due <= 0) return "paid";
    if (paid > 0) return "partial";
    return "not_paid";
  })() : "na";

  const [payAmount, setPayAmount] = useState(0);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payAccountId, setPayAccountId] = useState<number | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);
  const [paySuccessReceipt, setPaySuccessReceipt] = useState<string | null>(null);
  const [payAccountError, setPayAccountError] = useState(false);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);

  const matchingAccounts = (accounts ?? []).filter(
    (a) => a.isActive && accountTypeForMode[payMode] && a.type === accountTypeForMode[payMode],
  );

  useEffect(() => {
    if (!matchingAccounts.length) { setPayAccountId(null); return; }
    if (!payAccountId || !matchingAccounts.some((a) => a.id === payAccountId)) {
      setPayAccountId(matchingAccounts[0].id);
    }
  }, [payMode, accounts]);

  // Fetch receipt series config when dialog opens to show preview
  useEffect(() => {
    if (!payDialogOpen) return;
    fetch("/api/number-series", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        const recSeries = data.find((s: any) => s.seriesType === "payment_receipt");
        if (recSeries?.formatString) {
          setReceiptPreview(computeReceiptPreview(recSeries.formatString, recSeries.nextNumber));
        }
      })
      .catch(() => {});
  }, [payDialogOpen]);

  const openPayDialog = () => {
    setPayAmount(Number(invoice?.balanceDue ?? invoice?.grandTotal ?? 0));
    setPayMode("cash");
    setPayRef("");
    setPayNotes("");
    setPaySuccess(false);
    setPaySuccessReceipt(null);
    setPayAccountError(false);
    setReceiptPreview(null);
    setPayDialogOpen(true);
  };

  const handleRecordPayment = () => {
    // Account is required when matching accounts exist
    if (matchingAccounts.length > 0 && !payAccountId) {
      setPayAccountError(true);
      return;
    }
    setPayAccountError(false);

    logPayment.mutate(
      {
        data: {
          ...(invoice?.customerId ? { customerId: invoice.customerId } : {}),
          ...(id ? { invoiceId: id } : {}),
          amount: payAmount,
          mode: payMode,
          ...(payAccountId ? { accountId: payAccountId } : {}),
          notes: [
            `Invoice ${invoice?.invoiceNo ?? ""}`,
            payRef ? `Ref: ${payRef}` : "",
            payNotes,
          ].filter(Boolean).join(" | ") || undefined,
        },
      },
      {
        onSuccess: (payment) => {
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(id!) });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          setPaySuccess(true);
          setPaySuccessReceipt(payment.receiptId ?? null);
          toast({
            title: payment.status === "approved" ? "Payment recorded" : "Payment logged — pending approval",
            description: `Receipt ${payment.receiptId} • ₹${payAmount.toLocaleString()} via ${modeLabels[payMode]}`,
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
      }
    );
  };

  const lpbByProduct = new Map<number, number>(
    (products ?? []).map((p: any) => [p.id, Number(p.litersPerBox ?? 0) || 0]),
  );
  const upbByProduct = new Map<number, number>(
    (products ?? []).map((p: any) => [p.id, Number(p.unitsPerBox ?? 0) || 0]),
  );
  const maps = { lpbByProduct, upbByProduct };

  if (isLoading || (!error && !invoice) || settingsLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !invoice) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">Invoice not found or you do not have access to view it.</p>
            <Button variant="outline" onClick={() => setLocation("/invoices")}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back to invoices
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isGst = invoice.invoiceType === "gst";
  const isAdmin = user?.role === "admin";
  const activeTemplate = templateOverride ?? settings.defaultTemplate ?? "a5-compact";
  const activeMeta = getTemplate(activeTemplate);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto print:p-0 print:max-w-none print:m-0">
      {/* Top toolbar */}
      <div className="flex items-center justify-between print:hidden no-print">
        <Button variant="outline" onClick={() => setLocation("/invoices")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />Back to invoices
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={isGst ? "default" : "secondary"}>{isGst ? "GST" : "Non-GST"}</Badge>
          {invPayStatus === "paid" && <Badge className="bg-green-600 text-white hover:bg-green-700">Paid</Badge>}
          {invPayStatus === "partial" && <Badge className="bg-amber-500 text-white hover:bg-amber-600">Partially Paid</Badge>}
          {invPayStatus === "not_paid" && <Badge variant="destructive">Not Paid</Badge>}
          {invPayStatus === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
          {invPayStatus === "na" && <Badge variant="secondary">{invoice.status}</Badge>}
          <Button variant="outline" onClick={() => setSelectorOpen(true)} data-testid="button-choose-template">
            <LayoutTemplate className="h-4 w-4 mr-2" />
            {activeMeta?.name ?? "Choose Template"}
          </Button>
          {invoice.status !== "cancelled" && invPayStatus !== "paid" && Number(invoice.balanceDue) > 0 && (
            <Button onClick={openPayDialog} data-testid="button-record-payment">
              <IndianRupee className="h-4 w-4 mr-2" />Record Payment
            </Button>
          )}
          <Button
            variant="outline"
            onClick={openWaDialog}
            className="border-green-400 text-green-700 hover:bg-green-50"
            data-testid="button-whatsapp-send"
          >
            <MessageCircle className="h-4 w-4 mr-2" />WhatsApp
          </Button>
          <Button variant="outline" onClick={() => window.print()} data-testid="button-print">
            <Printer className="h-4 w-4 mr-2" />Print
          </Button>
        </div>
      </div>

      <InvoiceTemplateRenderer
        invoice={invoice}
        settings={settings}
        maps={maps}
        templateId={activeTemplate}
      />

      <InvoiceTemplateSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        invoice={invoice}
        maps={maps}
        settings={settings}
        value={activeTemplate}
        onSelect={setTemplateOverride}
      />

      {/* Record Payment Dialog */}
      <Dialog open={payDialogOpen} onOpenChange={(o) => { if (!logPayment.isPending) setPayDialogOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IndianRupee className="w-5 h-5 text-primary" />
              Record Payment — {invoice.invoiceNo}
            </DialogTitle>
          </DialogHeader>

          {paySuccess ? (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-lg">Payment Recorded</p>
              {paySuccessReceipt && (
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                  <Hash className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono text-sm font-medium">{paySuccessReceipt}</span>
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                ₹{payAmount.toLocaleString()} via {modeLabels[payMode]}
              </p>
              {user?.role !== "admin" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Pending admin approval before the ledger is updated.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {/* Receipt number preview */}
              <div className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-2">
                <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <span className="text-xs text-muted-foreground">Receipt No. (auto-generated)</span>
                  <p className="font-mono text-sm font-medium">
                    {receiptPreview ?? <span className="text-muted-foreground italic">Loading…</span>}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">Amount Received (₹)</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min={0}
                  max={Number(invoice.balanceDue)}
                  step="any"
                  value={payAmount}
                  onChange={(e) => setPayAmount(Math.min(Number(e.target.value), Number(invoice.balanceDue)))}
                  data-testid="input-pay-amount"
                />
                <p className="text-xs text-muted-foreground">
                  Balance due: ₹{Number(invoice.balanceDue).toLocaleString()} of ₹{Number(invoice.grandTotal).toLocaleString()}
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  For advance / extra payments, use the Customer Portal.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["cash", "upi", "cheque", "bank_transfer", "other"] as PayMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setPayMode(m); setPayAccountError(false); }}
                      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                        payMode === m
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
                    value={payAccountId ? String(payAccountId) : ""}
                    onValueChange={(v) => { setPayAccountId(v ? Number(v) : null); setPayAccountError(false); }}
                  >
                    <SelectTrigger className={payAccountError ? "border-destructive" : ""}>
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
                  {payAccountError && (
                    <p className="text-xs text-destructive">Please select an account to deposit the payment.</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Reference / Cheque No. <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id="pay-ref"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  placeholder="UPI txn ID, cheque number…"
                  data-testid="input-pay-ref"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="pay-notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Textarea
                  id="pay-notes"
                  rows={2}
                  value={payNotes}
                  onChange={(e) => setPayNotes(e.target.value)}
                  placeholder="Any remarks…"
                  data-testid="input-pay-notes"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            {paySuccess ? (
              <Button onClick={() => setPayDialogOpen(false)}>Done</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setPayDialogOpen(false)} disabled={logPayment.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleRecordPayment}
                  disabled={logPayment.isPending || payAmount <= 0}
                  data-testid="button-submit-payment"
                >
                  {logPayment.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Record ₹{payAmount.toLocaleString()} {modeLabels[payMode]}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WhatsApp Send Dialog */}
      <Dialog open={waOpen} onOpenChange={(v) => { if (!v) setWaOpen(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-green-500" /> Send on WhatsApp
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Message Type</Label>
              <Select value={waType} onValueChange={(v) => setWaType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="invoice_pdf">Invoice Notification</SelectItem>
                  <SelectItem value="order_confirmation">Order Confirmation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp Number</Label>
              <Input
                placeholder="10-digit mobile number"
                inputMode="numeric"
                maxLength={10}
                value={waNumber}
                onChange={(e) => setWaNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              />
              <p className="text-xs text-muted-foreground">Message will be sent to this number via WhatsApp</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWaOpen(false)} disabled={waSending}>Cancel</Button>
            <Button
              onClick={handleSendWa}
              disabled={waSending || waNumber.length !== 10}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {waSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}
              Send Message
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
