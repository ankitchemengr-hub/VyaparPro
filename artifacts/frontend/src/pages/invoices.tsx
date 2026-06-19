import React, { useState } from "react";
import { useAuth } from "@/contexts/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import {
  useListInvoices,
  useDeleteInvoice,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth, startOfDay, subDays } from "date-fns";
import { Pencil, Trash2, Loader2, UserCircle2, Eye, CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

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
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>(initialType);
  const [status, setStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [deleting, setDeleting] = useState<{ id: number; invoiceNo: string; invoiceType: string } | null>(null);

  const isSalesman = user?.role === "salesman";
  const isAdmin = user?.role === "admin";

  const applyPreset = (preset: "today" | "7d" | "30d" | "mtd") => {
    const today = startOfDay(new Date());
    if (preset === "today") { setDateFrom(today); setDateTo(today); }
    else if (preset === "7d") { setDateFrom(subDays(today, 6)); setDateTo(today); }
    else if (preset === "30d") { setDateFrom(subDays(today, 29)); setDateTo(today); }
    else if (preset === "mtd") { setDateFrom(startOfMonth(today)); setDateTo(today); }
  };

  const clearFilters = () => {
    setSearch(""); setType("all"); setStatus("all");
    setDateFrom(undefined); setDateTo(undefined);
  };

  const hasFilters = !!search || type !== "all" || status !== "all" || !!dateFrom || !!dateTo;

  // Salesman scoping is enforced server-side from their session entity — no need
  // (and incorrect) to send user.id here, which is the user-account id, not the
  // entity id referenced by invoices.salesman_id.
  const { data: invoices, isLoading } = useListInvoices({
    search: search || undefined,
    type: type !== "all" ? (type as any) : undefined,
    status: status !== "all" ? (status as any) : undefined,
    dateFrom: dateFrom ? format(dateFrom, "yyyy-MM-dd") : undefined,
    dateTo: dateTo ? format(dateTo, "yyyy-MM-dd") : undefined,
  });

  const deleteInvoice = useDeleteInvoice();

  const handleConfirmDelete = () => {
    if (!deleting) return;
    deleteInvoice.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          toast({
            title: "Invoice cancelled",
            description: `${deleting.invoiceNo} cancelled. Inventory was not changed; action recorded in audit log.`,
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
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search invoice number or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
              data-testid="input-invoice-search"
            />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[150px]" data-testid="select-invoice-type">
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
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[150px]" data-testid="select-invoice-status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="saved">Saved</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn("justify-start font-normal w-[160px]", !dateFrom && "text-muted-foreground")}
                  data-testid="button-date-from"
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {dateFrom ? format(dateFrom, "dd MMM yyyy") : "From date"}
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
                  className={cn("justify-start font-normal w-[160px]", !dateTo && "text-muted-foreground")}
                  data-testid="button-date-to"
                >
                  <CalendarIcon className="h-4 w-4 mr-2" />
                  {dateTo ? format(dateTo, "dd MMM yyyy") : "To date"}
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

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                data-testid="button-clear-filters"
              >
                <X className="h-4 w-4 mr-1" />Clear
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Quick range:</span>
            <Button variant="outline" size="sm" className="h-7" onClick={() => applyPreset("today")} data-testid="preset-today">Today</Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => applyPreset("7d")} data-testid="preset-7d">Last 7 days</Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => applyPreset("30d")} data-testid="preset-30d">Last 30 days</Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => applyPreset("mtd")} data-testid="preset-mtd">This month</Button>
            <span className="ml-auto text-muted-foreground" data-testid="text-result-count">
              {isLoading ? "Loading…" : `${invoices?.length ?? 0} invoice${(invoices?.length ?? 0) === 1 ? "" : "s"}`}
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
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Customer</TableHead>
                {isAdmin && <TableHead>Created By</TableHead>}
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : invoices?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8">No invoices found.</TableCell>
                </TableRow>
              ) : (
                invoices?.map((invoice) => {
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
                    <TableCell>{format(new Date(invoice.invoiceDate), "MMM dd, yyyy")}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{TYPE_LABELS[invoice.invoiceType] ?? invoice.invoiceType}</Badge>
                    </TableCell>
                    <TableCell>{invoice.customerName || "Cash Sale"}</TableCell>
                    {isAdmin && (
                      <TableCell data-testid={`cell-created-by-${invoice.id}`}>
                        {invoice.salesmanName ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold italic text-amber-700 dark:text-amber-300">
                            <UserCircle2 className="h-3.5 w-3.5" />
                            {invoice.salesmanName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Admin / Counter</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-bold">₹{invoice.grandTotal.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === "saved" ? "default" : invoice.status === "draft" ? "secondary" : "destructive"}>
                        {invoice.status}
                      </Badge>
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
                              className="h-8 w-8 text-destructive hover:text-destructive"
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

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invoice {deleting?.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This invoice will be marked <strong>Cancelled</strong>. Inventory will
              <strong> not</strong> be changed — stock is left as-is because the goods
              have typically already left the premises. The cancellation will be
              recorded in the system audit log.
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
              Yes, cancel invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
