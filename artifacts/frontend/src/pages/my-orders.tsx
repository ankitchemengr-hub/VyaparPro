import { useState } from "react";
import { useLocation } from "wouter";
import {
  useListCustomerOrders,
  useGetCustomerOrder,
  getGetCustomerOrderQueryKey,
} from "@workspace/api-client-react";
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
import { ClipboardList, Eye, Loader2, ShoppingBag } from "lucide-react";

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

export default function MyOrders() {
  const [, setLocation] = useLocation();
  const { data: orders, isLoading } = useListCustomerOrders();
  const [openId, setOpenId] = useState<number | null>(null);
  const { data: detail, isLoading: detailLoading } = useGetCustomerOrder(openId ?? 0, {
    query: { enabled: openId != null, queryKey: getGetCustomerOrderQueryKey(openId ?? 0) },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>
        </div>
        <Button onClick={() => setLocation("/catalog")} data-testid="button-browse-catalog">
          <ShoppingBag className="w-4 h-4 mr-2" />
          Browse Catalog
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Order History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              You haven&apos;t placed any orders yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id} data-testid={`order-row-${o.id}`}>
                    <TableCell className="font-mono text-xs">{o.orderNo ?? `#${o.id}`}</TableCell>
                    <TableCell>{new Date(o.createdAt).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="text-right">{o.totalItems}</TableCell>
                    <TableCell className="text-right font-medium">
                      ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell><StatusBadge status={o.status} /></TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setOpenId(o.id)}
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
                  <div className="text-muted-foreground">Placed</div>
                  <div className="font-medium">{new Date(detail.createdAt).toLocaleString("en-IN")}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <StatusBadge status={detail.status} />
                </div>
                <div>
                  <div className="text-muted-foreground">Total</div>
                  <div className="font-medium">₹{Number(detail.totalAmount).toLocaleString("en-IN")}</div>
                </div>
              </div>

              {detail.adminRemarks && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <span className="text-muted-foreground">Remarks: </span>
                  {detail.adminRemarks}
                </div>
              )}

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
                  {detail.items?.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.productName}</TableCell>
                      <TableCell className="text-right">
                        {it.qty} {it.unit ?? ""}
                      </TableCell>
                      <TableCell className="text-right">
                        ₹{Number(it.unitPrice).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right font-medium text-orange-600">
                        ₹{Number(it.lineTotal).toLocaleString("en-IN")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end text-base font-bold">
                Total: ₹{Number(detail.totalAmount).toLocaleString("en-IN")}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
