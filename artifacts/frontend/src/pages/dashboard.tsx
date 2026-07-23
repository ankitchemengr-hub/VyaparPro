import React from "react";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  useGetDashboardSummary,
  useGetLowStockAlerts,
  useGetCapitalSnapshot,
  getGetCapitalSnapshotQueryKey,
  useGetLitersSold,
  getGetLitersSoldQueryKey,
  useListWorkloadCards,
  useListProducts,
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
  Droplets,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function Dashboard() {
  const { user, hasRole } = useAuth();

  const isManagement = hasRole(["admin", "accountant"]);
  const isAdmin = hasRole(["admin"]);
  const [showCapitalDetails, setShowCapitalDetails] = React.useState(false);

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
  const { data: litersSold, isLoading: isLoadingLiters } = useGetLitersSold({
    query: { queryKey: getGetLitersSoldQueryKey(), enabled: isAdmin },
  });
  const { data: workloadCards } = useListWorkloadCards();
  const { data: manufacturingProducts } = useListProducts();

  // Mirrors Manufacturing > Workload's own list: every product flagged "Add
  // for Manufacturing" that's currently below its minimum stock threshold —
  // not just ones that already happen to have a workload_cards row, since a
  // low-stock item with no card yet is still production demand the admin
  // needs to see here.
  const productById = new Map((manufacturingProducts ?? []).map((p: any) => [p.id, p]));
  const activeCardByProduct = new Map<number, any>();
  (workloadCards ?? [])
    .filter((c: any) => c.status === "pending" || c.status === "processing")
    .forEach((c: any) => {
      const prev = activeCardByProduct.get(c.productId);
      if (!prev || new Date(c.createdAt) > new Date(prev.createdAt)) activeCardByProduct.set(c.productId, c);
    });
  const assembledItems = (lowStockAlerts ?? [])
    .filter((a: any) => productById.get(a.id)?.addForManufacturing)
    .map((a: any) => {
      const available = Number(a.currentStock);
      const card = activeCardByProduct.get(a.id);
      const required = card ? Number(card.targetQty) : Math.max(0, Number(a.minStockThreshold) - available);
      return {
        id: a.id,
        productName: a.name,
        unit: a.unit ?? "",
        required,
        status: card?.status === "processing" ? "processing" : "pending",
      };
    })
    .sort((a, b) => b.required - a.required);

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
          <Card
            className="border-amber-200 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/30 dark:to-transparent cursor-pointer select-none"
            onClick={() => setShowCapitalDetails((v) => !v)}
            data-testid="card-capital"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Capital</CardTitle>
              <div className="flex items-center gap-1">
                <Wallet className="h-4 w-4 text-amber-600" />
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showCapitalDetails ? "rotate-180" : ""}`} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingCapital || !capital ? (
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
              ) : (
                <>
                  <div className="text-2xl font-bold" data-testid="text-capital-value">
                    {capital.capitalK.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-xs text-muted-foreground font-normal ml-1">k</span>
                  </div>
                  {showCapitalDetails && (
                    <div className="mt-2 space-y-0.5 text-[11px]">
                      {[
                        { label: "Inventory", value: capital.inventoryValue, sign: "+" as const },
                        { label: "Receivable", value: capital.receivable, sign: "+" as const },
                        { label: "Cash", value: capital.cashInAccounts, sign: "+" as const },
                        { label: "Supplier Balance", value: capital.payable, sign: "-" as const },
                        { label: "Expenses", value: capital.expenses, sign: "-" as const },
                      ].map((row) => (
                        <div
                          key={row.label}
                          className={`flex justify-between ${row.sign === "-" ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
                          data-testid={`text-capital-${row.label.toLowerCase().replace(/\s+/g, "-")}`}
                        >
                          <span>{row.label}</span>
                          <span className="tabular-nums">
                            {row.sign}₹{Math.abs(row.value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Ltr Sale</CardTitle>
              <Droplets className="h-4 w-4 text-sky-600" />
            </CardHeader>
            <CardContent>
              {isLoadingLiters || !litersSold ? (
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
              ) : (
                <Tabs defaultValue="day">
                  <TabsList className="h-7">
                    <TabsTrigger value="day" className="text-xs px-2 py-0.5">Day</TabsTrigger>
                    <TabsTrigger value="month" className="text-xs px-2 py-0.5">Month</TabsTrigger>
                  </TabsList>
                  <TabsContent value="day">
                    <div className="text-2xl font-bold" data-testid="text-liters-today-value">
                      {litersSold.today.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      <span className="text-xs text-muted-foreground font-normal ml-1">L</span>
                    </div>
                  </TabsContent>
                  <TabsContent value="month">
                    <div className="text-2xl font-bold" data-testid="text-liters-month-value">
                      {litersSold.thisMonth.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      <span className="text-xs text-muted-foreground font-normal ml-1">L</span>
                    </div>
                    {(() => {
                      const diff = litersSold.thisMonth - litersSold.lastMonth;
                      const isUp = diff >= 0;
                      return (
                        <div
                          className={`flex items-center gap-1 text-xs font-medium mt-1 ${isUp ? "text-green-600" : "text-red-600"}`}
                          data-testid="text-liters-growth-value"
                        >
                          {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                          {isUp ? "+" : ""}
                          {diff.toLocaleString(undefined, { maximumFractionDigits: 2 })} L vs last month
                        </div>
                      );
                    })()}
                  </TabsContent>
                </Tabs>
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
          <CardDescription>Items pending production.</CardDescription>
        </CardHeader>
        <CardContent>
          {assembledItems.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">No pending items. All production is up to date.</div>
          ) : (
            <div className="divide-y rounded-lg border overflow-hidden">
              {assembledItems.slice(0, 10).map((c) => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2.5 bg-card hover:bg-muted/40">
                  <div className="flex items-center gap-2">
                    <PackageOpen className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="text-sm font-medium">{c.productName}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    <Badge
                      variant={c.status === "processing" ? "default" : "secondary"}
                      className="text-xs capitalize"
                    >
                      {c.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      {c.required.toLocaleString()} {c.unit}
                    </Badge>
                  </div>
                </div>
              ))}
              {assembledItems.length > 10 && (
                <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/20">
                  + {assembledItems.length - 10} more
                </div>
              )}
            </div>
          )}
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
