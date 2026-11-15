// Manufacturing → Assemble Item → Assembly History: every Assemble Item run,
// grouped by date with the day's liters, filtered by date / product / worker.
// An admin can edit a run (batches or quantity, date, worker) or delete it;
// raw materials change in the same proportion and the difference in output
// goes to Ready Material (api-server routes/assemblies.ts).

import React, { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useListWorkers } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, History, Loader2, Pencil, Trash2 } from "lucide-react";

export interface AssemblyRun {
  id: number;
  date: string;
  at: string | null;
  productId: number;
  productName: string;
  unit: string;
  qty: number;
  liters: number | null;
  batches: number | null;
  bomId: number | null;
  workerId: number | null;
  workerName: string | null;
}

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const num = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
const dayLabel = (s: string) => format(new Date(`${s}T00:00:00`), "EEE, dd MMM yyyy");

function presetRange(p: "today" | "week" | "month"): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  if (p === "week") from.setDate(from.getDate() - 6);
  if (p === "month") from.setDate(1);
  return { from: ymd(from), to: ymd(today) };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

// The card shown at the top of Assemble Item; opens the history screen.
export function AssemblyHistoryCard({ onOpen }: { onOpen: () => void }) {
  const [today, setToday] = useState<{ runs: number; liters: number } | null>(null);
  useEffect(() => {
    const d = ymd(new Date());
    api<AssemblyRun[]>(`/api/manufacturing/assemblies?from=${d}&to=${d}`)
      .then((rows) => setToday({ runs: rows.length, liters: rows.reduce((s, r) => s + (r.liters ?? 0), 0) }))
      .catch(() => setToday(null));
  }, []);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-lg border bg-card hover:bg-accent transition-colors p-3 sm:p-4 flex items-center gap-3"
      data-testid="card-assembly-history"
    >
      <History className="w-5 h-5 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">Assembly History</div>
        <div className="text-xs text-muted-foreground">
          {today ? `Today: ${today.runs} run${today.runs === 1 ? "" : "s"} · ${num(today.liters)} L` : "Everything assembled so far"} — date-wise, filter and edit
        </div>
      </div>
    </button>
  );
}

export function AssemblyHistory({ onBack }: { onBack: () => void }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const { data: workers } = useListWorkers({});
  const [range, setRange] = useState(() => presetRange("month"));
  const [preset, setPreset] = useState<"today" | "week" | "month" | "custom">("month");
  const [productId, setProductId] = useState("all");
  const [workerId, setWorkerId] = useState("all");
  const [rows, setRows] = useState<AssemblyRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AssemblyRun | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setRows(null);
    setError(null);
    const q = new URLSearchParams({ from: range.from, to: range.to });
    if (workerId !== "all") q.set("workerId", workerId);
    api<AssemblyRun[]>(`/api/manufacturing/assemblies?${q}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [range.from, range.to, workerId, tick]);

  // Product list comes from the runs in the chosen period.
  const products = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rows ?? []) m.set(r.productId, r.productName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const shown = (rows ?? []).filter((r) => productId === "all" || String(r.productId) === productId);
  const days = useMemo(() => {
    const m = new Map<string, AssemblyRun[]>();
    for (const r of shown) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return [...m];
  }, [shown]);
  const totalLiters = shown.reduce((s, r) => s + (r.liters ?? 0), 0);

  const choose = (p: "today" | "week" | "month") => { setPreset(p); setRange(presetRange(p)); };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack} data-testid="button-assembly-history-back">
          <ArrowLeft className="w-4 h-4 mr-1" />Assemble
        </Button>
        <h2 className="text-lg sm:text-xl font-semibold flex items-center gap-2"><History className="w-5 h-5 text-primary" />Assembly History</h2>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["today", "week", "month"] as const).map((p) => (
              <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => choose(p)}>
                {{ today: "Today", week: "Last 7 days", month: "This month" }[p]}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={range.from} max={range.to}
                onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); }} data-testid="input-assembly-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={range.to} min={range.from}
                onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); }} data-testid="input-assembly-to" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger data-testid="select-assembly-product"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map(([id, name]) => <SelectItem key={id} value={String(id)}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Worker</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger data-testid="select-assembly-worker"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workers</SelectItem>
                  {(workers ?? []).map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {rows && (
            <div className="text-sm">
              <span className="font-semibold">{shown.length}</span> run{shown.length === 1 ? "" : "s"}
              {" · "}<span className="font-semibold">{num(totalLiters)} L</span> in this period
            </div>
          )}
        </CardContent>
      </Card>

      {error ? (
        <div className="py-8 text-center text-sm text-destructive">{error}</div>
      ) : !rows ? (
        <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>
      ) : days.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground border border-dashed rounded-lg">Nothing assembled in this period.</div>
      ) : (
        <div className="space-y-3">
          {days.map(([day, list]) => {
            const liters = list.reduce((s, r) => s + (r.liters ?? 0), 0);
            return (
              <Card key={day} data-testid={`assembly-day-${day}`}>
                <CardContent className="p-0">
                  <div className="px-3 sm:px-4 py-2 border-b bg-muted/40 flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold text-sm">{dayLabel(day)}</span>
                    <span className="text-xs text-muted-foreground">
                      {list.length} run{list.length === 1 ? "" : "s"} · <span className="font-semibold text-foreground">{num(liters)} L</span>
                    </span>
                  </div>
                  <div className="divide-y">
                    {list.map((r) => (
                      <div key={r.id} className="px-3 sm:px-4 py-2.5 flex items-start gap-2" data-testid={`assembly-run-${r.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium leading-snug break-words">{r.productName}</div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                            <span><span className="font-mono font-semibold text-foreground">{num(r.qty)} {r.unit}</span></span>
                            {r.liters != null && <span>· <span className="font-mono font-semibold text-foreground">{num(r.liters)} L</span></span>}
                            {r.batches != null && <span>· {num(r.batches)} batch{r.batches === 1 ? "" : "es"}</span>}
                            <span>· {r.workerName ?? "—"}</span>
                            {r.at && <span>· {format(new Date(r.at), "hh:mm a")}</span>}
                          </div>
                        </div>
                        {isAdmin && (
                          <Button size="sm" variant="outline" className="shrink-0 px-2 sm:px-3" onClick={() => setEditing(r)} data-testid={`button-edit-assembly-${r.id}`}>
                            <Pencil className="w-3.5 h-3.5 sm:mr-1" /><span className="hidden sm:inline">Edit</span>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <EditAssemblyDialog
          run={editing}
          workers={workers ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setTick((t) => t + 1); }}
        />
      )}
    </div>
  );
}

function EditAssemblyDialog({ run, workers, onClose, onSaved }: {
  run: AssemblyRun; workers: any[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const byBatches = run.batches != null;
  const [amount, setAmount] = useState(String(byBatches ? run.batches : run.qty));
  const [date, setDate] = useState(run.date);
  const [workerId, setWorkerId] = useState(run.workerId != null ? String(run.workerId) : "");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const value = Number(amount);
  const newQty = byBatches && run.batches ? (run.qty / run.batches) * value : value;
  const valid = Number.isFinite(value) && value > 0 && !!date;

  const done = (title: string) => {
    queryClient.invalidateQueries();
    toast({ title });
    onSaved();
  };

  const save = async () => {
    setBusy("save");
    try {
      const body: Record<string, unknown> = { date };
      if (byBatches) { if (value !== run.batches) body.batches = value; }
      else if (value !== run.qty) body.qty = value;
      if (workerId && Number(workerId) !== run.workerId) body.workerId = Number(workerId);
      await api(`/api/manufacturing/assemblies/${run.id}`, { method: "PATCH", body: JSON.stringify(body) });
      done("Assembly updated");
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    try {
      await api(`/api/manufacturing/assemblies/${run.id}`, { method: "DELETE" });
      done("Assembly deleted");
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug break-words">Edit: {run.productName}</DialogTitle>
          <DialogDescription>
            Made {num(run.qty)} {run.unit}{run.liters != null ? ` (${num(run.liters)} L)` : ""} on {dayLabel(run.date)}.
          </DialogDescription>
        </DialogHeader>
        {confirmDelete ? (
          <div className="space-y-3 text-sm">
            <p>Delete this assembly? The raw materials it used go back to stock and {num(run.qty)} {run.unit} is taken off Ready Material.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={!!busy}>Cancel</Button>
              <Button variant="destructive" onClick={remove} disabled={!!busy} data-testid="button-confirm-delete-assembly">
                {busy === "delete" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Delete
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>{byBatches ? "Batches" : `Quantity (${run.unit})`}</Label>
                <Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-edit-assembly-amount" />
              </div>
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={date} max={ymd(new Date())} onChange={(e) => setDate(e.target.value)} data-testid="input-edit-assembly-date" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Assembled by</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger><SelectValue placeholder={run.workerName ?? "Choose worker"} /></SelectTrigger>
                <SelectContent>
                  {workers.map((w: any) => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {valid && Math.abs(newQty - run.qty) > 1e-9 && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs">
                New output <span className="font-semibold">{num(Math.round(newQty * 1000) / 1000)} {run.unit}</span>
                {" "}({newQty > run.qty ? "+" : ""}{num(Math.round((newQty - run.qty) * 1000) / 1000)}). Raw materials change in the same
                proportion; the difference goes to <Badge variant="secondary" className="text-[10px] px-1 py-0">Ready Material</Badge>.
              </div>
            )}
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={!!busy} data-testid="button-delete-assembly">
                <Trash2 className="w-4 h-4 mr-1" />Delete
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={!!busy}>Cancel</Button>
                <Button onClick={save} disabled={!valid || !!busy} data-testid="button-save-assembly">
                  {busy === "save" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
