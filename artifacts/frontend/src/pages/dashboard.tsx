import React from "react";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  useGetDashboardSummary,
  useGetLowStockAlerts,
  useGetCapitalSnapshot,
  getGetCapitalSnapshotQueryKey,
  useListWorkloadCards,
  useListCustomerOrders,
} from "@workspace/api-client-react";
import {
  IndianRupee,
  AlertTriangle,
  CreditCard,
  PackageOpen,
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Factory,
  Clock,
  Loader2,
  Truck,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { user, hasRole } = useAuth();

  const isManagement = hasRole(["admin", "accountant"]);
  const isAdmin = hasRole(["admin"]);

  if (!isManagement) {
    // If not management, they shouldn't really be here, they should be redirected to catalog
    // But just in case, show a welcome message
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome, {user?.name}</h1>
          <p className="text-muted-foreground mt-2">Navigate using the sidebar to access your modules.</p>
        </div>
      </div>
    );
  }

  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: lowStockAlerts } = useGetLowStockAlerts();
  const { data: capital, isLoading: isLoadingCapital } = useGetCapitalSnapshot({
    query: { queryKey: getGetCapitalSnapshotQueryKey(), enabled: isAdmin },
  });
  const { data: workloadCards } = useListWorkloadCards();
  const { data: readyOrders } = useListCustomerOrders({ status: "ready_for_dispatch" });

  const cards = workloadCards ?? [];
  const workloadPending = cards.filter((c: any) => c.status === "pending").length;
  const workloadInProgress = cards.filter((c: any) => c.status === "processing").length;
  const workloadCompleted = cards.filter((c: any) => c.status === "done").length;
  const workloadReady = (readyOrders ?? []).length;

  const workloadStats = [
    { label: "Pending", value: workloadPending, icon: Clock, color: "text-amber-600" },
    { label: "In Progress", value: workloadInProgress, icon: Loader2, color: "text-blue-600" },
    { label: "Ready for Dispatch", value: workloadReady, icon: Truck, color: "text-purple-600" },
    { label: "Completed", value: workloadCompleted, icon: CheckCircle2, color: "text-green-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Overview of business performance and alerts.</p>
        </div>
      </div>

      {isAdmin && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-transparent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Capital</CardTitle>
              <Wallet className="h-4 w-4 text-amber-600" />
            </CardHeader>
            <CardContent>
              {isLoadingCapital || !capital ? (
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
              ) : (
                <div className="text-2xl font-bold" data-testid="text-capital-value">
                  {capital.capitalK.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-xs text-muted-foreground font-normal ml-1">k</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Growth</CardTitle>
              {capital?.growthK == null ? (
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              ) : capital.growthK >= 0 ? (
                <ArrowUpRight className="h-4 w-4 text-green-600" />
              ) : (
                <ArrowDownRight className="h-4 w-4 text-red-600" />
              )}
            </CardHeader>
            <CardContent>
              {isLoadingCapital || !capital ? (
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
              ) : capital.growthK == null ? (
                <div className="text-2xl font-bold text-muted-foreground">—</div>
              ) : (
                <div className={`text-2xl font-bold ${capital.growthK >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-growth-value">
                  {capital.growthK >= 0 ? "+" : ""}
                  {capital.growthK.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-xs text-muted-foreground font-normal ml-1">k</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {isLoadingSummary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse bg-muted/20">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="h-4 w-24 bg-muted rounded"></div>
                <div className="h-4 w-4 bg-muted rounded"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-32 bg-muted rounded mb-2"></div>
                <div className="h-3 w-48 bg-muted rounded"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sales This Month</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₹{summary.totalSalesThisMonth.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {summary.invoicesThisMonth} invoices generated
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Outstanding</CardTitle>
              <TrendingUp className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">₹{summary.totalOutstanding.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                Pending collections from customers
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.lowStockCount}</div>
              <p className="text-xs text-muted-foreground">
                Products below minimum threshold
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.pendingPayments}</div>
              <p className="text-xs text-muted-foreground">
                Awaiting admin approval
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Factory className="h-5 w-5 text-primary" />
            <CardTitle>Manufacturing Workload</CardTitle>
          </div>
          <CardDescription>Production pipeline status across all batches.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {workloadStats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border bg-card p-4 flex flex-col gap-2"
                data-testid={`workload-stat-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">{stat.label}</span>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
                <div className="text-2xl font-bold">{stat.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Low Stock Alerts</CardTitle>
          <CardDescription>Products requiring immediate attention.</CardDescription>
        </CardHeader>
        <CardContent>
          {lowStockAlerts && lowStockAlerts.length > 0 ? (
            <div className="space-y-4">
              {lowStockAlerts.slice(0, 8).map(alert => (
                <div key={alert.id} className="flex items-center justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{alert.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Min: {alert.minStockThreshold} {alert.unit}
                    </p>
                  </div>
                  <Badge variant="destructive">
                    {alert.currentStock} {alert.unit} left
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">
              <div className="flex flex-col items-center">
                <PackageOpen className="h-8 w-8 mb-2 opacity-20" />
                <p>Inventory levels are healthy.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
