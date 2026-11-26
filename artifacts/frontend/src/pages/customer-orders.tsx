// Customer Orders: two cards — New Order (customer first, then items) and
// Pending Orders (open orders; a row opens the order on its own page,
// pages/customer-order-detail.tsx). Finished orders aren't listed.
import { useState } from "react";
import { useLocation } from "wouter";
import { useListCustomerOrders } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Inbox, Loader2, Plus, ClipboardList, Search, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/use-auth";
import { useMarkSeen } from "@/lib/seen";
import { useSectionNav, SectionCardGrid, SectionBackBar, type SectionCard } from "@/components/section-cards";
import { NewOrderForm } from "@/components/new-order-form";
import { ORDER_STATUS_LABELS } from "@/pages/customer-order-detail";

const CLOSED: string[] = ["done", "cancelled"];

export default function CustomerOrdersAdmin() {
  const { user } = useAuth();
  const role = user?.role ?? "";
  const canAddOrder = role === "admin" || role === "store" || role === "salesman";
  const [, setLocation] = useLocation();

  const { data: orders, isLoading } = useListCustomerOrders();
  // Opening this page clears the Menu badge (orders seen up to the newest one).
  useMarkSeen("orders", orders?.length ? Math.max(...orders.map((o: any) => o.id)) : null);
  const pending = (orders ?? []).filter((o: any) => !CLOSED.includes(o.status) && !o.isDraft);

  const cards: SectionCard<"new" | "pending">[] = [
    ...(canAddOrder ? [{ key: "new" as const, icon: Plus, title: "New Order", description: "Take an order for a customer: first the customer's details, then the items." }] : []),
    { key: "pending", icon: ClipboardList, title: `Pending Orders${pending.length ? ` (${pending.length})` : ""}`, description: "Orders not yet completed. Tap an order to open it like a bill — items, total, status and Create Invoice." },
  ];
  const { current, open, back } = useSectionNav("/customer-orders", cards);

  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = pending.filter((o: any) =>
    !q || (o.customerName ?? "").toLowerCase().includes(q) || (o.customerMobile ?? "").includes(q) || (o.orderNo ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {!current ? (
        <>
          <div className="flex items-center gap-3">
            <Inbox className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Customer Orders</h1>
          </div>
          <SectionCardGrid cards={cards} onOpen={open} testPrefix="orders" />
        </>
      ) : (
        <SectionBackBar pageName="Customer Orders" card={current} onBack={back} testPrefix="orders" />
      )}

      {current?.key === "new" && <NewOrderForm onDone={() => setLocation("/customer-orders?s=pending", { replace: true })} />}

      {current?.key === "pending" && (
        <div className="space-y-3 max-w-4xl">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, mobile or order no…"
              className="pl-9 h-10"
              data-testid="input-order-search"
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : shown.length === 0 ? (
            <Card>
              <CardContent className="text-center text-muted-foreground py-12">
                {pending.length ? "No order matches the search." : "No pending orders."}
              </CardContent>
            </Card>
          ) : (
            shown.map((o: any) => {
              const badge = ORDER_STATUS_LABELS[o.status] ?? { label: o.status, className: "" };
              const isNew = o.status === "pending";
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setLocation(`/customer-orders/${o.id}`)}
                  className={`w-full text-left rounded-lg border bg-card p-4 flex items-center gap-3 hover:bg-accent hover:border-primary/50 transition-colors ${isNew ? "border-l-4 border-l-amber-500" : ""}`}
                  data-testid={`order-row-${o.id}`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">{o.orderNo ?? `#${o.id}`}</span>
                      <Badge className={`${badge.className} text-[11px] px-1.5 py-0`}>{badge.label}</Badge>
                    </div>
                    <div className="text-base font-semibold leading-tight truncate">{o.customerName}</div>
                    {o.customerMobile && <div className="text-sm text-muted-foreground">{o.customerMobile}</div>}
                  </div>
                  <span className="shrink-0 text-sm font-medium text-primary flex items-center">
                    View <ChevronRight className="w-4 h-4" />
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
