// Batch & Expiry (Books & Audit card). Batch no. and expiry entered on a
// purchase bill's items, or as opening batches for stock already on hand.
// What is left of a batch follows the item's stock — selling goes earliest
// expiry first. Server: api-server routes/batches.ts.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListPurchases, useListProducts, getListProductsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";
import { cn } from "@/lib/utils";
import { Plus, Loader2, Receipt, Trash2, Search, AlertTriangle } from "lucide-react";

type Batch = {
  id: number; productId: number; productName: string; unit: string; batchNo: string; mfgDate: string | null; expiryDate: string | null;
  qty: number; left: number; billNo: string | null; daysToExpiry: number | null; state: "expired" | "soon" | "later" | "ok" | "none";
};
type BatchesResponse = { batches: Batch[]; summary: { expired: number; soon: number; later: number } };
type BillItem = {
  purchaseItemId: number; productId: number; productName: string; qty: number; unit: string;
  batch: { batchNo: string; mfgDate: string | null; expiryDate: string | null; qty: number } | null;
};

const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const shortDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Something went wrong");
  return data as T;
}

const STATE: Record<Batch["state"], { label: (b: Batch) => string; cls: string }> = {
  expired: { label: (b) => `Expired ${-(b.daysToExpiry ?? 0)} days ago`, cls: "bg-red-600 text-white hover:bg-red-600" },
  soon: { label: (b) => (b.daysToExpiry === 0 ? "Expires today" : `Expires in ${b.daysToExpiry} days`), cls: "bg-orange-500 text-white hover:bg-orange-500" },
  later: { label: (b) => `Expires in ${b.daysToExpiry} days`, cls: "bg-amber-400 text-black hover:bg-amber-400" },
  ok: { label: () => "OK", cls: "bg-green-600 text-white hover:bg-green-600" },
  none: { label: () => "No expiry", cls: "bg-muted text-muted-foreground hover:bg-muted" },
};

export function BatchesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canEdit = hasRole(["admin"]);
  const [view, setView] = useState<"alerts" | "stock" | "all">("alerts");
  const [search, setSearch] = useState("");
  const [fromBill, setFromBill] = useState(false);
  const [opening, setOpening] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ["batches"], queryFn: () => api<BatchesResponse>("/api/batches") });
  const refresh = () => qc.invalidateQueries({ queryKey: ["batches"] });
  const q = search.trim().toLowerCase();
  const list = (data?.batches ?? [])
    .filter((b) => view === "all" || b.left > 0)
    .filter((b) => view !== "alerts" || b.state === "expired" || b.state === "soon" || b.state === "later")
    .filter((b) => !q || `${b.productName} ${b.batchNo} ${b.billNo ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => (a.expiryDate ?? "9999") < (b.expiryDate ?? "9999") ? -1 : 1);
  const s = data?.summary;

  const remove = async (b: Batch) => {
    if (!window.confirm(`Delete batch ${b.batchNo} of ${b.productName}? Stock is not changed.`)) return;
    try {
      await api(`/api/batches/${b.id}`, { method: "DELETE" });
      refresh();
    } catch (e: any) {
      toast({ title: "Not deleted", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Batch no. and expiry of purchased stock. Sales use up the earliest-expiring batch first.</p>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={() => setOpening(true)} data-testid="button-opening-batch"><Plus className="h-4 w-4 mr-1" />Opening batch</Button>
            <Button onClick={() => setFromBill(true)} data-testid="button-batch-from-bill"><Receipt className="h-4 w-4 mr-1" />From purchase bill</Button>
          </div>
        )}
      </div>

      {s && (
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Expired (in stock)</div><div className={cn("font-semibold", s.expired ? "text-red-600" : "")}>{s.expired}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Expire in 30 days</div><div className={cn("font-semibold", s.soon ? "text-orange-600" : "")}>{s.soon}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">In 31–90 days</div><div className="font-semibold">{s.later}</div></CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {([["alerts", "Expiry alerts"], ["stock", "Batches in stock"], ["all", "All batches"]] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={view === k ? "default" : "outline"} onClick={() => setView(k)}>{label}</Button>
        ))}
        <div className="relative max-w-xs flex-1">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Item, batch or bill" className="pl-8" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading && <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
          {!isLoading && !list.length && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {view === "alerts" ? "No batch in stock expires in the next 90 days." : "No batches yet — add them from a purchase bill."}
            </div>
          )}
          {list.map((b) => {
            const st = STATE[b.state];
            return (
              <div key={b.id} className="p-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3" data-testid={`row-batch-${b.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{b.productName}</span>
                    <span className="text-xs rounded bg-muted px-1.5 py-0.5 font-mono">{b.batchNo}</span>
                    <Badge className={cn("text-[10px]", st.cls)}>{st.label(b)}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.expiryDate ? `Expiry ${shortDate(b.expiryDate)}` : "No expiry date"}
                    {b.mfgDate ? ` · Mfg ${shortDate(b.mfgDate)}` : ""}
                    {b.billNo ? ` · Bill ${b.billNo}` : " · Opening"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                  <span className="text-sm tabular-nums"><b>{qtyFmt(b.left)}</b> <span className="text-muted-foreground">of {qtyFmt(b.qty)} {b.unit} left</span></span>
                  {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete batch" onClick={() => remove(b)}><Trash2 className="h-4 w-4" /></Button>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {fromBill && <FromBillDialog onClose={() => setFromBill(false)} onSaved={() => { setFromBill(false); refresh(); }} />}
      {opening && <OpeningDialog onClose={() => setOpening(false)} onSaved={() => { setOpening(false); refresh(); }} />}
    </div>
  );
}

function FromBillDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: purchases = [] } = useListPurchases();
  const [search, setSearch] = useState("");
  const [billId, setBillId] = useState<number | null>(null);
  const [rows, setRows] = useState<Record<number, { batchNo: string; mfgDate: string; expiryDate: string }>>({});
  const [saving, setSaving] = useState(false);
  const { data: bill, isLoading } = useQuery({
    queryKey: ["batches-bill", billId],
    enabled: !!billId,
    queryFn: () => api<{ id: number; billNo: string; vendorName: string | null; date: string; items: BillItem[] }>(`/api/batches/purchase/${billId}`),
  });
  // Fill the form once per bill — a background refetch must not wipe what was typed.
  useEffect(() => {
    if (!bill) return;
    setRows(Object.fromEntries(bill.items.map((i) => [i.purchaseItemId, {
      batchNo: i.batch?.batchNo ?? "", mfgDate: i.batch?.mfgDate ?? "", expiryDate: i.batch?.expiryDate ?? "",
    }])));
  }, [bill?.id]);
  const q = search.trim().toLowerCase();
  const bills = useMemo(() => (purchases as any[])
    .filter((p) => p.status !== "cancelled")
    .filter((p) => !q || `${p.billNo} ${p.vendorName ?? ""} ${p.vendorBillNo ?? ""}`.toLowerCase().includes(q))
    .slice(0, 30), [purchases, q]);

  const save = async () => {
    if (!bill) return;
    setSaving(true);
    try {
      const out = await api<{ saved: number }>("/api/batches", {
        method: "POST",
        body: JSON.stringify({
          purchaseId: bill.id,
          items: bill.items.map((i) => ({ purchaseItemId: i.purchaseItemId, productId: i.productId, ...rows[i.purchaseItemId] })),
        }),
      });
      toast({ title: `${out.saved} batch${out.saved === 1 ? "" : "es"} saved` });
      onSaved();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bill ? `Batches — bill ${bill.billNo}` : "Pick the purchase bill"}</DialogTitle>
          <DialogDescription>{bill ? `${bill.vendorName ?? ""} · ${bill.date}. Leave a line blank if it has no batch.` : "Batch no. and expiry are entered for each item on the bill."}</DialogDescription>
        </DialogHeader>
        {!billId && (
          <div className="space-y-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill no. or supplier" autoFocus />
            <div className="border rounded-md max-h-72 overflow-y-auto divide-y">
              {bills.map((p) => (
                <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between gap-2" onClick={() => setBillId(p.id)}>
                  <span><span className="font-medium">{p.billNo}</span> <span className="text-muted-foreground">{p.vendorName ?? ""}</span></span>
                  <span className="text-xs text-muted-foreground">{new Date(p.billDate).toLocaleDateString("en-IN")}</span>
                </button>
              ))}
              {!bills.length && <div className="px-3 py-2 text-xs text-muted-foreground">No purchase bill matches.</div>}
            </div>
          </div>
        )}
        {billId && isLoading && <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>}
        {bill && (
          <div className="space-y-3">
            {bill.items.map((i) => {
              const r = rows[i.purchaseItemId] ?? { batchNo: "", mfgDate: "", expiryDate: "" };
              const set = (k: keyof typeof r, v: string) => setRows((rs) => ({ ...rs, [i.purchaseItemId]: { ...r, [k]: v } }));
              const bad = !!(r.mfgDate && r.expiryDate && r.mfgDate > r.expiryDate);
              return (
                <div key={i.purchaseItemId} className="rounded-md border p-2 space-y-2">
                  <div className="text-sm font-medium">{i.productName} <span className="text-xs text-muted-foreground">· {qtyFmt(i.qty)} {i.unit}</span></div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div><Label className="text-xs">Batch no.</Label><Input value={r.batchNo} onChange={(e) => set("batchNo", e.target.value)} /></div>
                    <div><Label className="text-xs">Mfg date</Label><Input type="date" value={r.mfgDate} onChange={(e) => set("mfgDate", e.target.value)} /></div>
                    <div><Label className="text-xs">Expiry date</Label><Input type="date" value={r.expiryDate} onChange={(e) => set("expiryDate", e.target.value)} className={cn(bad && "border-red-500")} /></div>
                  </div>
                  {bad && <p className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Expiry is before the manufacturing date</p>}
                  {!r.batchNo.trim() && r.expiryDate && <p className="text-xs text-amber-600">Enter the batch no. too</p>}
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          {billId && <Button variant="ghost" onClick={() => { setBillId(null); setRows({}); }}>Other bill</Button>}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {bill && (
            <Button onClick={save} disabled={saving || bill.items.some((i) => { const r = rows[i.purchaseItemId]; return !!r && ((!!r.expiryDate && !r.batchNo.trim()) || !!(r.mfgDate && r.expiryDate && r.mfgDate > r.expiryDate)); })}
              data-testid="button-save-bill-batches">
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpeningDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState<{ id: number; name: string; unit: string } | null>(null);
  const [batchNo, setBatchNo] = useState("");
  const [mfgDate, setMfgDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const params = { search: search.trim() };
  const { data: products = [] } = useListProducts(params, { query: { queryKey: getListProductsQueryKey(params), enabled: !product && search.trim().length >= 1 } });

  const save = async () => {
    if (!product) return;
    setSaving(true);
    try {
      await api("/api/batches", { method: "POST", body: JSON.stringify({ items: [{ productId: product.id, batchNo, mfgDate, expiryDate, qty: Number(qty) }] }) });
      toast({ title: "Batch saved" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Opening batch</DialogTitle>
          <DialogDescription>For stock already on hand that came before batches were entered. Stock is not changed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Item</Label>
            {product ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className="font-medium">{product.name}</span>
                <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>Change</Button>
              </div>
            ) : (
              <>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type item name" autoFocus />
                {search.trim() && (
                  <div className="border rounded-md max-h-40 overflow-y-auto divide-y mt-1">
                    {(products as any[]).slice(0, 20).map((p) => (
                      <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => setProduct({ id: p.id, name: p.name, unit: p.unit })}>
                        {p.name} <span className="text-xs text-muted-foreground">{qtyFmt(Number(p.currentStock ?? 0))} {p.unit} in stock</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Batch no.</Label><Input value={batchNo} onChange={(e) => setBatchNo(e.target.value)} /></div>
            <div><Label>Qty{product ? ` (${product.unit})` : ""}</Label><Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" /></div>
            <div><Label>Mfg date</Label><Input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} /></div>
            <div><Label>Expiry date</Label><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !product || !batchNo.trim() || !(Number(qty) > 0)}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
