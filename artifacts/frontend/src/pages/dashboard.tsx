import React from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { homePathForRole } from "@/lib/nav-items";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useGetDashboardSummary,
  useGetLowStockAlerts,
  useGetCapitalSnapshot,
  getGetCapitalSnapshotQueryKey,
  useGetLitersSold,
  getGetLitersSoldQueryKey,
  useGetLitersBalance,
  getGetLitersBalanceQueryKey,
  useListWorkloadCards,
  useGetProfitLossReport,
  getGetProfitLossReportQueryKey,
} from "@workspace/api-client-react";
import {
  IndianRupee,
  AlertTriangle,
  CreditCard,
  TrendingUp,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Factory,
  Droplets,
  ChevronDown,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

// All-time liters flow as a ring: the whole circle is what's been purchased,
// the blue arc is the share still on hand (purchased − sold), and the empty
// gap is the share already sold. Figures are shown in thousands of liters.
function LitersRing({ purchased, sold }: { purchased: number; sold: number }) {
  const size = 116;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const onHand = Math.max(0, purchased - sold);
  const onHandFrac = purchased > 0 ? Math.min(1, onHand / purchased) : 0;
  const dash = onHandFrac * circ;
  const k = (n: number) => (n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" role="img" aria-label="Liters purchased versus sold">
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
            stroke="currentColor" className="text-muted-foreground/20"
          />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            stroke="currentColor"
            className="text-blue-500 transition-[stroke-dasharray] duration-500"
            strokeDasharray={`${dash} ${circ - dash}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-lg font-bold tabular-nums" data-testid="text-liters-onhand">{k(onHand)}</span>
          <span className="text-[10px] text-muted-foreground mt-0.5">k L on hand</span>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
          <span className="text-muted-foreground">Purchased</span>
          <span className="ml-auto font-semibold tabular-nums" data-testid="text-liters-purchased">{k(purchased)}k L</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30 shrink-0" />
          <span className="text-muted-foreground">Sold</span>
          <span className="ml-auto font-semibold tabular-nums" data-testid="text-liters-sold-total">{k(sold)}k L</span>
        </div>
        <div className="pt-1 text-xs text-muted-foreground border-t">
          {purchased > 0
            ? `${Math.round((Math.min(sold, purchased) / purchased) * 100)}% of purchased volume sold`
            : "No purchase history yet"}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, hasRole } = useAuth();

  const isAdmin = hasRole(["admin"]);
  const [showCapitalDetails, setShowCapitalDetails] = React.useState(false);
  const [showGrowthDetails, setShowGrowthDetails] = React.useState(false);
  const [showWorkload, setShowWorkload] = React.useState(false);
  const [showLowStock, setShowLowStock] = React.useState(false);

  if (!isAdmin) {
    // Dashboard is admin only. Anyone else landing on "/" (direct URL,
    // stale bookmark, browser back button, etc.) never sees any version of
    // it — sent straight to their real home page instead.
    return <Redirect to={homePathForRole(user?.role)} />;
  }

  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: lowStockAlerts } = useGetLowStockAlerts();
  const { data: capital, isLoading: isLoadingCapital } = useGetCapitalSnapshot({
    query: { queryKey: getGetCapitalSnapshotQueryKey(), enabled: isAdmin },
  });
  const { data: litersSold, isLoading: isLoadingLiters } = useGetLitersSold({
    query: { queryKey: getGetLitersSoldQueryKey(), enabled: isAdmin },
  });
  const { data: litersBalance, isLoading: isLoadingLitersBalance } = useGetLitersBalance({
    query: { queryKey: getGetLitersBalanceQueryKey(), enabled: isAdmin },
  });

  // Formats a Date using ITS OWN local fields (year/month/day), not
  // .toISOString() — that converts to UTC first, which silently rolls a
  // local-midnight date back a calendar day in any timezone ahead of UTC
  // (e.g. IST), making "month start" resolve to the last day of the
  // previous month instead of the 1st.
  const toLocalDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const todayStr = toLocalDateStr(new Date());
  // Calendar week (Monday–Sunday), not a rolling 7-day window — so the
  // "Week" profit figure resets to zero on Monday instead of always
  // showing the trailing 7 days.
  const weekStartStr = (() => {
    const d = new Date();
    const dayOfWeek = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
    return toLocalDateStr(monday);
  })();
  const monthStartStr = (() => {
    const d = new Date();
    return toLocalDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
  })();
  const { lastMonthStartStr, lastMonthEndStr } = (() => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const end = new Date(d.getFullYear(), d.getMonth(), 0);
    return { lastMonthStartStr: toLocalDateStr(start), lastMonthEndStr: toLocalDateStr(end) };
  })();
  const weekProfitParams = { from: weekStartStr, to: todayStr };
  const monthProfitParams = { from: monthStartStr, to: todayStr };
  const lastMonthProfitParams = { from: lastMonthStartStr, to: lastMonthEndStr };
  const { data: weekProfit, isLoading: isLoadingWeekProfit } = useGetProfitLossReport(weekProfitParams, {
    query: { queryKey: getGetProfitLossReportQueryKey(weekProfitParams), enabled: isAdmin },
  });
  const { data: monthProfit, isLoading: isLoadingMonthProfit } = useGetProfitLossReport(monthProfitParams, {
    query: { queryKey: getGetProfitLossReportQueryKey(monthProfitParams), enabled: isAdmin },
  });
  const { data: lastMonthProfit } = useGetProfitLossReport(lastMonthProfitParams, {
    query: { queryKey: getGetProfitLossReportQueryKey(lastMonthProfitParams), enabled: isAdmin },
  });

  const { data: workloadCards } = useListWorkloadCards();

  // Mirrors Manufacturing > Workload's own list: every product flagged "Add
  // for Manufacturing" that's currently below its minimum stock threshold —
  // not just ones that already happen to have a workload_cards row, since a
  // low-stock item with no card yet is still production demand the admin
  // needs to see here.
  const activeCardByProduct = new Map<number, any>();
  (workloadCards ?? [])
    .filter((c: any) => c.status === "pending" || c.status === "processing")
    .forEach((c: any) => {
      const prev = activeCardByProduct.get(c.productId);
      if (!prev || new Date(c.createdAt) > new Date(prev.createdAt)) activeCardByProduct.set(c.productId, c);
    });
  // Raw materials (packaging, base oils, etc.) are never sold directly —
  // notForSale is what distinguishes them from a finished product that also
  // happens to be manufactured in-house. Both flags now come straight from
  // the low-stock response, so the split no longer depends on a separate
  // (and previously incomplete) /products fetch.
  const productLowStockAlerts = (lowStockAlerts ?? []).filter((a: any) => !a.notForSale);
  const rawMaterialLowStockAlerts = (lowStockAlerts ?? []).filter((a: any) => a.notForSale);

  const assembledItems = (lowStockAlerts ?? [])
    .filter((a: any) => a.addForManufacturing)
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
          <Card
            className={capital?.growthBreakdown ? "cursor-pointer select-none" : ""}
            onClick={() => capital?.growthBreakdown && setShowGrowthDetails((v) => !v)}
            data-testid="card-growth"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Growth</CardTitle>
              <div className="flex items-center gap-1">
                {capital?.growthK == null ? (
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                ) : capital.growthK >= 0 ? (
                  <ArrowUpRight className="h-4 w-4 text-green-600" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-red-600" />
                )}
                {capital?.growthBreakdown && (
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${showGrowthDetails ? "rotate-180" : ""}`} />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingCapital || !capital ? (
                <div className="h-8 w-24 bg-muted rounded animate-pulse" />
              ) : capital.growthK == null ? (
                <div className="text-2xl font-bold text-muted-foreground">—</div>
              ) : (
                <>
                <div className={`text-2xl font-bold ${capital.growthK >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-growth-value">
                  {capital.growthK >= 0 ? "+" : ""}
                  {capital.growthK.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  <span className="text-xs text-muted-foreground font-normal ml-1">k</span>
                </div>
                {showGrowthDetails && capital.growthBreakdown && (
                  <div className="mt-2 space-y-0.5 text-[11px]">
                    <div className="text-muted-foreground/70 mb-1">
                      vs {capital.previousDate ?? "previous snapshot"} — why it moved:
                    </div>
                    {capital.growthBreakdown.map((row) => (
                      <div
                        key={row.label}
                        className={`flex justify-between ${row.change < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
                        data-testid={`text-growth-${row.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <span>{row.label}</span>
                        <span className="tabular-nums">
                          {row.change >= 0 ? "+" : "-"}₹{Math.abs(row.change).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Profit</CardTitle>
              <IndianRupee className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="week">
                <TabsList className="h-7">
                  <TabsTrigger value="week" className="text-xs px-2 py-0.5">Week</TabsTrigger>
                  <TabsTrigger value="month" className="text-xs px-2 py-0.5">Month</TabsTrigger>
                </TabsList>
                <TabsContent value="week">
                  {isLoadingWeekProfit || !weekProfit ? (
                    <div className="h-8 w-24 bg-muted rounded animate-pulse" />
                  ) : (
                    <div
                      className={`text-2xl font-bold ${weekProfit.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
                      data-testid="text-profit-week-value"
                    >
                      ₹{weekProfit.netProfit.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="month">
                  {isLoadingMonthProfit || !monthProfit ? (
                    <div className="h-8 w-24 bg-muted rounded animate-pulse" />
                  ) : (
                    <>
                      <div
                        className={`text-2xl font-bold ${monthProfit.netProfit >= 0 ? "text-green-600" : "text-red-600"}`}
                        data-testid="text-profit-month-value"
                      >
                        ₹{monthProfit.netProfit.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </div>
                      {lastMonthProfit && (() => {
                        const diff = monthProfit.netProfit - lastMonthProfit.netProfit;
                        const isUp = diff >= 0;
                        return (
                          <div
                            className={`flex items-center gap-1 text-xs font-medium mt-1 ${isUp ? "text-green-600" : "text-red-600"}`}
                            data-testid="text-profit-growth-value"
                          >
                            {isUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {isUp ? "+" : "-"}₹{Math.abs(diff).toLocaleString("en-IN", { maximumFractionDigits: 0 })} vs last month
                          </div>
                        );
                      })()}
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}

      {isAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Liters Purchased vs Sold</CardTitle>
            <Droplets className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            {isLoadingLitersBalance || !litersBalance ? (
              <div className="h-28 w-full bg-muted rounded animate-pulse" />
            ) : (
              <LitersRing purchased={litersBalance.purchased} sold={litersBalance.sold} />
            )}
          </CardContent>
        </Card>
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

      {/* Workload + low-stock stay on the dashboard — collapsed to a count,
          a tap expands the list inline (no navigating away). */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card
          className="cursor-pointer select-none transition-colors hover:bg-muted/40"
          onClick={() => setShowWorkload((v) => !v)}
          data-testid="card-manufacturing-workload"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Factory className="h-4 w-4 text-primary" /> Manufacturing Workload
            </CardTitle>
            <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${showWorkload ? "rotate-180" : ""}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-workload-count">{assembledItems.length}</div>
            <p className="text-xs text-muted-foreground">
              {assembledItems.length === 0
                ? "All production up to date"
                : `item${assembledItems.length === 1 ? "" : "s"} to manufacture — tap to ${showWorkload ? "hide" : "view"}`}
            </p>
            {showWorkload && assembledItems.length > 0 && (
              <div
                className="mt-3 divide-y rounded-lg border overflow-hidden max-h-72 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {assembledItems.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`workload-item-${c.id}`}>
                    <span className="font-medium truncate">{c.productName}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] uppercase text-muted-foreground">{c.status}</span>
                      <span className="text-xs font-mono">{c.required.toLocaleString()} {c.unit}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer select-none transition-colors hover:bg-muted/40"
          onClick={() => setShowLowStock((v) => !v)}
          data-testid="card-low-stock-detail"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Low Stock Alerts
            </CardTitle>
            <ChevronDown className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${showLowStock ? "rotate-180" : ""}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-low-stock-total">
              {productLowStockAlerts.length + rawMaterialLowStockAlerts.length}
            </div>
            <p className="text-xs text-muted-foreground">
              {productLowStockAlerts.length} product{productLowStockAlerts.length === 1 ? "" : "s"}
              {" · "}
              {rawMaterialLowStockAlerts.length} raw material — tap to {showLowStock ? "hide" : "view"}
            </p>
            {showLowStock && (productLowStockAlerts.length + rawMaterialLowStockAlerts.length) > 0 && (
              <div
                className="mt-3 divide-y rounded-lg border overflow-hidden max-h-72 overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {[...productLowStockAlerts, ...rawMaterialLowStockAlerts].map((a: any) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`low-stock-item-${a.id}`}>
                    <span className="font-medium truncate">{a.name}</span>
                    <span className="text-xs font-mono shrink-0 text-destructive">
                      {a.currentStock} / {a.minStockThreshold} {a.unit}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
