import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListCustomerOrders,
  useGetCustomerOrder,
  useUpdateCustomerOrderStatus,
  useGetEntity,
  getListCustomerOrdersQueryKey,
  getGetCustomerOrderQueryKey,
  getGetEntityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Inbox, Eye, Loader2, FileText, Printer } from "lucide-react";
import { useAuth } from "@/contexts/use-auth";

const STATUSES = [
  "pending",
  "processing",
  "production",
  "ready_for_dispatch",
  "dispatched",
  "delivered",
  "done",
  "cancelled",
] as const;
type Status = typeof STATUSES[number];

const FILTER_STATUSES: Status[] = ["pending", "done", "cancelled"];

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  production: { label: "In Production", className: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100" },
  ready_for_dispatch: { label: "Ready For Dispatch", className: "bg-purple-100 text-purple-800 hover:bg-purple-100" },
  dispatched: { label: "Dispatched", className: "bg-cyan-100 text-cyan-800 hover:bg-cyan-100" },
  delivered: { label: "Delivered", className: "bg-teal-100 text-teal-800 hover:bg-teal-100" },
  done: { label: "Completed", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 hover:bg-red-100" },
};

function StatusBadge({ status }: { status: string }) {
  const v = STATUS_VARIANTS[status] ?? { label: status, className: "" };
  return <Badge className={v.className} data-testid={`status-${status}`}>{v.label}</Badge>;
}

function printOrder(detail: any) {
  const win = window.open("", "_blank");
  if (!win) return;

  const itemsHtml = (detail.items ?? [])
    .map(
      (it: any) => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${it.productName}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">${it.qty} ${it.unit ?? ""}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;">&#x20B9;${Number(it.unitPrice).toLocaleString("en-IN")}</td>
        <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:600;">&#x20B9;${Number(it.lineTotal).toLocaleString("en-IN")}</td>
      </tr>`,
    )
    .join("");

  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Order ${detail.orderNo ?? `#${detail.id}`}</title>
  <style>
    body{font-family:Arial,sans-serif;padding:28px;color:#111;}
    h2{margin:0 0 4px;}
    .sub{color:#555;font-size:13px;margin-bottom:20px;}
    .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px;}
    .lbl{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
    .val{font-weight:600;font-size:14px;margin-top:2px;}
    table{width:100%;border-collapse:collapse;margin-top:4px;}
    th{background:#f3f4f6;text-align:left;padding:8px;border:1px solid #ddd;font-size:13px;}
    td{font-size:13px;}
    .total-row{text-align:right;font-weight:700;font-size:16px;margin-top:12px;}
    hr{border:none;border-top:1px solid #e5e7eb;margin:16px 0;}
  </style>
</head>
<body>
  <h2>Order ${detail.orderNo ?? `#${detail.id}`}</h2>
  <div class="sub">Printed on ${new Date().toLocaleString("en-IN")}</div>
  <hr/>
  <div class="grid">
    <div>
      <div class="lbl">Customer</div>
      <div class="val">${detail.customerName ?? "-"}</div>
      ${detail.customerMobile ? `<div style="font-size:12px;color:#555;">${detail.customerMobile}</div>` : ""}
    </div>
    <div>
      <div class="lbl">Order Date</div>
      <div class="val">${new Date(detail.createdAt).toLocaleString("en-IN")}</div>
    </div>
    <div>
      <div class="lbl">Status</div>
      <div class="val">Completed</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th style="text-align:right;">Qty</th>
        <th style="text-align:right;">Unit Price</th>
        <th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div class="total-row">Total: &#x20B9;${Number(detail.totalAmount).toLocaleString("en-IN")}</div>
  <script>window.onload=function(){window.print();}</script>
</body>
</html>`);
  win.document.close();
}

export default function CustomerOrdersAdmin() {
  const { user } = useAuth();
  const role = user?.role ?? "";

  const isAdminOrAccountant = role === "admin" || role === "accountant";
  const isWorker = role === "store" || role === "manufacturing";

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: orders, isLoading } = useListCustomerOrders(
    statusFilter !== "all" ? { status: statusFilter as Status } : undefined,
  );
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: detail, isLoading: detailLoading } = useGetCustomerOrder(openId ?? 0, {
    query: { enabled: openId != null, queryKey: getGetCustomerOrderQueryKey(openId ?? 0) },
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const updateStatus = useUpdateCustomerOrderStatus();
  const [newStatus, setNewStatus] = useState<Status>("processing");
  const [remarks, setRemarks] = useState("");

  const entityId = detail?.entityId ?? 0;
  const { data: entity } = useGetEntity(entityId, {
    query: { enabled: !!detail?.entityId, queryKey: getGetEntityQueryKey(entityId) },
  });

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
    const qs = `?cart=${encodeURIComponent(JSON.stringify(cart))}&customer=${encodeURIComponent(JSON.stringify(customer))}&order=${detail.id}`;
    setLocation(`/billing${qs}`);
  };

  const submitStatus = () => {
    if (openId == null) return;
    updateStatus.mutate(
      { id: openId, data: { status: newStatus, adminRemarks: remarks || undefined } },
      {
        onSuccess: () => {
          toast({
            title: "Order updated",
            description:
              newStatus === "processing"
                ? "Workload cards created in Manufacturing."
                : `Status set to ${newStatus}.`,
          });
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetCustomerOrderQueryKey(openId) });
          setRemarks("");
        },
        onError: (err: any) =>
          toast({
            title: "Update failed",
            description: err?.message ?? "Please try again",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">Customer Orders</h1>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {FILTER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_VARIANTS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Customer Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              No customer orders yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o: any) => (
                  <TableRow key={o.id} data-testid={`order-row-${o.id}`}>
                    <TableCell className="font-mono text-xs">{o.orderNo ?? `#${o.id}`}</TableCell>
                    <TableCell>{new Date(o.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell>{o.customerName}</TableCell>
                    <TableCell>{o.customerMobile ?? "-"}</TableCell>
                    <TableCell className="text-right">{o.totalItems}</TableCell>
                    <TableCell className="text-right font-medium">
                      ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setOpenId(o.id);
                          setNewStatus(o.status === "pending" ? "processing" : o.status);
                          setRemarks("");
                        }}
                        data-testid={`button-view-${o.id}`}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={openId != null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Order {detail?.orderNo ?? (openId ? `#${openId}` : "")}
            </DialogTitle>
          </DialogHeader>
          {detailLoading || !detail ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Customer</div>
                  <div className="font-medium">{detail.customerName}</div>
                  <div className="text-xs text-muted-foreground">{detail.customerMobile ?? ""}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Placed</div>
                  <div className="font-medium">{new Date(detail.createdAt).toLocaleString("en-IN")}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <StatusBadge status={detail.status} />
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.items?.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        {it.productName}
                        {it.workloadCardId && (
                          <Badge variant="outline" className="ml-2 text-xs">
                            Workload #{it.workloadCardId}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{it.qty} {it.unit ?? ""}</TableCell>
                      <TableCell className="text-right">₹{Number(it.unitPrice).toLocaleString("en-IN")}</TableCell>
                      <TableCell className="text-right font-medium">₹{Number(it.lineTotal).toLocaleString("en-IN")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end text-base font-bold">
                Total: ₹{Number(detail.totalAmount).toLocaleString("en-IN")}
              </div>

              <div className="border-t pt-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Update Status</Label>
                    <Select value={newStatus} onValueChange={(v) => setNewStatus(v as Status)}>
                      <SelectTrigger data-testid="select-new-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_VARIANTS[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Admin Remarks (optional)</Label>
                    <Textarea
                      rows={2}
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      data-testid="input-admin-remarks"
                    />
                  </div>
                </div>
                {newStatus === "processing" && detail.status !== "processing" && detail.status !== "done" && (
                  <p className="text-xs text-muted-foreground">
                    Moving to Processing will create workload cards in Manufacturing for each item.
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  {isWorker && detail.status === "done" && (
                    <Button
                      variant="outline"
                      onClick={() => printOrder(detail)}
                      data-testid="button-print-order"
                    >
                      <Printer className="w-4 h-4 mr-2" />
                      Print Order
                    </Button>
                  )}
                  {isAdminOrAccountant && (detail.status === "done" || detail.status === "processing") && (
                    <Button
                      variant="default"
                      onClick={goToBilling}
                      data-testid="button-create-invoice"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      Create Invoice
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={submitStatus}
                    disabled={updateStatus.isPending || newStatus === detail.status}
                    data-testid="button-update-status"
                  >
                    {updateStatus.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Update Order
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
