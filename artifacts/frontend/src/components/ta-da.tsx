// Commission → TA / DA: each salesman's travel (TA) and daily (DA) allowance
// for a period, worked out by their rule (Commission → Settings), with
// travel claims (km / amount per day) and payments. A salesman sees and adds
// only their own.

import React, { useEffect, useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useListEntities } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, CreditCard } from "lucide-react";
import { ruleSummary, type Rule } from "@/components/commission-settings";

interface StatementRow {
  salesmanId: number; salesmanName: string; rule: Rule;
  workingDays: number; bills: number; orders: number; months: number;
  km: number; claimAmount: number; claims: number;
  ta: number; da: number; total: number; paid: number; due: number;
}
interface Claim { id: number; salesmanId: number; salesmanName: string; date: string; km: number; amount: number; note: string | null }
interface Payment { id: number; salesmanName: string; from: string; to: string; ta: number; da: number; total: number; reference: string | null; paidAt: string }

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const fmtD = (s: string) => format(new Date(`${s}T00:00:00`), "dd MMM yyyy");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function monthRange(offset = 0) {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const to = offset === 0 ? d : new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  return { from: ymd(from), to: ymd(to) };
}

export function TaDa() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isStaff = user?.role === "admin" || user?.role === "accountant" || user?.role === "super_admin";
  const [range, setRange] = useState(() => monthRange(0));
  const [rows, setRows] = useState<StatementRow[] | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [paying, setPaying] = useState<StatementRow | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setError(null);
    const q = `from=${range.from}&to=${range.to}`;
    api<{ rows: StatementRow[] }>(`/api/commissions/allowances?${q}`).then((r) => setRows(r.rows)).catch((e) => setError(e.message));
    api<Claim[]>(`/api/commissions/travel-claims?${q}`).then(setClaims).catch(() => setClaims([]));
    api<Payment[]>("/api/commissions/allowance-payments").then(setPayments).catch(() => setPayments([]));
  }, [range.from, range.to, tick]);

  const removeClaim = async (c: Claim) => {
    if (!window.confirm(`Delete the travel claim of ${fmtD(c.date)}?`)) return;
    try {
      await api(`/api/commissions/travel-claims/${c.id}`, { method: "DELETE" });
      setTick((t) => t + 1);
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setRange(monthRange(0))}>This month</Button>
            <Button size="sm" variant="outline" onClick={() => setRange(monthRange(-1))}>Last month</Button>
          </div>
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} data-testid="input-tada-from" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} data-testid="input-tada-to" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">TA / DA for {fmtD(range.from)} – {fmtD(range.to)}</CardTitle>
          <CardDescription>Worked out from each salesman's rule in Settings, their bills / orders and travel claims.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : !rows ? (
            <div className="py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No salesmen.</p>
          ) : (
            <div className="divide-y">
              {rows.map((r) => (
                <div key={r.salesmanId} className="px-4 py-3 space-y-1" data-testid={`row-tada-${r.salesmanId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium break-words">{r.salesmanName}</div>
                      <div className="text-xs text-muted-foreground">{ruleSummary(r.rule)}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold tabular-nums">{inr(r.total)}</div>
                      {r.paid > 0 && <div className="text-[11px] text-emerald-600">Paid {inr(r.paid)}</div>}
                      {r.due > 0.004 && <div className="text-[11px] text-amber-600">Due {inr(r.due)}</div>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{r.workingDays} working day{r.workingDays === 1 ? "" : "s"}</span>
                    <span>{r.bills} bill{r.bills === 1 ? "" : "s"}</span>
                    <span>{r.orders} order{r.orders === 1 ? "" : "s"}</span>
                    {r.km > 0 && <span>{r.km.toLocaleString("en-IN")} km</span>}
                    {r.claimAmount > 0 && <span>Claims {inr(r.claimAmount)}</span>}
                    <span>· DA <b className="text-foreground">{inr(r.da)}</b></span>
                    <span>TA <b className="text-foreground">{inr(r.ta)}</b></span>
                  </div>
                  {isStaff && r.due > 0.004 && (
                    <Button size="sm" variant="outline" onClick={() => setPaying(r)} data-testid={`button-pay-tada-${r.salesmanId}`}>
                      <CreditCard className="w-3.5 h-3.5 mr-1" />Pay {inr(r.due)}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Travel claims</CardTitle>
            <CardDescription>Km travelled or money spent on a day — used for TA per km / actual.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setAdding(true)} data-testid="button-add-travel-claim"><Plus className="w-4 h-4 mr-1" />Add</Button>
        </CardHeader>
        <CardContent className="p-0">
          {!claims ? (
            <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
          ) : claims.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No travel claims in this period.</p>
          ) : (
            <div className="divide-y">
              {claims.map((c) => (
                <div key={c.id} className="px-4 py-2 flex items-start gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{isStaff ? `${c.salesmanName} · ` : ""}{fmtD(c.date)}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.km > 0 && <span>{c.km} km </span>}{c.amount > 0 && <span>{inr(c.amount)} </span>}{c.note && <span>· {c.note}</span>}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive shrink-0" onClick={() => removeClaim(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isStaff && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">TA / DA payments</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!payments || payments.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No TA / DA paid yet.</p>
            ) : (
              <div className="divide-y">
                {payments.slice(0, 100).map((p) => (
                  <div key={p.id} className="px-4 py-2 text-sm flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium break-words">{p.salesmanName}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtD(p.from)} – {fmtD(p.to)} · TA {inr(p.ta)} · DA {inr(p.da)}{p.reference ? ` · ${p.reference}` : ""}
                      </div>
                    </div>
                    <div className="font-semibold tabular-nums shrink-0">{inr(p.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {paying && <PayDialog row={paying} range={range} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); setTick((t) => t + 1); }} />}
      {adding && <ClaimDialog isStaff={isStaff} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setTick((t) => t + 1); }} />}
    </div>
  );
}

function PayDialog({ row, range, onClose, onPaid }: { row: StatementRow; range: { from: string; to: string }; onClose: () => void; onPaid: () => void }) {
  const { toast } = useToast();
  // Pay what is still due, split in the same TA : DA proportion.
  const share = row.total > 0 ? row.due / row.total : 0;
  const [ta, setTa] = useState(String(Math.round(row.ta * share * 100) / 100));
  const [da, setDa] = useState(String(Math.round(row.da * share * 100) / 100));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      await api("/api/commissions/allowances/pay", {
        method: "POST",
        body: JSON.stringify({ salesmanId: row.salesmanId, from: range.from, to: range.to, ta: Number(ta) || 0, da: Number(da) || 0, reference: reference || undefined }),
      });
      toast({ title: `TA / DA paid to ${row.salesmanName}` });
      onPaid();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Pay TA / DA — {row.salesmanName}</DialogTitle>
          <DialogDescription>{fmtD(range.from)} – {fmtD(range.to)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>TA ₹</Label><Input type="number" min="0" step="any" value={ta} onChange={(e) => setTa(e.target.value)} /></div>
          <div className="space-y-1"><Label>DA ₹</Label><Input type="number" min="0" step="any" value={da} onChange={(e) => setDa(e.target.value)} /></div>
          <div className="space-y-1 col-span-2"><Label>Reference (UPI / cash / cheque)</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={pay} disabled={busy || (Number(ta) || 0) + (Number(da) || 0) <= 0} data-testid="button-confirm-pay-tada">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Pay {inr((Number(ta) || 0) + (Number(da) || 0))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClaimDialog({ isStaff, onClose, onSaved }: { isStaff: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { data: salesmen } = useListEntities({ type: "salesman" } as any);
  const [salesmanId, setSalesmanId] = useState("");
  const [date, setDate] = useState(ymd(new Date()));
  const [km, setKm] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api("/api/commissions/travel-claims", {
        method: "POST",
        body: JSON.stringify({ salesmanId: isStaff ? Number(salesmanId) : undefined, date, km: Number(km) || 0, amount: Number(amount) || 0, note }),
      });
      toast({ title: "Travel claim added" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add travel claim</DialogTitle>
          <DialogDescription>Enter km travelled, the amount spent, or both.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {isStaff && (
            <div className="space-y-1 col-span-2">
              <Label>Salesman</Label>
              <Select value={salesmanId} onValueChange={setSalesmanId}>
                <SelectTrigger data-testid="select-claim-salesman"><SelectValue placeholder="Choose salesman" /></SelectTrigger>
                <SelectContent>
                  {(salesmen ?? []).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1 col-span-2"><Label>Date</Label><Input type="date" value={date} max={ymd(new Date())} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-1"><Label>Km</Label><Input type="number" min="0" step="any" value={km} onChange={(e) => setKm(e.target.value)} data-testid="input-claim-km" /></div>
          <div className="space-y-1"><Label>Amount ₹</Label><Input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1 col-span-2"><Label>Note (route, bus / petrol…)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || (isStaff && !salesmanId) || ((Number(km) || 0) <= 0 && (Number(amount) || 0) <= 0)} data-testid="button-save-claim">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
