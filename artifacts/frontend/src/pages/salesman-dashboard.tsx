import { useAuth } from "@/contexts/use-auth";
import {
  useGetCommissionMyStats,
  getCommissionMyStatsQueryKey,
  useGetCommissionTransactions,
  getCommissionTransactionsQueryKey,
  useListEntities,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { IndianRupee, Droplets, Users, Loader2, TrendingUp } from "lucide-react";

const fmt = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Paid</Badge>;
  }
  return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pending</Badge>;
}

export default function SalesmanDashboard() {
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useGetCommissionMyStats({
    query: { queryKey: getCommissionMyStatsQueryKey() },
  });

  const txParams = { status: undefined, from: undefined, to: undefined, salesmanId: undefined };
  const { data: txData, isLoading: txLoading } = useGetCommissionTransactions(txParams, {
    query: { queryKey: getCommissionTransactionsQueryKey(txParams) },
  });

  const { data: myCustomers, isLoading: custLoading } = useListEntities({ type: "salesman" } as any);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {user?.name ? `Welcome, ${user.name}` : "Your sales and commission overview."}
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Commission</CardTitle>
            <IndianRupee className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-2xl font-bold text-amber-600">{fmt(stats?.pending)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Awaiting payment</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Paid Commission</CardTitle>
            <IndianRupee className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-2xl font-bold text-emerald-600">{fmt(stats?.paid)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Already received</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Earned</CardTitle>
            <Droplets className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            ) : (
              <div className="text-2xl font-bold text-primary">{fmt(stats?.total)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">All-time commission</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Commission Transactions</CardTitle>
          <CardDescription>Latest invoices contributing to your commission.</CardDescription>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : !stats?.recentTransactions || stats.recentTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No commission transactions yet.</div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Liters</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentTransactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">{tx.invoiceNo}</TableCell>
                      <TableCell className="text-sm">{tx.customerName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(tx.totalLiters)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmt(tx.commissionAmount)}</TableCell>
                      <TableCell><StatusBadge status={tx.status} /></TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleDateString("en-IN")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Transactions */}
      {txData && txData.transactions.length > (stats?.recentTransactions?.length ?? 0) && (
        <Card>
          <CardHeader>
            <CardTitle>All Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Liters</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-6"><Loader2 className="w-4 h-4 animate-spin inline mr-2" /> Loading...</TableCell></TableRow>
                  ) : txData.transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="font-mono text-xs">{tx.invoiceNo}</TableCell>
                      <TableCell className="text-sm">{tx.customerName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtQty(tx.totalLiters)}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{fmt(tx.commissionAmount)}</TableCell>
                      <TableCell><StatusBadge status={tx.status} /></TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleDateString("en-IN")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
