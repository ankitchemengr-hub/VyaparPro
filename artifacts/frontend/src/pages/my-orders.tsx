import { useState } from "react";
import { useAuth } from "@/contexts/use-auth";
import { useListInvoices } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ShoppingBag, Loader2, Search, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";


const fmt = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    saved: "bg-blue-100 text-blue-800",
    paid: "bg-emerald-100 text-emerald-800",
    cancelled: "bg-red-100 text-red-800",
    partial: "bg-amber-100 text-amber-800",
  };
  return (
    <Badge className={`${map[status] ?? "bg-gray-100 text-gray-800"} hover:opacity-90 capitalize`}>
      {status}
    </Badge>
  );
}

export default function MyOrders() {
  const { user } = useAuth();
  const navigate = useLocation();
  const [search, setSearch] = useState("");

  // Backend auto-scopes to this salesman's invoices (last 7 days) when role=salesman
  const { data: invoices, isLoading } = useListInvoices({ search: search || undefined });

  const list = Array.isArray(invoices) ? invoices : [];

  const totalAmount = list.reduce((s, inv) => s + Number(inv.grandTotal ?? 0), 0);
  const pendingAmount = list
    .filter((inv) => inv.status !== "paid" && inv.status !== "cancelled")
    .reduce((s, inv) => s + Number(inv.balanceDue ?? 0), 0);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ShoppingBag className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Customer Orders</h1>
          <p className="text-sm text-muted-foreground">
            {user?.name ? `Orders assigned to ${user.name}` : "Your customer invoices (last 7 days)"}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{list.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Last 7 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{fmt(totalAmount)}</div>
            <p className="text-xs text-muted-foreground mt-1">Grand total across all orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{fmt(pendingAmount)}</div>
            <p className="text-xs text-muted-foreground mt-1">Balance due from customers</p>
          </CardContent>
        </Card>
      </div>

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>Customer invoices linked to your account</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search invoice / customer..."
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading orders...
            </div>
          ) : list.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ShoppingBag className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No orders found in the last 7 days.</p>
            </div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Balance Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs font-semibold">{inv.invoiceNo}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {inv.invoiceDate
                          ? new Date(inv.invoiceDate).toLocaleDateString("en-IN")
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{inv.customerName ?? "—"}</TableCell>
                      <TableCell className="text-xs uppercase text-muted-foreground">
                        {inv.invoiceType?.replace("_", " ")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">
                        {fmt(inv.grandTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">
                        {fmt(inv.balanceDue)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/invoices/${inv.id}`)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}