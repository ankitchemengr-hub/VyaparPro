import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListInvoices,
  usePermanentlyDeleteInvoice,
  getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { format } from "date-fns";
import { Trash2, Eye, Loader2, RotateCcw } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  gst: "GST",
  non_gst: "Non-GST",
  quotation: "Quotation",
  proforma_invoice: "Proforma",
  bill_of_supply: "Bill of Supply",
  delivery_challan: "Delivery Challan",
  sale_order: "Sale Order",
};

export default function RecycleBin() {
  const { hasRole } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState<{ id: number; invoiceNo: string } | null>(null);

  if (!hasRole(["admin"])) return <Redirect to="/" />;

  const { data: invoices, isLoading } = useListInvoices({ status: "cancelled" });
  const permanentlyDelete = usePermanentlyDeleteInvoice();

  const handleConfirmDelete = () => {
    if (!deleting) return;
    permanentlyDelete.mutate(
      { id: deleting.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          toast({ title: "Permanently deleted", description: `${deleting.invoiceNo} is gone for good. Stock and ledger were not affected.` });
          setDeleting(null);
        },
        onError: async (err: any) => {
          let msg = err?.message ?? "Delete failed";
          try { const j = await err?.response?.json?.(); if (j?.error) msg = String(j.error).slice(0, 300); } catch {}
          toast({ title: "Delete failed", description: msg, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <RotateCcw className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recycle Bin</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Cancelled invoices. Permanently deleting one here removes it for good — it will not change any product stock or customer ledger entries it already created.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">Loading...</TableCell>
                  </TableRow>
                ) : (invoices ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Recycle Bin is empty.</TableCell>
                  </TableRow>
                ) : (
                  (invoices ?? []).map((invoice) => (
                    <TableRow key={invoice.id} data-testid={`row-recycle-${invoice.id}`}>
                      <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                      <TableCell>{format(new Date(invoice.invoiceDate), "MMM dd, yyyy")}</TableCell>
                      <TableCell><Badge variant="outline">{TYPE_LABELS[invoice.invoiceType] ?? invoice.invoiceType}</Badge></TableCell>
                      <TableCell>{invoice.customerName || "Cash Sale"}</TableCell>
                      <TableCell className="text-right font-bold">₹{invoice.grandTotal.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setLocation(`/invoices/${invoice.id}`)}
                            data-testid={`button-view-recycle-${invoice.id}`}
                            aria-label="View invoice"
                            title="View invoice"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleting({ id: invoice.id, invoiceNo: invoice.invoiceNo })}
                            data-testid={`button-delete-recycle-${invoice.id}`}
                            aria-label="Permanently delete"
                            title="Permanently delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {deleting?.invoiceNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone — the invoice record is removed from the system entirely.
              Product stock levels and customer ledger entries that this invoice already created will <strong>not</strong> be changed or reversed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={permanentlyDelete.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleConfirmDelete(); }}
              disabled={permanentlyDelete.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {permanentlyDelete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
