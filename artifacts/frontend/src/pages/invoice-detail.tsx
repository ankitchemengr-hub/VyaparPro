import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  useListProducts,
  useGetPrintSettings,
} from "@workspace/api-client-react";
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
import { ArrowLeft, Printer, Loader2, LayoutTemplate, IndianRupee, MessageCircle, Share2 } from "lucide-react";
import { shareInvoiceImage } from "@/lib/share-invoice";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { InvoiceTemplateRenderer } from "@/components/invoice-templates/InvoiceTemplateRenderer";
import { InvoiceTemplateSelector } from "@/components/invoice-templates/InvoiceTemplateSelector";
import { getTemplate } from "@/components/invoice-templates/registry";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";

export default function InvoiceDetail() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const id = Number(params?.id);

  const { data: invoice, isLoading, error } = useGetInvoice(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetInvoiceQueryKey(id) },
  });
  const { data: products } = useListProducts({});
  const { data: settingsData, isLoading: settingsLoading } = useGetPrintSettings();
  const logo = useCompanyLogo();
  const settings = { ...(settingsData ?? FALLBACK_PRINT_SETTINGS), logo };

  const [templateOverride, setTemplateOverride] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sheetContainerRef = useRef<HTMLDivElement>(null);

  const handleShareInvoice = async () => {
    if (!invoice) return;
    const sheetEl = sheetContainerRef.current?.querySelector(".invoice-sheet") as HTMLElement | null;
    if (!sheetEl) {
      toast({ title: "Could not find invoice to share", variant: "destructive" });
      return;
    }
    setSharing(true);
    try {
      const result = await shareInvoiceImage(sheetEl, {
        fileName: `Invoice-${String(invoice.invoiceNo).replace(/\//g, "-")}.png`,
        title: `Invoice ${invoice.invoiceNo}`,
        text: `Invoice ${invoice.invoiceNo} — ₹${Number(invoice.grandTotal).toLocaleString()}`,
      });
      if (result === "downloaded") {
        toast({ title: "Image downloaded", description: "Your browser doesn't support direct sharing — attach the downloaded image in WhatsApp manually." });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: "Could not share invoice", description: err?.message ?? "Unknown error", variant: "destructive" });
      }
    } finally {
      setSharing(false);
    }
  };

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

  const openPayDialog = () => setPayDialogOpen(true);

  const lpbByProduct = new Map<number, number>(
    (products ?? []).map((p: any) => [p.id, Number(p.litersPerBox ?? 0) || 0]),
  );
  const upbByProduct = new Map<number, number>(
    (products ?? []).map((p: any) => [p.id, Number(p.unitsPerBox ?? 0) || 0]),
  );
  const maps = { lpbByProduct, upbByProduct };

  // Print settings gate the printable sheet only, not the whole page — `settings`
  // already has a safe fallback (FALLBACK_PRINT_SETTINGS) above, so there's no
  // need to hold the entire invoice view hostage to that extra network round-trip.
  if (isLoading || (!error && !invoice)) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // Only bail to "not found" when there's genuinely no data — React Query
  // keeps the last successful `invoice` around even if a later background
  // refetch fails (e.g. a transient blip on window refocus). Treating any
  // `error` as fatal here discarded perfectly good, already-loaded data and
  // flashed the invoice away seconds after it had rendered fine.
  if (!invoice) {
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
  const activeTemplate = templateOverride ?? settings.defaultTemplate ?? "minimal-a5";
  const activeMeta = getTemplate(activeTemplate);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto print:p-0 print:max-w-none print:m-0">
      {/* Top toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden no-print">
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setLocation("/invoices")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Back to invoices</span>
          </Button>
          <Badge variant={isGst ? "default" : "secondary"}>{isGst ? "GST" : "Non-GST"}</Badge>
          {invPayStatus === "paid" && <Badge className="bg-green-600 text-white hover:bg-green-700">Paid</Badge>}
          {invPayStatus === "partial" && <Badge className="bg-amber-500 text-white hover:bg-amber-600">Partially Paid</Badge>}
          {invPayStatus === "not_paid" && <Badge variant="destructive">Not Paid</Badge>}
          {invPayStatus === "cancelled" && <Badge variant="destructive">Cancelled</Badge>}
          {invPayStatus === "na" && <Badge variant="secondary">{invoice.status}</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setSelectorOpen(true)} data-testid="button-choose-template">
            <LayoutTemplate className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">{activeMeta?.name ?? "Choose Template"}</span>
          </Button>
          {invoice.status !== "cancelled" && invPayStatus !== "paid" && Number(invoice.balanceDue) > 0 && (
            <Button size="sm" onClick={openPayDialog} data-testid="button-record-payment">
              <IndianRupee className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Record Payment</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleShareInvoice}
            disabled={sharing}
            className="border-green-400 text-green-700 hover:bg-green-50"
            data-testid="button-share-invoice"
          >
            {sharing ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" /> : <Share2 className="h-4 w-4 sm:mr-2" />}
            <span className="hidden sm:inline">Share</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openWaDialog}
            className="border-green-400 text-green-700 hover:bg-green-50"
            data-testid="button-whatsapp-send"
          >
            <MessageCircle className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">WhatsApp</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={settingsLoading}
            data-testid="button-print"
          >
            {settingsLoading
              ? <Loader2 className="h-4 w-4 sm:mr-2 animate-spin" />
              : <Printer className="h-4 w-4 sm:mr-2" />}
            <span className="hidden sm:inline">Print</span>
          </Button>
        </div>
      </div>

      {settingsLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div ref={sheetContainerRef}>
          <InvoiceTemplateRenderer
            invoice={invoice}
            settings={settings}
            maps={maps}
            templateId={activeTemplate}
          />
        </div>
      )}

      <InvoiceTemplateSelector
        open={selectorOpen}
        onOpenChange={setSelectorOpen}
        invoice={invoice}
        maps={maps}
        settings={settings}
        value={activeTemplate}
        onSelect={setTemplateOverride}
      />

      <RecordPaymentDialog
        open={payDialogOpen}
        onOpenChange={setPayDialogOpen}
        entityId={invoice.customerId}
        entityName={invoice.customerName}
        invoiceId={id}
        invoiceNo={invoice.invoiceNo}
        maxAmount={Number(invoice.balanceDue)}
        totalAmount={Number(invoice.grandTotal)}
      />

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
