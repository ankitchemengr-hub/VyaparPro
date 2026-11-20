// Commission → Settings: how each salesman earns commission (per liter, % of
// the bill, each product's own %, fixed per bill, none) and how TA / DA is
// paid. A salesman without their own rule follows the company default.
// Rules are applied by api-server lib/commission.ts to bills from now on.

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Pencil, Search, RotateCcw, Save } from "lucide-react";

export type Method = "per_liter" | "invoice_percent" | "product_percent" | "per_invoice" | "none";
export interface Rule {
  salesmanId: number;
  method: Method;
  rate: number;
  base: "without_gst" | "with_gst";
  daMode: "none" | "per_day" | "per_order" | "monthly";
  daAmount: number;
  daBasis: "invoices" | "orders" | "both";
  taMode: "none" | "per_km" | "per_day" | "actual";
  taRate: number;
  isDefault: boolean;
}
interface SettingsResponse { default: Rule; salesmen: { id: number; name: string; rule: Rule | null }[] }
interface ProductRate { productId: number; name: string; itemCode: string | null; perLiter: number; percent: number }

export const METHOD_LABEL: Record<Method, string> = {
  per_liter: "Per liter (product's ₹ per liter)",
  invoice_percent: "% of the whole bill",
  product_percent: "Product-wise % (each product's own %)",
  per_invoice: "Fixed ₹ per bill",
  none: "No commission",
};
const DA_LABEL: Record<Rule["daMode"], string> = {
  none: "No DA",
  per_day: "₹ per working day",
  per_order: "₹ per bill / order",
  monthly: "Fixed ₹ per month",
};
const TA_LABEL: Record<Rule["taMode"], string> = {
  none: "No TA",
  per_km: "₹ per km (travel claims)",
  per_day: "₹ per working day",
  actual: "Actual amount (travel claims)",
};
const BASIS_LABEL: Record<Rule["daBasis"], string> = {
  invoices: "Bills made",
  orders: "Orders booked",
  both: "Bills and orders",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function ruleSummary(r: Rule): string {
  const c = r.method === "invoice_percent" ? `${r.rate}% of bill ${r.base === "with_gst" ? "with GST" : "before GST"}`
    : r.method === "product_percent" ? `Product-wise % ${r.base === "with_gst" ? "(with GST)" : "(before GST)"}`
    : r.method === "per_invoice" ? `${inr(r.rate)} per bill`
    : r.method === "none" ? "No commission" : "Per liter";
  const da = r.daMode === "none" ? "" : ` · DA ${inr(r.daAmount)} ${r.daMode === "per_day" ? "/day" : r.daMode === "per_order" ? "/order" : "/month"}`;
  const ta = r.taMode === "none" ? "" : r.taMode === "actual" ? " · TA actual" : ` · TA ${inr(r.taRate)} ${r.taMode === "per_km" ? "/km" : "/day"}`;
  return c + da + ta;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function CommissionSettings() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin" || user?.role === "super_admin";
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ salesmanId: number; name: string; rule: Rule } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api<SettingsResponse>("/api/commissions/settings").then(setData).catch((e) => setError(e.message));
  }, [tick]);

  if (error) return <div className="py-8 text-center text-sm text-destructive">{error}</div>;
  if (!data) return <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How commission can be given</CardTitle>
          <CardDescription>
            <b>Per liter</b>: liters sold × the product's ₹/liter. <b>% of bill</b>: e.g. 0.5% or 2% of the whole bill.
            {" "}<b>Product-wise %</b>: each product has its own %. <b>Fixed per bill</b>: same ₹ on every bill.
            Choose before GST (usual) or with GST. New rules apply to bills from now on; returns take back the same %.
            DA can be per working day, per bill/order or monthly; TA per km, per working day or the actual amount spent.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card data-testid="card-commission-default">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold">Company default</div>
            <div className="text-sm text-muted-foreground">{ruleSummary(data.default)}</div>
            <div className="text-xs text-muted-foreground">For every salesman without their own rule.</div>
          </div>
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing({ salesmanId: 0, name: "Company default", rule: data.default })} data-testid="button-edit-default-rule">
              <Pencil className="w-3.5 h-3.5 mr-1" />Edit
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Salesmen</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.salesmen.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No salesmen yet — add them under Customers / Parties as type Salesman.</p>
          ) : (
            <div className="divide-y">
              {data.salesmen.map((s) => {
                const r = s.rule ?? { ...data.default, salesmanId: s.id, isDefault: true };
                return (
                  <div key={s.id} className="px-4 py-3 flex items-start gap-3" data-testid={`row-salesman-rule-${s.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium break-words">{s.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {ruleSummary(r)} {!s.rule && <Badge variant="secondary" className="ml-1 text-[10px]">Default</Badge>}
                      </div>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 shrink-0">
                        {s.rule && (
                          <Button size="sm" variant="ghost" title="Use the company default"
                            onClick={async () => { await api(`/api/commissions/settings/${s.id}`, { method: "DELETE" }); setTick((t) => t + 1); }}>
                            <RotateCcw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setEditing({ salesmanId: s.id, name: s.name, rule: r })} data-testid={`button-edit-rule-${s.id}`}>
                          <Pencil className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Set</span>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ProductRates canEdit={canEdit} />

      {editing && (
        <RuleDialog
          title={editing.name}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSave={async (rule) => {
            await api(`/api/commissions/settings/${editing.salesmanId}`, { method: "PUT", body: JSON.stringify(rule) });
            setEditing(null);
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

function RuleDialog({ title, rule, onClose, onSave }: { title: string; rule: Rule; onClose: () => void; onSave: (r: Rule) => Promise<void> }) {
  const { toast } = useToast();
  const [r, setR] = useState<Rule>(rule);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((x) => ({ ...x, [k]: v }));
  const numField = (k: "rate" | "daAmount" | "taRate") => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) || 0);
  const save = async () => {
    setBusy(true);
    try {
      await onSave(r);
      toast({ title: "Commission rule saved", description: "Applies to bills from now on." });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const rateLabel = r.method === "invoice_percent" ? "Percent of bill (%)" : r.method === "per_invoice" ? "₹ per bill" : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Commission & TA / DA — {title}</DialogTitle>
          <DialogDescription>Applies to bills from now on; commission already booked stays as it is.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Commission</Label>
            <Select value={r.method} onValueChange={(v) => set("method", v as Method)}>
              <SelectTrigger data-testid="select-commission-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(METHOD_LABEL) as Method[]).map((m) => <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>)}
              </SelectContent>
            </Select>
            {r.method === "per_liter" && <p className="text-xs text-muted-foreground">Set ₹ per liter for each product below (Product rates).</p>}
            {r.method === "product_percent" && <p className="text-xs text-muted-foreground">Set each product's % below (Product rates).</p>}
          </div>
          {(rateLabel || r.method === "product_percent") && (
            <div className="grid grid-cols-2 gap-3">
              {rateLabel && (
                <div className="space-y-1.5">
                  <Label>{rateLabel}</Label>
                  <Input type="number" min="0" step="any" value={r.rate} onChange={numField("rate")} data-testid="input-commission-rate" />
                </div>
              )}
              {r.method !== "per_invoice" && (
                <div className="space-y-1.5">
                  <Label>On amount</Label>
                  <Select value={r.base} onValueChange={(v) => set("base", v as Rule["base"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="without_gst">Before GST</SelectItem>
                      <SelectItem value="with_gst">With GST</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>DA (daily allowance)</Label>
                <Select value={r.daMode} onValueChange={(v) => set("daMode", v as Rule["daMode"])}>
                  <SelectTrigger data-testid="select-da-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(DA_LABEL) as Rule["daMode"][]).map((m) => <SelectItem key={m} value={m}>{DA_LABEL[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {r.daMode !== "none" && (
                <div className="space-y-1.5">
                  <Label>DA ₹</Label>
                  <Input type="number" min="0" step="any" value={r.daAmount} onChange={numField("daAmount")} data-testid="input-da-amount" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>TA (travel)</Label>
                <Select value={r.taMode} onValueChange={(v) => set("taMode", v as Rule["taMode"])}>
                  <SelectTrigger data-testid="select-ta-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TA_LABEL) as Rule["taMode"][]).map((m) => <SelectItem key={m} value={m}>{TA_LABEL[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {(r.taMode === "per_km" || r.taMode === "per_day") && (
                <div className="space-y-1.5">
                  <Label>{r.taMode === "per_km" ? "₹ per km" : "₹ per day"}</Label>
                  <Input type="number" min="0" step="any" value={r.taRate} onChange={numField("taRate")} data-testid="input-ta-rate" />
                </div>
              )}
            </div>
            {(r.daMode === "per_day" || r.daMode === "per_order" || r.taMode === "per_day") && (
              <div className="space-y-1.5">
                <Label>A working day / order counts from</Label>
                <Select value={r.daBasis} onValueChange={(v) => set("daBasis", v as Rule["daBasis"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(BASIS_LABEL) as Rule["daBasis"][]).map((m) => <SelectItem key={m} value={m}>{BASIS_LABEL[m]}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">A working day = a day with at least one bill (or order) by this salesman.</p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy} data-testid="button-save-rule">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductRates({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ProductRate[] | null>(null);
  const [draft, setDraft] = useState<Record<number, { perLiter?: string; percent?: string }>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<ProductRate[]>("/api/commissions/product-rates").then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.itemCode ?? "").toLowerCase().includes(q));
  }, [rows, search]);
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setBusy(true);
    try {
      const rates = Object.entries(draft).map(([id, d]) => ({
        productId: Number(id),
        ...(d.perLiter != null ? { perLiter: Number(d.perLiter) || 0 } : {}),
        ...(d.percent != null ? { percent: Number(d.percent) || 0 } : {}),
      }));
      await api("/api/commissions/product-rates", { method: "PUT", body: JSON.stringify({ rates }) });
      setDraft({});
      await load();
      toast({ title: "Product rates saved" });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Product rates</CardTitle>
        <CardDescription>₹ per liter is used by the "Per liter" rule; % by the "Product-wise %" rule.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product…" className="pl-8" />
          </div>
          {canEdit && dirty && (
            <Button size="sm" onClick={save} disabled={busy} data-testid="button-save-product-rates">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />} Save {Object.keys(draft).length} change(s)
            </Button>
          )}
        </div>
        {!rows ? (
          <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto divide-y rounded-md border">
            {shown.slice(0, 300).map((p) => {
              const d = draft[p.productId] ?? {};
              return (
                <div key={p.productId} className="px-3 py-2 flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="text-sm font-medium break-words">{p.name}</div>
                    {p.itemCode && <div className="text-[11px] text-muted-foreground font-mono">{p.itemCode}</div>}
                  </div>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    ₹/L
                    <Input type="number" min="0" step="any" className="h-8 w-20" disabled={!canEdit}
                      value={d.perLiter ?? String(p.perLiter)}
                      onChange={(e) => setDraft((x) => ({ ...x, [p.productId]: { ...x[p.productId], perLiter: e.target.value } }))} />
                  </label>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    %
                    <Input type="number" min="0" max="100" step="any" className="h-8 w-20" disabled={!canEdit}
                      value={d.percent ?? String(p.percent)}
                      onChange={(e) => setDraft((x) => ({ ...x, [p.productId]: { ...x[p.productId], percent: e.target.value } }))}
                      data-testid={`input-product-percent-${p.productId}`} />
                  </label>
                </div>
              );
            })}
            {shown.length > 300 && <p className="p-2 text-xs text-muted-foreground">Showing 300 of {shown.length} — search to narrow.</p>}
            {shown.length === 0 && <p className="p-4 text-sm text-muted-foreground text-center">No products match.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
