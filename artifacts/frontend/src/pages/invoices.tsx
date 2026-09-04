import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import {
  useListInvoices,
  useDeleteInvoice,
  useListUsers,
  getListInvoicesQueryKey,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";
import { InvoiceReceiptDialog } from "@/components/invoice-receipt-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, startOfDay, subDays } from "date-fns";
import { Pencil, Trash2, Loader2, UserCircle2, Eye, CalendarIcon, X, IndianRupee, Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

type InvoiceFilters = {
  search: string;
  type: string;
  payStatus: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  createdByUserId: string;
};
// Persists filters across mount/unmount of this component (e.g. viewing an
// invoice and navigating back) for the lifetime of the page session.
const filterStore = new Map<string, InvoiceFilters>();

const TYPE_LABELS: Record<string, string> = {
  gst: "GST",
  non_gst: "Non-GST",
  quotation: "Quotation",
  proforma_invoice: "Proforma",
  bill_of_supply: "Bill of Supply",
  delivery_challan: "Delivery Challan",
  sale_order: "Sale Order",
};

export default function Invoices({ initialType = "all", pageTitle }: { initialType?: string; pageTitle?: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  // Filters live in a module-level store keyed by page, not just component
  // state, so navigating to an invoice's detail page and back (which
  // unmounts/remounts this component) keeps whatever the user picked —
  // filters should only reset when "Clear filters" is clicked.
  const storeKey = pageTitle ?? "invoices";
  const saved = filterStore.get(storeKey);
  const [search, setSearch] = useState(saved?.search ?? "");
  const [type, setType] = useState<string>(saved?.type ?? initialType);
  const [payStatus, setPayStatus] = useState<string>(saved?.payStatus ?? "all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>(saved?.dateFrom);
  const [dateTo, setDateTo] = useState<Date | undefined>(saved?.dateTo);
  const [createdByUserId, setCreatedByUserId] = useState<string>(saved?.createdByUserId ?? "all");
  const [deleting, setDeleting] = useState<{ id: number; invoiceNo: string; invoiceType: string } | null>(null);

  useEffect(() => {
    filterStore.set(storeKey, { search, type, payStatus, dateFrom, dateTo, createdByUserId });
  }, [storeKey, search, type, payStatus, dateFrom, dateTo, createdByUserId]);

  const isSalesman = user?.role === "salesman";
  const isAdmin = user?.role === "admin";
  const isStore = user?.role === "store";

  const { data: staffUsers } = useListUsers({ query: { enabled: isAdmin, queryKey: getListUsersQueryKey() } });

  const applyPreset = (preset: "today" | "7d" | "30d" | "mtd") => {
    const today = startOfDay(new Date());
    if (preset === "today") { setDateFrom(today); setDateTo(today); }
    else if (preset === "7d") { setDateFrom(subDays(today, 6)); setDateTo(today); }
    else if (preset === "30d") { setDateFrom(subDays(today, 29)); setDateTo(today); }
    else if (preset === "mtd") { setDateFrom(startOfMonth(today)); setDateTo(today); }
  };

  const clearFilters = () => {
    setSearch(""); setType("all"); setPayStatus("all");
    setDateFrom(undefined); setDateTo(undefined); setCreatedByUserId("all");
  };

  const hasFilters = !!search || type !== "all" || payStatus !== "all" || !!dateFrom || !!dateTo || createdByUserId !== "all";

  // Salesman scoping is enforced server-side from their session entity — no need
  // (and incorrect) to send user.id here, which is the user-account id, not the
  // entity id referenced by invoices.salesman_id.
  const { data: invoices, isLoading } = useListInvoices({
    search: search || undefined,
    type: type !== "all" ? (type as any) : undefined,
    status: payStatus === "cancelled" ? "cancelled" : undefined,
    dateFrom: dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined,
    dateTo: dateTo ? format(dateTo, "yyyy-MM-dd") : undefined,
    createdByUserId: createdByUserId !== "all" ? Number(createdByUserId) : undefined,
  });

  const deleteInvoice = useDeleteInvoice();

  const [payingInvoice, setPayingInvoice] = useState<{
    id: number; invoiceNo: string; customerId: number | null; balanceDue: number; grandTotal: number; customerName: string | null;
  } | null>(null);
  const [viewingReceiptInvoiceId, setViewingReceiptInvoiceId] = useState<number | null>(null);

  const noPayTypes = new Set(["quotation", "proforma_invoice", "sale_order", "delivery_challan"]);
  const getPayStatus = (inv: any): string => {
    if (inv.status === "cancelled") return "cancelled";
    if (noPayTypes.has(inv.invoiceType)) return "na";
    const paid = Number(inv.amountPaid ?? 0);
    const due = Number(inv.balanceDue ?? 0);
    const total = Number(inv.grandTotal ?? 0);
    if (total > 0 && due <= 0) return "paid";
    if (paid > 0) return "partial";
    return "not_paid";
  };
  const displayedInvoices = (invoices ?? []).filter((inv) => {
    if (payStatus === "all" || payStatus === "cancelled") return true;
    return getPayStatus(inv) === payStatus;
  });

  const handleConfirmDelete = () => {
    if (!deleting) return;
    deleteInvoice.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          toast({
            title: "Moved to Recycle Bin",
            description: `${deleting.invoiceNo} removed from the list. Inventory was not changed; permanently delete it from the Recycle Bin if needed.`,
          });
          setDeleting(null);
        },
        onError: async (err: any) => {
          let msg = err?.message ?? "Delete failed";
          try { const j = await err?.response?.json?.(); if (j?.error) msg = String(j.error).slice(0, 300); } catch {}
          toast({ title: "Delete failed", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{pageTitle ?? "Invoices"}</h1>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Search invoice number, customer, or item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0"
              data-testid="input-invoice-search"
            />

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="relative shrink-0" data-testid="button-open-filters">
                  <Filter className="h-4 w-4" />
                  {hasFilters && (
                    <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-4" align="end">
                <div className="space-y-1.5">
                  <Label className="text-xs">Invoice Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="w-full" data-testid="select-invoice-type">
                      <SelectValue placeholder="Invoice Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="gst">GST</SelectItem>
                      <SelectItem value="non_gst">Non-GST</SelectItem>
                      <SelectItem value="quotation">Quotation</SelectItem>
                      <SelectItem value="proforma_invoice">Proforma Invoice</SelectItem>
                      <SelectItem value="bill_of_supply">Bill of Supply</SelectItem>
                      <SelectItem value="delivery_challan">Delivery Challan</SelectItem>
                      <SelectItem value="sale_order">Sale Order</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Status</Label>
                  <Select value={payStatus} onValueChange={setPayStatus}>
                    <SelectTrigger className="w-full" data-testid="select-invoice-status">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="not_paid">Not Paid</SelectItem>
                      <SelectItem value="partial">Partially Paid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {isAdmin && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Created By</Label>
                    <Select value={createdByUserId} onValueChange={setCreatedByUserId}>
                      <SelectTrigger className="w-full" data-testid="select-created-by">
                        <SelectValue placeholder="Anyone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Anyone</SelectItem>
                        {(staffUsers ?? []).map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Date Range</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn("justify-start font-normal", !dateFrom && "text-muted-foreground")}
                          data-testid="button-date-from"
                        >
                          <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
                          <span className="truncate">{dateFrom ? format(dateFrom, "dd MMM yy") : "From"}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus />
                      </PopoverContent>
                    </Popover>

                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn("justify-start font-normal", !dateTo && "text-muted-foreground")}
                          data-testid="button-date-to"
                        >
                          <CalendarIcon className="h-4 w-4 mr-2 shrink-0" />
                          <span className="truncate">{dateTo ? format(dateTo, "dd MMM yy") : "To"}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={dateTo}
                          onSelect={setDateTo}
                          disabled={(d) => (dateFrom ? d < dateFrom : false)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("today")} data-testid="preset-today">Today</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("7d")} data-testid="preset-7d">Last 7 days</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("30d")} data-testid="preset-30d">Last 30 days</Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => applyPreset("mtd")} data-testid="preset-mtd">This month</Button>
                  </div>
                </div>

                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={clearFilters}
                    data-testid="button-clear-filters"
                  >
                    <X className="h-4 w-4 mr-1" />Clear filters
                  </Button>
                )}
              </PopoverContent>
            </Popover>

            <span className="shrink-0 text-sm text-muted-foreground" data-testid="text-result-count">
              {isLoading ? "Loading…" : `${displayedInvoices.length} invoice${displayedInvoices.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice No</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead>Customer</TableHead>
                {isAdmin && <TableHead className="hidden lg:table-cell">Created By</TableHead>}
                {isAdmin && <TableHead className="hidden lg:table-cell">Salesman</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-24 sm:w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 9 : 7} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : displayedInvoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 9 : 7} className="text-center py-8">No invoices found.</TableCell>
                </TableRow>
              ) : (
                displayedInvoices.map((invoice) => {
                  const bySalesman = isAdmin && !!invoice.salesmanName;
                  return (
                  <TableRow
                    key={invoice.id}
                    data-testid={`row-invoice-${invoice.id}`}
                    className={bySalesman ? "bg-amber-50/60 dark:bg-amber-950/20 hover:bg-amber-100/60 dark:hover:bg-amber-950/30 border-l-2 border-l-amber-500" : undefined}
                  >
                    <TableCell className={bySalesman ? "font-mono font-semibold italic text-amber-900 dark:text-amber-200" : "font-medium"}>
                      {invoice.invoiceNo}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{format(new Date(invoice.invoiceDate), "MMM dd, yyyy")}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <Badge variant="outline">{TYPE_LABELS[invoice.invoiceType] ?? invoice.invoiceType}</Badge>
                    </TableCell>
                    <TableCell>{invoice.customerName || "Cash Sale"}</TableCell>
                    {isAdmin && (
                      <TableCell className="hidden lg:table-cell" data-testid={`cell-created-by-${invoice.id}`}>
                        {invoice.createdByName ?? <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    {isAdmin && (
                      <TableCell className="hidden lg:table-cell" data-testid={`cell-salesman-${invoice.id}`}>
                        {invoice.salesmanName ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold italic text-amber-700 dark:text-amber-300">
                            <UserCircle2 className="h-3.5 w-3.5" />
                            {invoice.salesmanName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-bold whitespace-nowrap">₹{invoice.grandTotal.toLocaleString()}</TableCell>
                    <TableCell>
                      {(() => {
                        const ps = getPayStatus(invoice);
                        if (ps === "paid") return <Badge className="bg-green-600 text-white hover:bg-green-700">Paid</Badge>;
                        if (ps === "partial") return <Badge className="bg-amber-500 text-white hover:bg-amber-600">Partial</Badge>;
                        if (ps === "not_paid") return <Badge variant="destructive">Not Paid</Badge>;
                        if (ps === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
                        return <Badge variant="secondary">{invoice.status}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setLocation(`/invoices/${invoice.id}`)}
                          data-testid={`button-view-invoice-${invoice.id}`}
                          aria-label="View invoice"
                          title="View invoice"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {(isAdmin || isSalesman || isStore) && invoice.status !== "cancelled" && (() => {
                          const ps = getPayStatus(invoice);
                          const isPaid = ps === "paid";
                          return (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-8 w-8 ${isPaid ? "text-green-600 hover:text-green-700" : "text-muted-foreground hover:text-green-600"}`}
                              onClick={() => isPaid
                                ? setViewingReceiptInvoiceId(invoice.id)
                                : setPayingInvoice({
                                  id: invoice.id,
                                  invoiceNo: invoice.invoiceNo,
                                  customerId: invoice.customerId ?? null,
                                  balanceDue: Number(invoice.balanceDue),
                                  grandTotal: Number(invoice.grandTotal),
                                  customerName: invoice.customerName ?? null,
                                })}
                              title={isPaid ? "View receipt" : "Record payment"}
                              aria-label={isPaid ? "View receipt" : "Record payment"}
                              data-testid={`button-record-payment-${invoice.id}`}
                            >
                              <IndianRupee className={`h-4 w-4 ${isPaid ? "fill-green-600/20" : ""}`} />
                            </Button>
                          );
                        })()}
                        {isAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={invoice.status === "cancelled"}
                              onClick={() => setLocation(`/billing?edit=${invoice.id}`)}
                              data-testid={`button-edit-invoice-${invoice.id}`}
                              aria-label="Edit invoice"
                              title="Edit invoice — opens full editor"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="hidden sm:inline-flex h-8 w-8 text-destructive hover:text-destructive"
                              disabled={invoice.status === "cancelled"}
                              onClick={() =>
                                setDeleting({
                                  id: invoice.id,
                                  invoiceNo: invoice.invoiceNo,
                                  invoiceType: invoice.invoiceType,
                                })
                              }
                              data-testid={`button-delete-invoice-${invoice.id}`}
                              aria-label="Cancel invoice"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RecordPaymentDialog
        open={!!payingInvoice}
        onOpenChange={(o) => !o && setPayingInvoice(null)}
        entityId={payingInvoice?.customerId}
        entityName={payingInvoice?.customerName}
        invoiceId={payingInvoice?.id}
        invoiceNo={payingInvoice?.invoiceNo}
        maxAmount={payingInvoice?.balanceDue}
        totalAmount={payingInvoice?.grandTotal}
      />

      <InvoiceReceiptDialog
        invoiceId={viewingReceiptInvoiceId}
        onOpenChange={(o) => !o && setViewingReceiptInvoiceId(null)}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice {deleting?.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from your invoice list and moves it to the <strong>Recycle Bin</strong>,
              where it can be permanently deleted later. Inventory will <strong>not</strong> be
              changed — stock is left as-is because the goods have typically already left the
              premises. This action is recorded in the system audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInvoice.isPending}>Keep Invoice</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              disabled={deleteInvoice.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-invoice"
            >
              {deleteInvoice.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Yes, delete invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
