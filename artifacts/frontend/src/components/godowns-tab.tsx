// Godowns (Books & Audit card): stock kept away from the main store. Billing
// and purchases keep using the main store; a transfer moves stock to / from
// a godown without changing the total. Server: api-server routes/godowns.ts.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";
import { cn } from "@/lib/utils";
import { Plus, Loader2, ArrowRightLeft, Warehouse, Pencil, Trash2, Search } from "lucide-react";

type Godown = { id: number; name: string; address: string | null; isActive: boolean; items: number; qty: number };
type StockRow = { productId: number; name: string; unit: string; total: number; main: number; godowns: Record<string, number> };
type Transfer = { id: number; date: string; from: string; to: string; productName: string; qty: number; note: string | null; createdByName: string | null };

const qtyFmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Something went wrong");
  return data as T;
}

export function GodownsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canEdit = hasRole(["admin"]);
  const [search, setSearch] = useState("");
  const [onlyAway, setOnlyAway] = useState(true);
  const [editing, setEditing] = useState<Partial<Godown> | null>(null);
  const [transferring, setTransferring] = useState(false);

  const { data: godowns = [] } = useQuery({ queryKey: ["godowns"], queryFn: () => api<Godown[]>("/api/godowns") });
  const { data: stock = [], isLoading } = useQuery({ queryKey: ["godowns-stock"], queryFn: () => api<StockRow[]>("/api/godowns/stock") });
  const { data: transfers = [] } = useQuery({ queryKey: ["godowns-transfers"], queryFn: () => api<Transfer[]>("/api/godowns/transfers") });
  const active = godowns.filter((g) => g.isActive);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["godowns"] });
    qc.invalidateQueries({ queryKey: ["godowns-stock"] });
    qc.invalidateQueries({ queryKey: ["godowns-transfers"] });
  };

  const q = search.trim().toLowerCase();
  const rows = stock.filter((r) => (!q || r.name.toLowerCase().includes(q))
    && (!onlyAway || q || Object.keys(r.godowns).length > 0 || r.main < 0));
  const short = stock.filter((r) => r.main < -0.0005).length;

  const saveGodown = async () => {
    if (!editing) return;
    try {
      await api(editing.id ? `/api/godowns/${editing.id}` : "/api/godowns", {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify({ name: editing.name, address: editing.address, isActive: editing.isActive ?? true }),
      });
      toast({ title: editing.id ? "Godown saved" : "Godown added" });
      setEditing(null);
      refresh();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Billing and purchases use the main store. Move stock to a godown and back with a transfer — the total doesn't change.</p>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={() => setEditing({ name: "", address: "" })} data-testid="button-add-godown"><Plus className="h-4 w-4 mr-1" />Godown</Button>
            <Button onClick={() => setTransferring(true)} disabled={!active.length} data-testid="button-transfer-stock"><ArrowRightLeft className="h-4 w-4 mr-1" />Transfer</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Warehouse className="h-3.5 w-3.5" />Main (shop / store)</div>
          <div className={cn("text-sm font-semibold", short ? "text-red-600" : "")}>{short ? `${short} items short` : "All stock here unless moved"}</div>
        </CardContent></Card>
        {godowns.map((g) => (
          <Card key={g.id} className={cn(!g.isActive && "opacity-60")}><CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center justify-between gap-1">
              <span className="flex items-center gap-1 truncate"><Warehouse className="h-3.5 w-3.5 shrink-0" />{g.name}{!g.isActive && " (closed)"}</span>
              {canEdit && <button type="button" className="hover:text-foreground" title="Edit" onClick={() => setEditing(g)}><Pencil className="h-3 w-3" /></button>}
            </div>
            <div className="text-sm font-semibold">{g.items} items · {qtyFmt(g.qty)}</div>
          </CardContent></Card>
        ))}
      </div>
      {!godowns.length && <p className="text-sm text-muted-foreground">No godowns yet. Add one, then transfer stock to it.</p>}
      {short > 0 && (
        <p className="text-xs text-red-600">Main store shows less than 0 for {short} item{short === 1 ? "" : "s"} — more was sold than is left there. Transfer stock back from the godown.</p>
      )}

      {godowns.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-xs flex-1">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item" className="pl-8" />
            </div>
            <Button size="sm" variant={onlyAway ? "default" : "outline"} onClick={() => setOnlyAway((v) => !v)}>
              {onlyAway ? "Items in godowns" : "All items"}
            </Button>
          </div>
          <Card><CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Main</TableHead>
                {active.map((g) => <TableHead key={g.id} className="text-right whitespace-nowrap">{g.name}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={3 + active.length} className="text-center py-6"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>}
                {!isLoading && !rows.length && <TableRow><TableCell colSpan={3 + active.length} className="text-center py-6 text-sm text-muted-foreground">
                  {onlyAway && !q ? "Nothing moved to a godown yet." : "No items."}
                </TableCell></TableRow>}
                {rows.slice(0, 500).map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell className="font-medium">{r.name} <span className="text-xs text-muted-foreground">{r.unit}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{qtyFmt(r.total)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", r.main < 0 && "text-red-600 font-semibold")}>{qtyFmt(r.main)}</TableCell>
                    {active.map((g) => <TableCell key={g.id} className="text-right tabular-nums">{r.godowns[g.id] ? qtyFmt(r.godowns[g.id]) : "—"}</TableCell>)}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </>
      )}

      {transfers.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent transfers</h3>
          <Card><CardContent className="p-0 divide-y">
            {transfers.slice(0, 50).map((t) => (
              <div key={t.id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span className="text-xs text-muted-foreground w-20">{t.date}</span>
                <span className="font-medium">{t.productName}</span>
                <span className="tabular-nums">{qtyFmt(t.qty)}</span>
                <span className="text-muted-foreground">{t.from} → {t.to}</span>
                {t.note && <span className="text-xs text-muted-foreground">· {t.note}</span>}
              </div>
            ))}
          </CardContent></Card>
        </div>
      )}

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{editing.id ? "Edit godown" : "Add godown"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus placeholder="e.g. Back Godown, MIDC Warehouse" /></div>
              <div><Label>Address (optional)</Label><Input value={editing.address ?? ""} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></div>
              {editing.id && (
                <Button type="button" variant="outline" size="sm" className={editing.isActive === false ? "" : "text-destructive"}
                  onClick={() => setEditing({ ...editing, isActive: editing.isActive === false })}>
                  {editing.isActive === false ? "Reopen this godown" : <><Trash2 className="h-4 w-4 mr-1" />Close this godown</>}
                </Button>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveGodown} disabled={!editing.name?.trim()}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {transferring && <TransferDialog godowns={active} stock={stock} onClose={() => setTransferring(false)} onDone={() => { setTransferring(false); refresh(); }} />}
    </div>
  );
}

function TransferDialog({ godowns, stock, onClose, onDone }: { godowns: Godown[]; stock: StockRow[]; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [from, setFrom] = useState("0");
  const [to, setTo] = useState(godowns[0] ? String(godowns[0].id) : "0");
  const [date, setDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Array<{ productId: number; name: string; unit: string; qty: string }>>([]);
  const [saving, setSaving] = useState(false);

  const availableIn = (r: StockRow) => (from === "0" ? r.main : r.godowns[from] ?? 0);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return stock.filter((r) => r.name.toLowerCase().includes(q) && availableIn(r) > 0 && !lines.some((l) => l.productId === r.productId)).slice(0, 15);
  }, [search, stock, from, lines]);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/godowns/transfer", {
        method: "POST",
        body: JSON.stringify({ fromGodownId: Number(from), toGodownId: Number(to), date, note, items: lines.map((l) => ({ productId: l.productId, qty: Number(l.qty) })) }),
      });
      toast({ title: `${lines.length} item${lines.length === 1 ? "" : "s"} transferred` });
      onDone();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const places = [{ id: "0", name: "Main (shop / store)" }, ...godowns.map((g) => ({ id: String(g.id), name: g.name }))];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transfer stock</DialogTitle>
          <DialogDescription>Moves stock between the main store and a godown. Total stock stays the same.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>From</Label>
              <Select value={from} onValueChange={(v) => { setFrom(v); setLines([]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{places.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>To</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{places.filter((p) => p.id !== from).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label>Note (optional)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <div className="space-y-1">
            <Label>Add item</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type item name" />
            {matches.length > 0 && (
              <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                {matches.map((r) => (
                  <button key={r.productId} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between"
                    onClick={() => { setLines((ls) => [...ls, { productId: r.productId, name: r.name, unit: r.unit, qty: "" }]); setSearch(""); }}>
                    <span>{r.name}</span><span className="text-xs text-muted-foreground">{qtyFmt(availableIn(r))} {r.unit} there</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {lines.map((l, i) => {
            const r = stock.find((s) => s.productId === l.productId);
            const avail = r ? availableIn(r) : 0;
            const over = Number(l.qty) > avail + 0.0005;
            return (
              <div key={l.productId} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-sm truncate">{l.name} <span className="text-xs text-muted-foreground">({qtyFmt(avail)} {l.unit})</span></span>
                <Input className={cn("w-24", over && "border-red-500")} value={l.qty} inputMode="decimal" placeholder="Qty"
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !lines.length || from === to || lines.some((l) => !(Number(l.qty) > 0))} data-testid="button-save-transfer">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
