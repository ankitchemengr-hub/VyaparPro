// Supplier Settle — for every supplier: material bought, how much of it was
// sold, how much of that sale the customers have paid, and so how much of the
// supplier's money has come in and should be paid to them first. The numbers
// come from GET /api/supplier-settle (api-server lib/supplier-settle.ts).

import React from "react";
import { Redirect, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Scale, ChevronDown, Search, Loader2, Info } from "lucide-react";

interface ProductRow {
  productId: number; productName: string; unit: string;
  purchasedQty: number; purchasedValue: number;
  soldQty: number; soldValue: number; costOfSold: number;
  collected: number; costOfCollected: number;
  stockQty: number; stockValue: number;
}
interface Totals {
  purchasedValue: number; soldValue: number; costOfSold: number;
  collected: number; costOfCollected: number; profitCollected: number;
  pendingFromCustomers: number; stockValue: number;
  paidToSupplier: number; supplierDue: number; payNow: number;
}
interface SupplierRow extends Totals {
  vendorId: number; vendorName: string; mobile: string | null; products: ProductRow[];
}
interface Report {
  suppliers: SupplierRow[];
  totals: Totals;
  unattributed: { soldQty: number; soldValue: number; collected: number };
}

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

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

export default function SupplierSettle() {
  const { hasRole } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState<number | null>(null);
  const [onlyPayNow, setOnlyPayNow] = React.useState(false);

  const { data, isLoading, error } = useQuery<Report>({
    queryKey: ["/api/supplier-settle"],
    queryFn: async () => {
      const r = await fetch("/api/supplier-settle", { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load");
      return r.json();
    },
  });

  if (!hasRole(["admin", "accountant"])) return <Redirect to="/" />;

  const q = search.trim().toLowerCase();
  const rows = (data?.suppliers ?? []).filter((s) =>
    (!q || s.vendorName.toLowerCase().includes(q) || (s.mobile ?? "").includes(q)) && (!onlyPayNow || s.payNow > 0.005),
  );
  const t = data?.totals;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2">
        <Scale className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Supplier Settle</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Material sold, money collected for it, and what to pay each supplier first.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
      ) : error ? (
        <div className="py-10 text-center text-destructive text-sm">{(error as Error).message}</div>
      ) : t ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4">
            <Stat label="Pay suppliers now" value={rs(t.payNow)} tone="text-red-600" hint="Their share of money already collected" />
            <Stat label="Collected from customers" value={rs(t.collected)} tone="text-emerald-600" hint={`of ${rs(t.soldValue)} sold`} />
            <Stat label="Your profit (collected)" value={rs(t.profitCollected)} tone="text-emerald-700" />
            <Stat label="Still to collect" value={rs(t.pendingFromCustomers)} tone="text-amber-600" hint="Sold, customer not paid yet" />
            <Stat label="Supplier share collected" value={rs(t.costOfCollected)} />
            <Stat label="Paid to suppliers" value={rs(t.paidToSupplier)} />
            <Stat label="Total due to suppliers" value={rs(t.supplierDue)} hint="Same as Khatabook" />
            <Stat label="Unsold stock (cost)" value={rs(t.stockValue)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search supplier" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-supplier-settle-search" />
            </div>
            <Button size="sm" variant={onlyPayNow ? "default" : "outline"} onClick={() => setOnlyPayNow((v) => !v)}>
              Only "pay now"
            </Button>
          </div>

          {rows.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">No suppliers to show.</div>
          ) : (
            <div className="space-y-2">
              {rows.map((s) => {
                const isOpen = open === s.vendorId;
                return (
                  <Card key={s.vendorId} data-testid={`card-supplier-${s.vendorId}`}>
                    <CardContent className="p-3 sm:p-4">
                      <button type="button" className="w-full text-left" onClick={() => setOpen(isOpen ? null : s.vendorId)} aria-expanded={isOpen}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{s.vendorName}</div>
                            <div className="text-xs text-muted-foreground">
                              Sold {rs(s.soldValue)} · collected {rs(s.collected)}
                              {s.pendingFromCustomers > 0.005 && <> · <span className="text-amber-600">{rs(s.pendingFromCustomers)} to collect</span></>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[11px] text-muted-foreground">Pay now</div>
                            <div className={`font-mono font-bold ${s.payNow > 0.005 ? "text-red-600" : "text-muted-foreground"}`}>{rs(s.payNow)}</div>
                          </div>
                          <ChevronDown className={`w-4 h-4 mt-1 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </div>
                      </button>

                      {isOpen && (
                        <div className="mt-3 border-t pt-3 space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                            <div><div className="text-xs text-muted-foreground">Supplier share collected</div><div className="font-mono">{rs(s.costOfCollected)}</div></div>
                            <div><div className="text-xs text-muted-foreground">Already paid</div><div className="font-mono">{rs(s.paidToSupplier)}</div></div>
                            <div><div className="text-xs text-muted-foreground">Total due (Khatabook)</div><div className="font-mono">{rs(s.supplierDue)}</div></div>
                            <div><div className="text-xs text-muted-foreground">Your profit (collected)</div><div className="font-mono text-emerald-700">{rs(s.profitCollected)}</div></div>
                          </div>
                          {s.products.length > 0 && (
                            <div className="overflow-x-auto rounded-md border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Material</TableHead>
                                    <TableHead className="text-right">Bought</TableHead>
                                    <TableHead className="text-right">Sold</TableHead>
                                    <TableHead className="text-right">Collected</TableHead>
                                    <TableHead className="text-right">Supplier share</TableHead>
                                    <TableHead className="text-right">In stock</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {s.products.map((p) => (
                                    <TableRow key={p.productId}>
                                      <TableCell className="font-medium min-w-[140px]">{p.productName}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{qty(p.purchasedQty)} {p.unit}<div className="text-xs text-muted-foreground">{rs(p.purchasedValue)}</div></TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{qty(p.soldQty)} {p.unit}<div className="text-xs text-muted-foreground">{rs(p.soldValue)}</div></TableCell>
                                      <TableCell className="text-right whitespace-nowrap font-mono text-emerald-600">{rs(p.collected)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap font-mono">{rs(p.costOfCollected)}</TableCell>
                                      <TableCell className="text-right whitespace-nowrap">{qty(p.stockQty)} {p.unit}<div className="text-xs text-muted-foreground">{rs(p.stockValue)}</div></TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {s.payNow > 0.005 ? (
                              <Badge variant="destructive">Pay {rs(s.payNow)} to {s.vendorName}</Badge>
                            ) : (
                              <Badge variant="secondary">Nothing to pay from collected money</Badge>
                            )}
                            <Button size="sm" onClick={() => setLocation(`/khatabook?tab=vendor&party=${s.vendorId}`)}>
                              Pay supplier in Khatabook
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground flex gap-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              Sales are matched to suppliers oldest-purchase-first for each product. A sale counts as collected as far as its bill is paid.
              Amounts include GST.
              {data!.unattributed.soldValue > 0.005 && (
                <> Sales of {rs(data!.unattributed.soldValue)} could not be matched to any purchase (opening stock or made in-house) and are not counted for any supplier.</>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
