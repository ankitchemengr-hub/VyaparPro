import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetInvoice,
  getGetInvoiceQueryKey,
  useListProducts,
  useGetPrintSettings,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Printer, Loader2, LayoutTemplate } from "lucide-react";
import { useAuth } from "@/contexts/use-auth";
import { InvoiceTemplateRenderer } from "@/components/invoice-templates/InvoiceTemplateRenderer";
import { InvoiceTemplateSelector } from "@/components/invoice-templates/InvoiceTemplateSelector";
import { getTemplate } from "@/components/invoice-templates/registry";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";

export default function InvoiceDetail() {
  const [, params] = useRoute("/invoices/:id");
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const id = Number(params?.id);

  const { data: invoice, isLoading, error } = useGetInvoice(id, {
    query: { enabled: Number.isFinite(id), queryKey: getGetInvoiceQueryKey(id) },
  });
  // Products catalog — used to back-fill litersPerBox / unitsPerBox for invoices
  // that didn't store derived totals at create time.
  const { data: products } = useListProducts({});
  const {
    data: settingsData,
    isLoading: settingsLoading,
  } = useGetPrintSettings();
  // Never block the sheet on print-settings failure — fall back to safe defaults
  // so the invoice still renders (and prints) instead of spinning forever.
  const settings = settingsData ?? FALLBACK_PRINT_SETTINGS;

  const [templateOverride, setTemplateOverride] = useState<string | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);

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
          {isAdmin && invoice.status !== "cancelled" && (
            <Button variant="outline" onClick={() => setLocation(`/billing?edit=${invoice.id}`)} data-testid="button-edit">
              Edit
            </Button>
          )}
          <Button onClick={() => window.print()} data-testid="button-print">
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
    </div>
  );
}
