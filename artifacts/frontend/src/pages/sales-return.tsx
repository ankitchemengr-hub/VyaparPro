import { useEffect, useState } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListInvoices,
  useGetInvoiceReturnableItems,
  useListSalesReturns,
  useGetSalesReturn,
  useCreateSalesReturn,
  getListSalesReturnsQueryKey,
  getListInvoicesQueryKey,
  getGetInvoiceReturnableItemsQueryKey,
  getGetSalesReturnQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Search, Undo2, Loader2, CheckCircle2, Hash, Printer, PackageX,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import { rupeesInWords } from "@/components/invoice-templates/helpers";

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const TYPE_LABELS: Record<string, string> = {
  gst: "GST",
  non_gst: "Non-GST",
  proforma_invoice: "Proforma",
  bill_of_supply: "Bill of Supply",
  delivery_challan: "Delivery Challan",
  sale_order: "Sale Order",
};

export default function SalesReturn() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState("new");

  if (!hasRole(["admin", "salesman", "accountant", "store"])) return <Redirect to="/" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Sales Return</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Search a bill, pick what's coming back, and credit the customer.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="new" data-testid="tab-new-return">New Return</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-return-history">Return History</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-4">
          <NewReturnTab />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <ReturnHistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------- NEW RETURN ----------------------------

function NewReturnTab() {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const trimmed = debounced.trim();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);

  const { data: invoices, isFetching } = useListInvoices(
    { search: trimmed },
    { query: { enabled: trimmed.length >= 2, queryKey: getListInvoicesQueryKey({ search: trimmed }) } },
  );

  const results = (invoices ?? []).filter((inv) => (inv.invoiceType as string) !== "quotation");

  return (
    <div className="space-y-4">
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search invoice no. or customer name..."
          className="pl-9"
          data-testid="input-search-return-invoice"
        />
      </div>

      {trimmed.length < 2 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Type at least 2 characters to search for a bill.
        </p>
      ) : isFetching ? (
        <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No matching bill found.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((inv) => (
            <button
              key={inv.id}
              type="button"
              onClick={() => setSelectedInvoiceId(inv.id)}
              className="text-left p-3 border rounded-lg hover:border-primary hover:bg-accent/50 transition-colors"
              data-testid={`option-return-invoice-${inv.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-sm truncate">{inv.invoiceNo}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {TYPE_LABELS[inv.invoiceType] ?? inv.invoiceType}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2 text-sm mt-1">
                <span className="truncate text-muted-foreground">{inv.customerName || "Cash Sale"}</span>
                <span className="font-medium shrink-0">₹{inv.grandTotal.toLocaleString()}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(inv.invoiceDate), "MMM dd, yyyy")}
              </div>
            </button>
          ))}
        </div>
      )}

      <ReturnItemsDialog
        invoiceId={selectedInvoiceId}
        onOpenChange={(o) => !o && setSelectedInvoiceId(null)}
      />
    </div>
  );
}

function ReturnItemsDialog({
  invoiceId, onOpenChange,
}: {
  invoiceId: number | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = invoiceId != null;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const logo = useCompanyLogo();
  const createReturn = useCreateSalesReturn();

  const { data: invoice, isLoading } = useGetInvoiceReturnableItems(invoiceId ?? 0, {
    query: { enabled: open, queryKey: getGetInvoiceReturnableItemsQueryKey(invoiceId ?? 0) },
  });

  const [qtyByItem, setQtyByItem] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [success, setSuccess] = useState<{ returnNo: string; grandTotal: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setQtyByItem({});
    setReason("");
    setSuccess(null);
  }, [open, invoiceId]);

  const lineFor = (item: NonNullable<typeof invoice>["items"][number]) => {
    const returnQty = Number(qtyByItem[item.invoiceItemId] || 0);
    const unitAmount = item.qty > 0 ? item.originalAmount / item.qty : 0;
    const lineAmount = Math.round(unitAmount * returnQty * 100) / 100;
    const lineTaxable = Math.round((lineAmount / (1 + item.taxPct / 100)) * 100) / 100;
    const lineTax = Math.round((lineAmount - lineTaxable) * 100) / 100;
    return { returnQty, lineAmount, lineTaxable, lineTax };
  };

  const grandTotal = (invoice?.items ?? []).reduce((sum, item) => sum + lineFor(item).lineAmount, 0);
  const hasAnyQty = (invoice?.items ?? []).some((item) => lineFor(item).returnQty > 0);

  const handleSubmit = () => {
    if (!invoice) return;
    const items = (invoice.items ?? [])
      .map((item) => ({ item, ...lineFor(item) }))
      .filter((l) => l.returnQty > 0)
      .map((l) => ({ invoiceItemId: l.item.invoiceItemId, productId: l.item.productId, qty: l.returnQty }));

    createReturn.mutate(
      { data: { invoiceId: invoice.invoiceId, reason: reason.trim() || undefined, items } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListSalesReturnsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          setSuccess({ returnNo: created.returnNo, grandTotal: created.grandTotal });
          toast({ title: "Sales return recorded", description: `${created.returnNo} • ₹${created.grandTotal.toLocaleString()} credited` });
        },
        onError: async (err: any) => {
          let desc = err?.message ?? "Server error";
          try {
            const body = err?.response ? await err.response.json() : null;
            if (body?.error) desc = String(body.error).slice(0, 300);
          } catch {}
          toast({ title: "Failed to record return", description: desc, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!createReturn.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-primary" />
            {invoice ? `Return — ${invoice.invoiceNo}` : "Sales Return"}
          </DialogTitle>
          {!success && invoice && (
            <DialogDescription>{invoice.customerName || "Cash Sale"}</DialogDescription>
          )}
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center print:hidden"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : success ? (
          <>
            <div className="py-6 flex flex-col items-center gap-3 text-center print:hidden">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="font-semibold text-lg">Return Recorded</p>
              <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                <Hash className="w-4 h-4 text-muted-foreground" />
                <span className="font-mono text-sm font-medium">{success.returnNo}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                ₹{success.grandTotal.toLocaleString()} credited to customer ledger, stock updated.
              </p>
            </div>

            {/* Printable slip — hidden on screen, shown only for print/PDF */}
            <div className="hidden print:block p-6 text-sm">
              <div className="flex items-center gap-3 mb-4">
                {logo && <img src={logo} alt="" className="h-10 w-10 object-contain" />}
                <div>
                  <div className="font-bold text-lg">Sales Return</div>
                  <div className="text-xs text-muted-foreground">Credit Note</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div><span className="text-muted-foreground">Return No: </span>{success.returnNo}</div>
                <div><span className="text-muted-foreground">Date: </span>{new Date().toLocaleDateString("en-IN")}</div>
                <div><span className="text-muted-foreground">Customer: </span>{invoice?.customerName ?? "—"}</div>
                <div><span className="text-muted-foreground">Against Invoice: </span>{invoice?.invoiceNo}</div>
              </div>
              <div className="border-t border-b py-3 my-3">
                <div className="flex justify-between font-bold text-base">
                  <span>Amount Credited</span>
                  <span>₹{success.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{rupeesInWords(success.grandTotal)}</div>
              </div>
            </div>
          </>
        ) : invoice && invoice.items.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground print:hidden">
            <PackageX className="w-10 h-10 mx-auto mb-2 opacity-40" />
            No line items on this invoice.
          </div>
        ) : invoice ? (
          <div className="flex-1 overflow-y-auto space-y-3 py-2 print:hidden">
            {invoice.items.map((item) => {
              const { returnQty, lineAmount } = lineFor(item);
              const disabled = item.returnableQty <= 0;
              return (
                <div key={item.invoiceItemId} className={`p-3 border rounded-lg space-y-2 ${disabled ? "opacity-50" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{item.productName}</span>
                    <span className="text-sm font-medium shrink-0">₹{lineAmount.toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Sold {item.qty} {item.unit}
                    {item.alreadyReturnedQty > 0 && ` · Already returned ${item.alreadyReturnedQty}`}
                    {" · "}Returnable {item.returnableQty} {item.unit}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs shrink-0">Return Qty</Label>
                    <Input
                      type="number"
                      min={0}
                      max={item.returnableQty}
                      step="any"
                      value={qtyByItem[item.invoiceItemId] ?? ""}
                      disabled={disabled}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(Number(e.target.value) || 0, item.returnableQty));
                        setQtyByItem((prev) => ({ ...prev, [item.invoiceItemId]: v ? String(v) : "" }));
                      }}
                      className="h-8 text-sm max-w-[120px]"
                      data-testid={`input-return-qty-${item.invoiceItemId}`}
                    />
                  </div>
                </div>
              );
            })}

            <div className="space-y-1.5">
              <Label htmlFor="return-reason" className="text-xs">Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="return-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Damaged, wrong item, etc."
                data-testid="input-return-reason"
              />
            </div>
          </div>
        ) : null}

        <DialogFooter className="print:hidden">
          {success ? (
            <>
              <Button variant="outline" onClick={() => window.print()} data-testid="button-print-return">
                <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : invoice ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createReturn.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createReturn.isPending || !hasAnyQty}
                data-testid="button-submit-return"
              >
                {createReturn.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Return ₹{grandTotal.toFixed(2)}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------- RETURN HISTORY ----------------------------

function ReturnHistoryTab() {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: returns, isLoading } = useListSalesReturns({ search: debounced.trim() || undefined });

  return (
    <div className="space-y-4">
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search return no., invoice no. or customer..."
          className="pl-9"
          data-testid="input-search-return-history"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : !returns || returns.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Undo2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
            No sales returns yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {returns.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className="text-left p-3 border rounded-lg hover:border-primary hover:bg-accent/50 transition-colors"
              data-testid={`row-sales-return-${r.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold text-sm truncate">{r.returnNo}</span>
                <span className="font-medium text-sm shrink-0">₹{r.grandTotal.toLocaleString()}</span>
              </div>
              <div className="text-sm text-muted-foreground truncate mt-1">
                {r.customerName || "Cash Sale"} · Inv {r.invoiceNo}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {format(new Date(r.returnDate), "MMM dd, yyyy")}
              </div>
            </button>
          ))}
        </div>
      )}

      <ReturnDetailDialog id={selectedId} onOpenChange={(o) => !o && setSelectedId(null)} />
    </div>
  );
}

function ReturnDetailDialog({ id, onOpenChange }: { id: number | null; onOpenChange: (open: boolean) => void }) {
  const open = id != null;
  const { data: ret, isLoading } = useGetSalesReturn(id ?? 0, { query: { enabled: open, queryKey: getGetSalesReturnQueryKey(id ?? 0) } });
  const logo = useCompanyLogo();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-primary" />
            {ret ? ret.returnNo : "Sales Return"}
          </DialogTitle>
          {ret && <DialogDescription>{ret.customerName || "Cash Sale"} · Against Invoice {ret.invoiceNo}</DialogDescription>}
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 text-center print:hidden"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : ret ? (
          <>
            <div className="flex-1 overflow-y-auto space-y-2 py-2 print:hidden">
              {(ret.items ?? []).map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 p-2 border rounded-md text-sm">
                  <span className="truncate">{it.productName} <span className="text-muted-foreground">× {it.qty} {it.unit}</span></span>
                  <span className="font-medium shrink-0">₹{it.amount.toFixed(2)}</span>
                </div>
              ))}
              {ret.reason && (
                <p className="text-xs text-muted-foreground pt-1">Reason: {ret.reason}</p>
              )}
              <div className="flex justify-between font-bold text-base border-t pt-2 mt-2">
                <span>Total Credited</span>
                <span>₹{ret.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {ret.createdByName && (
                <p className="text-xs text-muted-foreground">Created by {ret.createdByName}</p>
              )}
            </div>

            {/* Printable slip */}
            <div className="hidden print:block p-6 text-sm">
              <div className="flex items-center gap-3 mb-4">
                {logo && <img src={logo} alt="" className="h-10 w-10 object-contain" />}
                <div>
                  <div className="font-bold text-lg">Sales Return</div>
                  <div className="text-xs text-muted-foreground">Credit Note</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div><span className="text-muted-foreground">Return No: </span>{ret.returnNo}</div>
                <div><span className="text-muted-foreground">Date: </span>{format(new Date(ret.returnDate), "MMM dd, yyyy")}</div>
                <div><span className="text-muted-foreground">Customer: </span>{ret.customerName ?? "—"}</div>
                <div><span className="text-muted-foreground">Against Invoice: </span>{ret.invoiceNo}</div>
              </div>
              <div className="border-t border-b py-3 my-3">
                <div className="flex justify-between font-bold text-base">
                  <span>Amount Credited</span>
                  <span>₹{ret.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">{rupeesInWords(ret.grandTotal)}</div>
              </div>
            </div>
          </>
        ) : null}

        <DialogFooter className="print:hidden">
          {ret && (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
