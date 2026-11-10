// Stock Investment — for every item sold in the period: the money that came
// back for it from the market, plus a % of its profit (more for fast items),
// and how much of it that buys again at the last purchase rate. The numbers
// come from GET /api/stock-investment (api-server lib/stock-investment.ts).

import React from "react";
import { Redirect } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PiggyBank, Search, Loader2, Info, Zap } from "lucide-react";

type Speed = "fast" | "normal";
interface Item {
  productId: number; productName: string; itemCode: string | null; unit: string; rawMaterial: boolean;
  speed: Speed; speedSetByOwner: boolean;
  soldQty: number; soldValue: number; collected: number; moneyBack: number; profit: number;
  pct: number; extra: number; invest: number;
  lastRate: number; lastPurchaseDate: string | null; lastSupplier: string | null;
  orderQty: number; stockQty: number; costEstimated: boolean;
}
interface Settings { fastPct: number; normalPct: number; days: number; overrides: Record<string, Speed> }
interface Report {
  from: string; to: string; settings: Settings; items: Item[];
  totals: { collected: number; moneyBack: number; profit: number; extra: number; invest: number; pendingFromCustomers: number };
  cash?: { cashInHand: number; supplierDue: number; investment: number };
}

// Amounts arrive as JSON numbers; a NaN on the server arrives as null, so
// coerce before formatting rather than crash the page.
const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
const rs = (n: unknown) => `₹${num(n).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const qty = (n: unknown) => num(n).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const dmy = (d: string | null) => (d ? d.split("-").reverse().join("-") : "");

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="text-[11px] sm:text-xs text-muted-foreground truncate">{label}</div>
        <div className={`text-base sm:text-xl font-bold font-mono break-all ${tone ?? ""}`}>{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
      </CardContent>
    </Card>
  );
}

async function putSettings(body: object): Promise<Settings> {
  const r = await fetch("/api/stock-investment/settings", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to save");
  return r.json();
}

export default function StockInvestment() {
  // Company admins only — not the platform super_admin, even when switched in.
  const { user } = useAuth();
  const qc = useQueryClient();
  const [range, setRange] = React.useState<{ from: string; to: string } | null>(null);
  const [search, setSearch] = React.useState("");
  const [onlyFast, setOnlyFast] = React.useState(false);
  const [pcts, setPcts] = React.useState<{ fastPct: string; normalPct: string } | null>(null);

  const qs = range ? `?from=${range.from}&to=${range.to}` : "";
  const { data, isLoading, isFetching, error } = useQuery<Report>({
    queryKey: ["/api/stock-investment", qs],
    queryFn: async () => {
      const r = await fetch(`/api/stock-investment${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load");
      return r.json();
    },
  });

  const save = useMutation({
    mutationFn: putSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/stock-investment"] }),
  });

  if (user?.role !== "admin") return <Redirect to="/" />;

  const from = range?.from ?? data?.from ?? "";
  const to = range?.to ?? data?.to ?? "";
  const lastDays = (n: number) => {
    const end = data?.to ?? new Date().toISOString().slice(0, 10);
    const start = new Date(Date.parse(`${end}T00:00:00Z`) - (n - 1) * 86400_000).toISOString().slice(0, 10);
    setRange({ from: start, to: end });
  };

  const s = data?.settings;
  const fastPct = pcts?.fastPct ?? String(s?.fastPct ?? "");
  const normalPct = pcts?.normalPct ?? String(s?.normalPct ?? "");
  const pctsChanged = !!s && (Number(fastPct) !== s.fastPct || Number(normalPct) !== s.normalPct);

  const q = search.trim().toLowerCase();
  const items = (data?.items ?? []).filter((i) =>
    (!q || i.productName.toLowerCase().includes(q) || String(i.itemCode ?? "").toLowerCase().includes(q)) && (!onlyFast || i.speed === "fast"),
  );
  const t = data?.totals;
  const available = num(data?.cash?.investment);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2">
        <PiggyBank className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Stock Investment</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Money the market paid for each item, put back into it with a share of its profit — and how much that buys at the last rate.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <div className="text-xs text-muted-foreground mb-1">From</div>
          <Input type="date" className="w-[150px]" value={from} max={to || undefined} onChange={(e) => e.target.value && setRange({ from: e.target.value, to })} data-testid="input-stock-investment-from" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">To</div>
          <Input type="date" className="w-[150px]" value={to} min={from || undefined} onChange={(e) => e.target.value && setRange({ from, to: e.target.value })} data-testid="input-stock-investment-to" />
        </div>
        {[7, 15, 30].map((n) => (
          <Button key={n} size="sm" variant="outline" onClick={() => lastDays(n)}>{n} days</Button>
        ))}
        {isFetching && !isLoading && <Loader2 className="w-4 h-4 animate-spin mb-2.5" />}
      </div>

      {isLoading ? (
        <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
      ) : error ? (
        <div className="py-10 text-center text-destructive text-sm">{(error as Error).message}</div>
      ) : t && s ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <Stat label="Money from market" value={rs(t.collected)} tone="text-emerald-600" hint={`${rs(t.pendingFromCustomers)} still to collect`} />
            <Stat label="Material money back" value={rs(t.moneyBack)} hint={`Profit ${rs(t.profit)}`} />
            <Stat label="Extra from profit" value={rs(t.extra)} tone="text-blue-600" hint={`Fast ${s.fastPct}% · others ${s.normalPct}%`} />
            <Stat
              label="Invest in stock"
              value={rs(t.invest)}
              tone="text-primary"
              hint={data?.cash ? `Free cash after supplier dues: ${rs(available)}` : undefined}
            />
          </div>
          {data?.cash && t.invest > available + 0.005 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
              Suggested buying ({rs(t.invest)}) is more than the cash left after paying every supplier ({rs(available)}). Pay suppliers first (Supplier Settle), or order the fast items first.
            </div>
          )}

          <Card>
            <CardContent className="p-3 sm:p-4 flex flex-wrap items-end gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Zap className="w-3 h-3" />Fast items: % of profit</div>
                <Input type="number" min={0} max={100} step="0.5" className="w-[110px]" value={fastPct} onChange={(e) => setPcts({ fastPct: e.target.value, normalPct })} data-testid="input-fast-pct" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Other items: % of profit</div>
                <Input type="number" min={0} max={100} step="0.5" className="w-[110px]" value={normalPct} onChange={(e) => setPcts({ fastPct, normalPct: e.target.value })} data-testid="input-normal-pct" />
              </div>
              <Button
                size="sm"
                disabled={!pctsChanged || save.isPending}
                onClick={() => save.mutate({ fastPct: Number(fastPct), normalPct: Number(normalPct) }, { onSuccess: () => setPcts(null) })}
              >
                {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save %"}
              </Button>
              {save.error && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search item" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-stock-investment-search" />
            </div>
            <Button size="sm" variant={onlyFast ? "default" : "outline"} onClick={() => setOnlyFast((v) => !v)}>
              Only fast items
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">No money collected for any item in this period.</div>
          ) : (
            <div className="space-y-2">
              {items.map((i) => (
                <Card key={i.productId} data-testid={`card-stock-investment-${i.productId}`}>
                  <CardContent className="p-3 sm:p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          {i.productName}
                          {i.itemCode && <span className="ml-1 text-xs text-muted-foreground font-normal">{i.itemCode}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1 mt-0.5">
                          {i.speed === "fast" ? (
                            <Badge className="bg-orange-500 hover:bg-orange-500 text-white gap-1"><Zap className="w-3 h-3" />Fast</Badge>
                          ) : (
                            <Badge variant="secondary">Normal</Badge>
                          )}
                          {i.rawMaterial && <Badge variant="outline">Raw material</Badge>}
                          <button
                            type="button"
                            className="text-[11px] text-primary underline disabled:opacity-50"
                            disabled={save.isPending}
                            onClick={() => save.mutate({ speed: { productId: i.productId, speed: i.speed === "fast" ? "normal" : "fast" } })}
                          >
                            Mark {i.speed === "fast" ? "normal" : "fast"}
                          </button>
                          {i.speedSetByOwner && (
                            <button
                              type="button"
                              className="text-[11px] text-muted-foreground underline disabled:opacity-50"
                              disabled={save.isPending}
                              onClick={() => save.mutate({ speed: { productId: i.productId, speed: null } })}
                            >
                              Auto
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[11px] text-muted-foreground">Order</div>
                        <div className="font-mono font-bold text-primary whitespace-nowrap">{i.lastRate > 0 ? `${qty(i.orderQty)} ${i.unit}` : "—"}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">{rs(i.invest)}</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm border-t pt-2">
                      <div className="min-w-0"><div className="text-xs text-muted-foreground">Sold</div><div className="font-mono break-all">{qty(i.soldQty)} {i.unit}</div></div>
                      <div className="min-w-0"><div className="text-xs text-muted-foreground">Collected</div><div className="font-mono text-emerald-600 break-all">{rs(i.collected)}</div></div>
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Money back{i.costEstimated ? "*" : ""}</div>
                        <div className="font-mono break-all">{rs(i.moneyBack)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">+{i.pct}% of profit {rs(i.profit)}</div>
                        <div className="font-mono text-blue-600 break-all">{rs(i.extra)}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">Last rate · in stock</div>
                        <div className="font-mono break-all">{i.lastRate > 0 ? rs(i.lastRate) : "No rate"} · {qty(i.stockQty)}</div>
                      </div>
                    </div>
                    {(i.lastSupplier || i.lastPurchaseDate) && (
                      <div className="text-[11px] text-muted-foreground">
                        Last bought{i.lastSupplier ? ` from ${i.lastSupplier}` : ""}{i.lastPurchaseDate ? ` on ${dmy(i.lastPurchaseDate)}` : ""}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              Only money actually received counts: a sale counts as far as its bill is paid. "Money back" is what that paid part of the item
              cost you (oldest purchase first, incl. GST); invest = money back + {s.fastPct}% of profit for fast items, {s.normalPct}% for the rest.
              Order qty = invest ÷ last purchase rate (incl. GST/freight). A product you make is counted as its raw materials, through its BOM.
              Fast = the top 20% of items by money collected, unless you mark it yourself. Fast items are listed first — order them first.
              {items.some((i) => i.costEstimated) && <> * Some sales of this item had no matching purchase (opening stock), so its purchase price was used.</>}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
