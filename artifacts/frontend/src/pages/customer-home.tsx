import { useState } from "react";
import { Link } from "wouter";
import {
  useGetEntityLedger,
  useListCustomerOrders,
  getListCustomerOrdersQueryKey,
  useGetCustomerOrder,
  type CustomerOrder,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ShoppingCart, PackageCheck, FileText, Wallet, Award, ChevronRight, Loader2,
  ClipboardCheck, Factory, Package, Truck, CheckCircle2, XCircle, PackageOpen,
} from "lucide-react";

// Home screen for the customer portal login (mechanics / retailers). Kept
// deliberately simple: what do I owe, what did I order and where is it, and
// one big button to order again. Labels carry a short Hindi line underneath
// because most of these users read Hindi more comfortably than English.

const inr = (n: number) => `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;

// ─────────────────── order status → simple tracker ───────────────────

const STEPS = [
  { key: "received", en: "Order received", hi: "ऑर्डर मिला", icon: ClipboardCheck },
  { key: "preparing", en: "Being prepared", hi: "तैयार हो रहा है", icon: Factory },
  { key: "packed", en: "Packed", hi: "पैक हो गया", icon: Package },
  { key: "on_the_way", en: "On the way", hi: "रास्ते में", icon: Truck },
  { key: "delivered", en: "Delivered", hi: "पहुँच गया", icon: CheckCircle2 },
] as const;

function stepIndex(status: string): number {
  switch (status) {
    case "pending":
    case "processing":
      return 0;
    case "production":
      return 1;
    case "ready_for_dispatch":
      return 2;
    case "dispatched":
      return 3;
    case "delivered":
    case "done":
      return 4;
    default:
      return -1; // cancelled / unknown
  }
}

function OrderTracker({ status, compact }: { status: string; compact?: boolean }) {
  const idx = stepIndex(status);
  if (idx < 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <XCircle className="w-4 h-4" /> Cancelled · <span className="text-xs">रद्द</span>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const done = i <= idx;
          return (
            <div key={s.key} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
              <div
                className={cn(
                  "grid place-items-center rounded-full shrink-0 transition-colors",
                  compact ? "w-6 h-6" : "w-8 h-8",
                  done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  i === idx && "ring-4 ring-primary/20",
                )}
              >
                <Icon className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("h-1 flex-1 mx-1 rounded-full", i < idx ? "bg-primary" : "bg-muted")} />
              )}
            </div>
          );
        })}
      </div>
      <div className="text-sm font-medium">
        {STEPS[idx].en} <span className="text-muted-foreground font-normal">· {STEPS[idx].hi}</span>
      </div>
    </div>
  );
}

function OrderCard({ order, onOpen }: { order: CustomerOrder; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full text-left" data-testid={`customer-order-${order.id}`}>
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">{order.orderNo ?? `Order #${order.id}`}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(order.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                {" · "}{order.totalItems} item{order.totalItems === 1 ? "" : "s"}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-bold tabular-nums">{inr(order.totalAmount)}</div>
              <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
            </div>
          </div>
          <OrderTracker status={order.status} compact />
        </CardContent>
      </Card>
    </button>
  );
}

function OrderDetailDialog({ orderId, onClose }: { orderId: number | null; onClose: () => void }) {
  const { data: order, isLoading } = useGetCustomerOrder(orderId as number, {
    query: { enabled: orderId != null } as any,
  });
  return (
    <Dialog open={orderId != null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{order?.orderNo ?? "Order"}</DialogTitle>
          <DialogDescription>
            {order ? new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
          </DialogDescription>
        </DialogHeader>
        {isLoading || !order ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <OrderTracker status={order.status} />
            {(order.vehicleNumber || order.driverName) && (
              <div className="rounded-md bg-muted/50 p-3 text-sm flex gap-2">
                <Truck className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  {order.vehicleNumber && <div>Vehicle: <span className="font-medium">{order.vehicleNumber}</span></div>}
                  {order.driverName && <div>Driver: <span className="font-medium">{order.driverName}</span></div>}
                </div>
              </div>
            )}
            {order.adminRemarks && (
              <div className="rounded-md border p-3 text-sm">
                <div className="text-xs text-muted-foreground mb-0.5">Message from shop · दुकान का संदेश</div>
                {order.adminRemarks}
              </div>
            )}
            <div className="divide-y rounded-md border">
              {(order as any).items?.map((it: any) => (
                <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{it.productName}</div>
                    <div className="text-xs text-muted-foreground">{Number(it.qty)} {it.unit ?? ""} × {inr(Number(it.unitPrice))}</div>
                  </div>
                  <div className="tabular-nums font-medium shrink-0">{inr(Number(it.lineTotal))}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between font-semibold">
              <span>Total · कुल</span>
              <span className="tabular-nums">{inr(order.totalAmount)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Final bill amount may change slightly once GST and delivery are added.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useMyOrders() {
  const params = {};
  return useListCustomerOrders(params, {
    query: { queryKey: getListCustomerOrdersQueryKey(params), refetchInterval: 60_000 } as any,
  });
}

// ─────────────────────────── Home ───────────────────────────

export default function CustomerHome() {
  const { user } = useAuth();
  const entityId = (user as any)?.customerId as number | undefined;
  const { data: ledger } = useGetEntityLedger(entityId!, {
    query: { enabled: !!entityId, queryKey: ["ledger", entityId] },
  });
  const { data: orders, isLoading: ordersLoading } = useMyOrders();
  const [openOrder, setOpenOrder] = useState<number | null>(null);

  const list = (Array.isArray(orders) ? orders : []).filter((o) => !o.isDraft);
  const active = list.filter((o) => stepIndex(o.status) >= 0 && stepIndex(o.status) < 4);
  const recent = (active.length > 0 ? active : list).slice(0, 3);
  const outstanding = Number(ledger?.outstandingBalance ?? 0);
  const firstName = (user?.name ?? "").split(" ")[0];

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Namaste{firstName ? `, ${firstName}` : ""} 🙏</h1>
        <p className="text-sm text-muted-foreground">What would you like to do today? · आज क्या करना है?</p>
      </div>

      {/* Big order button */}
      <Link href="/catalog">
        <div
          className="w-full rounded-2xl p-5 text-left text-primary-foreground bg-gradient-to-br from-primary to-primary/75 shadow-lg shadow-primary/25 active:scale-[0.99] transition-transform cursor-pointer"
          data-testid="button-new-order"
        >
          <div className="flex items-center gap-4">
            <div className="grid place-items-center w-14 h-14 rounded-2xl bg-white/20 shrink-0">
              <ShoppingCart className="w-7 h-7" />
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold">Place New Order</div>
              <div className="text-sm opacity-90">नया ऑर्डर दें — products देखें और cart में डालें</div>
            </div>
            <ChevronRight className="w-6 h-6 ml-auto shrink-0" />
          </div>
        </div>
      </Link>

      {/* Balance */}
      {entityId && (
        <Link href="/my-statement">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center gap-4">
              <div className={cn("grid place-items-center w-12 h-12 rounded-xl shrink-0",
                outstanding > 0 ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400")}>
                <Wallet className="w-6 h-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  {outstanding > 0 ? "Amount to pay · बाकी रकम" : outstanding < 0 ? "Advance with shop · जमा रकम" : "Your balance · आपका हिसाब"}
                </div>
                <div className={cn("text-2xl font-bold tabular-nums", outstanding > 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {ledger ? inr(outstanding) : "…"}
                </div>
              </div>
              <div className="text-xs text-primary font-medium flex items-center shrink-0">
                Statement <ChevronRight className="w-4 h-4" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Orders */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            {active.length > 0 ? "Orders in progress" : "Recent orders"}
            <span className="text-muted-foreground font-normal text-sm"> · {active.length > 0 ? "चालू ऑर्डर" : "पिछले ऑर्डर"}</span>
          </h2>
          {list.length > 0 && (
            <Link href="/track-orders" className="text-sm text-primary font-medium">See all</Link>
          )}
        </div>
        {ordersLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : recent.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-1">
              <PackageOpen className="w-8 h-8 mx-auto opacity-40" />
              <div>No orders yet. Tap <b>Place New Order</b> to start.</div>
              <div>अभी कोई ऑर्डर नहीं है।</div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {recent.map((o) => <OrderCard key={o.id} order={o} onOpen={() => setOpenOrder(o.id)} />)}
          </div>
        )}
      </section>

      {/* Other things */}
      <section className="grid grid-cols-3 gap-3">
        <QuickTile href="/my-orders" icon={FileText} en="My Bills" hi="मेरे बिल" color="text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-400" />
        <QuickTile href="/my-statement" icon={Wallet} en="Statement" hi="खाता" color="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-400" />
        <QuickTile href="/rewards" icon={Award} en="Rewards" hi="इनाम" color="text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400" />
      </section>

      <OrderDetailDialog orderId={openOrder} onClose={() => setOpenOrder(null)} />
    </div>
  );
}

function QuickTile({ href, icon: Icon, en, hi, color }: { href: string; icon: typeof FileText; en: string; hi: string; color: string }) {
  return (
    <Link href={href}>
      <Card className="cursor-pointer hover:shadow-md transition-shadow h-full">
        <CardContent className="p-3 flex flex-col items-center text-center gap-1.5">
          <div className={cn("grid place-items-center w-11 h-11 rounded-xl", color)}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="text-sm font-medium leading-tight">{en}</div>
          <div className="text-[11px] text-muted-foreground leading-tight">{hi}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─────────────────────────── All orders ───────────────────────────

export function CustomerOrdersTrack() {
  const { data: orders, isLoading } = useMyOrders();
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  const [tab, setTab] = useState<"active" | "all">("active");
  const list = (Array.isArray(orders) ? orders : []).filter((o) => !o.isDraft);
  const shown = tab === "active" ? list.filter((o) => stepIndex(o.status) >= 0 && stepIndex(o.status) < 4) : list;

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <PackageCheck className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>
          <p className="text-sm text-muted-foreground">Track every order · अपने ऑर्डर कहाँ तक पहुँचे देखें</p>
        </div>
      </div>
      <div className="inline-flex rounded-lg border p-1 bg-muted/40">
        {(["active", "all"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "default" : "ghost"} onClick={() => setTab(t)}>
            {t === "active" ? "In progress · चालू" : "All · सभी"}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground space-y-3">
            <div>{tab === "active" ? "No order in progress right now." : "No orders yet."}</div>
            <Link href="/catalog"><Button><ShoppingCart className="w-4 h-4 mr-2" /> Place New Order</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {shown.map((o) => <OrderCard key={o.id} order={o} onOpen={() => setOpenOrder(o.id)} />)}
        </div>
      )}
      {list.some((o) => o.status === "cancelled") && tab === "all" && (
        <Badge variant="outline" className="text-xs">Cancelled orders are shown in red.</Badge>
      )}
      <OrderDetailDialog orderId={openOrder} onClose={() => setOpenOrder(null)} />
    </div>
  );
}
