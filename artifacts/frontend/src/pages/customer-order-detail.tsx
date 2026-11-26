// Customer Orders → one order on its own page, laid out like an invoice:
// customer, items, total; then status update and "Create Invoice".
import { useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useGetCustomerOrder,
  useUpdateCustomerOrderStatus,
  useGetEntity,
  getListCustomerOrdersQueryKey,
  getGetCustomerOrderQueryKey,
  getGetEntityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";
import { ArrowLeft, Loader2, FileText, Printer } from "lucide-react";

export const ORDER_STATUSES = [
  "pending",
  "processing",
  "production",
  "ready_for_dispatch",
  "dispatched",
  "delivered",
  "done",
  "cancelled",
] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

export const ORDER_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  pending: { label: "New", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  production: { label: "In Production", className: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100" },
  ready_for_dispatch: { label: "Ready For Dispatch", className: "bg-purple-100 text-purple-800 hover:bg-purple-100" },
  dispatched: { label: "Dispatched", className: "bg-cyan-100 text-cyan-800 hover:bg-cyan-100" },
  delivered: { label: "Delivered", className: "bg-teal-100 text-teal-800 hover:bg-teal-100" },
  done: { label: "Completed", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 hover:bg-red-100" },
};

const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function CustomerOrderDetail() {
  const { id: rawId } = useParams<{ id: string }>();
  const id = Number(rawId) || 0;
  const { user } = useAuth();
  const role = user?.role ?? "";
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: detail, isLoading, isError } = useGetCustomerOrder(id, {
    query: { enabled: id > 0, queryKey: getGetCustomerOrderQueryKey(id) },
  });
  const entityId = detail?.entityId ?? 0;
  const { data: entity } = useGetEntity(entityId, {
    query: { enabled: !!detail?.entityId && role !== "salesman", queryKey: getGetEntityQueryKey(entityId) },
  });

  const canInvoice = role === "admin" || role === "accountant";
  const canUpdate = role === "admin" || role === "manufacturing";
  const updateStatus = useUpdateCustomerOrderStatus();
  const [newStatus, setNewStatus] = useState<OrderStatus | null>(null);
  const [remarks, setRemarks] = useState("");
  const status = (detail?.status ?? "pending") as OrderStatus;
  const chosen: OrderStatus = newStatus ?? (status === "pending" ? "processing" : status);

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else setLocation("/customer-orders?s=pending", { replace: true });
  };

  const goToBilling = () => {
    if (!detail) return;
    const cart = (detail.items ?? []).map((it: any) => ({ productId: it.productId, qty: Number(it.qty) }));
    const customer = entity
      ? {
          id: entity.id,
          name: entity.name,
          gstin: (entity as any).gstin ?? null,
          address: (entity as any).address ?? null,
          state: (entity as any).state ?? "Maharashtra",
          mobile: (entity as any).mobile ?? detail.customerMobile,
          pricingTier: (entity as any).pricingTier ?? "retail",
          outstandingBalance: (entity as any).outstandingBalance ?? 0,
        }
      : {
          id: null,
          name: detail.customerName,
          mobile: detail.customerMobile,
          state: "Maharashtra",
          pricingTier: "retail",
          outstandingBalance: 0,
        };
    const invoiceType = (detail as any).invoiceType === "non_gst" ? "non_gst" : "gst";
    const qs = `?cart=${encodeURIComponent(JSON.stringify(cart))}&customer=${encodeURIComponent(JSON.stringify(customer))}&order=${detail.id}&invoiceType=${invoiceType}`;
    setLocation(`/billing${qs}`);
  };

  const submitStatus = () => {
    updateStatus.mutate(
      { id, data: { status: chosen, adminRemarks: remarks || undefined } },
      {
        onSuccess: () => {
          toast({
            title: "Order updated",
            description: chosen === "processing" ? "Workload cards created in Manufacturing." : `Status set to ${ORDER_STATUS_LABELS[chosen]?.label ?? chosen}.`,
          });
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCustomerOrderQueryKey(id) });
          setRemarks("");
          setNewStatus(null);
        },
        onError: (err: any) => toast({ title: "Update failed", description: err?.message ?? "Please try again", variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return <div className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || !detail) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <p className="text-muted-foreground">This order could not be opened.</p>
            <Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4 mr-2" />Customer Orders</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const badge = ORDER_STATUS_LABELS[status] ?? { label: status, className: "" };
  const address = entity ? [(entity as any).address, (entity as any).area, (entity as any).district, (entity as any).pinCode].filter(Boolean).join(", ") : "";
  const placed = new Date(detail.createdAt);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto print:p-0 print:max-w-none">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={back} data-testid="button-back">
          <ArrowLeft className="h-4 w-4 mr-1.5" />Customer Orders
        </Button>
        <Badge className={badge.className} data-testid={`status-${status}`}>{badge.label}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="button-print-order">
            <Printer className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Print</span>
          </Button>
          {canInvoice && !["pending", "cancelled", "done"].includes(status) && (
            <Button size="sm" onClick={goToBilling} data-testid="button-create-invoice">
              <FileText className="h-4 w-4 mr-2" />Create Invoice
            </Button>
          )}
        </div>
      </div>

      {/* The order, like a bill */}
      <Card className="print:border-0 print:shadow-none">
        <CardContent className="p-4 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Order</div>
              <div className="text-2xl font-bold" data-testid="text-order-no">{detail.orderNo ?? `#${detail.id}`}</div>
            </div>
            <div className="text-right text-sm">
              <div className="text-muted-foreground">Order date</div>
              <div className="font-medium">{placed.toLocaleDateString("en-IN")}</div>
              <div className="text-xs text-muted-foreground">{placed.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Customer</div>
            <div className="text-lg font-semibold" data-testid="text-customer-name">{detail.customerName}</div>
            {detail.customerMobile && <div className="text-sm">{detail.customerMobile}</div>}
            {address && <div className="text-sm text-muted-foreground">{address}</div>}
            {(entity as any)?.gstin && <div className="text-sm text-muted-foreground">GSTIN: {(entity as any).gstin}</div>}
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm sm:text-base tabular-nums">
              <thead>
                <tr className="border-y bg-muted/50 text-left">
                  <th className="py-2.5 px-3 w-10">#</th>
                  <th className="py-2.5 px-3">Item</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Rate</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {(detail.items ?? []).map((it: any, i: number) => (
                  <tr key={it.id} className="border-b" data-testid={`row-item-${it.id}`}>
                    <td className="py-2.5 px-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium">{it.productName}</div>
                      {it.workloadCardId && <div className="text-xs text-muted-foreground print:hidden">Workload #{it.workloadCardId}</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">{Number(it.qty).toLocaleString("en-IN")} {it.unit ?? ""}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">{inr(it.unitPrice)}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap font-medium">{inr(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full sm:w-72 space-y-1.5 text-sm sm:text-base">
              <div className="flex justify-between text-muted-foreground">
                <span>Items</span><span>{(detail.items ?? []).length}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Total</span><span data-testid="text-order-total">{inr(detail.totalAmount)}</span>
              </div>
            </div>
          </div>

          {(detail.notes || detail.adminRemarks) && (
            <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
              {detail.notes && <div><span className="text-muted-foreground">Note: </span>{detail.notes}</div>}
              {detail.adminRemarks && <div><span className="text-muted-foreground">Remarks: </span>{detail.adminRemarks}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      {canUpdate && status !== "done" && status !== "cancelled" && (
        <Card className="print:hidden">
          <CardContent className="p-4 sm:p-6 space-y-3">
            <div className="font-semibold">Update order</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={chosen} onValueChange={(v) => setNewStatus(v as OrderStatus)}>
                  <SelectTrigger data-testid="select-new-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>{ORDER_STATUS_LABELS[s].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Remarks (optional)</Label>
                <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} data-testid="input-admin-remarks" />
              </div>
            </div>
            {chosen === "processing" && status !== "processing" && (
              <p className="text-xs text-muted-foreground">Moving to Processing creates workload cards in Manufacturing for each item.</p>
            )}
            <div className="flex justify-end">
              <Button onClick={submitStatus} disabled={updateStatus.isPending || chosen === status} data-testid="button-update-status">
                {updateStatus.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Update Order
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
