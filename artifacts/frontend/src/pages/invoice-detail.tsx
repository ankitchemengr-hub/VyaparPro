import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
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
import { ArrowLeft, Printer, Loader2, LayoutTemplate, IndianRupee, Banknote, Smartphone, CreditCard, Building2, CheckCircle2 } from "lucide-react";
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

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payMode, setPayMode] = useState<PayMode>("cash");
  const [payRef, setPayRef] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payAccountId, setPayAccountId] = useState<number | null>(null);
  const [paySuccess, setPaySuccess] = useState(false);

  const matchingAccounts = (accounts ?? []).filter(
    (a) => a.isActive && accountTypeForMode[payMode] && a.type === accountTypeForMode[payMode],
  );

  useEffect(() => {
    if (!matchingAccounts.length) { setPayAccountId(null); return; }
    if (!payAccountId || !matchingAccounts.some((a) => a.id === payAccountId)) {
      setPayAccountId(matchingAccounts[0].id);
    }
  }, [payMode, accounts]);

  const openPayDialog = () => {
    setPayAmount(Number(invoice?.balanceDue ?? invoice?.grandTotal ?? 0));
    setPayMode("cash");
    setPayRef("");
    setPayNotes("");
    setPaySuccess(false);
    setPayDialogOpen(true);
  };

  const handleRecordPayment = () => {
    logPayment.mutate(
      {
        data: {
          ...(invoice?.customerId ? { customerId: invoice.customerId } : {}),
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
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          setPaySuccess(true);
          toast({
            title: payment.status === "approved" ? "Payment recorded" : "Payment logged — pending approval",
            description: `₹${payAmount.toLocaleString()} via ${modeLabels[payMode]}${payment.status !== "approved" ? " — awaiting admin approval" : ""}`,
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
      {/* Top toolbar (hidden in print) */}
      <div className="flex items-center justify-between print:hidden no-print">
        <Button variant="outline" onClick={() => setLocation("/invoices")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-2" />Back to invoices
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={isGst ? "default" : "secondary"}>{isGst ? "GST" : "Non-GST"}</Badge>
          <Badge
            variant={
              invoice.status === "saved"
                ? "default"
                : invoice.status === "cancelled"
                  ? "destructive"
                  : "secondary"
            }
          >
            {invoice.status}
          </Badge>
          <Button variant="outline" onClick={() => setSelectorOpen(true)} data-testid="button-choose-template">
            <LayoutTemplate className="h-4 w-4 mr-2" />
            {activeMeta.name} ({activeMeta.paper})
          </Button>
          {invoice.status !== "cancelled" && (
            <Button variant="default" onClick={openPayDialog} data-testid="button-record-payment">
              <IndianRupee className="h-4 w-4 mr-2" />
              Record Payment
            </Button>
          )}
          {isAdmin && invoice.status !== "cancelled" && (
            <Button variant="outline" onClick={() => setLocation(`/billing?edit=${invoice.id}`)} data-testid="button-edit">
              Edit
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()} data-testid="button-print">
            <Printer className="h-4 w-4 mr-2" />Print
          </Button>
        </div>
      </div>

      {/* Invoice sheet — rendered by the selected template */}
      <div className="mx-auto w-full overflow-x-auto rounded-md border bg-white p-4 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <InvoiceTemplateRenderer
          invoice={invoice}
          maps={maps}
          settings={settings}
          templateId={activeTemplate}
        />
      </div>

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
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">Amount Received (₹)</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min={0}
                  step="any"
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  data-testid="input-pay-amount"
                />
                <p className="text-xs text-muted-foreground">
                  Invoice total: ₹{Number(invoice.grandTotal).toLocaleString()}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["cash", "upi", "cheque", "bank_transfer", "other"] as PayMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPayMode(m)}
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
                  <Label>Deposit to Account</Label>
                  <Select
                    value={payAccountId ? String(payAccountId) : ""}
                    onValueChange={(v) => setPayAccountId(v ? Number(v) : null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select account" />
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
    </div>
  );
}
