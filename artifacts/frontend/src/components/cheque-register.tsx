// Cheque / PDC register (Books & Audit card). Cheques received and issued,
// post-dated ones waiting for their date; Clear books the payment in the Cash
// Book (customer's bills / supplier's dues), Bounce takes it back.
// Server: api-server routes/cheques.ts.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListAccounts, useListEntities, useListInvoices, getListEntitiesQueryKey, getListInvoicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";
import { cn } from "@/lib/utils";
import { Plus, Loader2, CheckCircle2, XCircle, Undo2, Trash2, Ban, ArrowDownLeft, ArrowUpRight } from "lucide-react";

type Cheque = {
  id: number; direction: "received" | "issued"; entityId: number | null; partyName: string; chequeNo: string; bankName: string | null;
  chequeDate: string; daysToDate: number; amount: number; invoiceNo: string | null; status: "pending" | "cleared" | "bounced" | "cancelled";
  accountName: string | null; receiptNo: string | null; clearedOn: string | null; bouncedOn: string | null; bounceReason: string | null; notes: string | null;
};
type ChequesResponse = { cheques: Cheque[]; summary: { dueNow: number; receivedPending: number; issuedPending: number; bounced: number } };

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};
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

const STATUS_BADGE: Record<Cheque["status"], string> = {
  pending: "bg-amber-500 text-white hover:bg-amber-500",
  cleared: "bg-green-600 text-white hover:bg-green-600",
  bounced: "bg-red-600 text-white hover:bg-red-600",
  cancelled: "bg-muted text-muted-foreground hover:bg-muted",
};

function dueText(c: Cheque) {
  if (c.status !== "pending") return null;
  if (c.daysToDate === 0) return { text: "Due today", cls: "text-amber-700 dark:text-amber-300" };
  if (c.daysToDate < 0) return { text: `${-c.daysToDate} day${c.daysToDate === -1 ? "" : "s"} past date`, cls: "text-red-600 dark:text-red-400" };
  return { text: `In ${c.daysToDate} day${c.daysToDate === 1 ? "" : "s"}`, cls: "text-muted-foreground" };
}

export function ChequeRegisterTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canEdit = hasRole(["admin"]);
  const [status, setStatus] = useState("pending");
  const [direction, setDirection] = useState("all");
  const [adding, setAdding] = useState(false);
  const [clearing, setClearing] = useState<Cheque | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const key = ["cheques", status, direction];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api<ChequesResponse>(`/api/cheques?status=${status}${direction !== "all" ? `&direction=${direction}` : ""}`),
  });

  const act = async (c: Cheque, path: string, body?: any, ok?: string) => {
    setBusy(c.id);
    try {
      await api(`/api/cheques/${c.id}${path}`, { method: path ? "POST" : "DELETE", body: body ? JSON.stringify(body) : undefined });
      if (ok) toast({ title: ok });
      return true;
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
      return false;
    } finally {
      setBusy(null);
      // Clearing / bouncing moves balances, bills and ledgers everywhere.
      qc.invalidateQueries();
    }
  };

  const s = data?.summary;
  const list = data?.cheques ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Cheques received and issued. Post-dated ones wait here until their date; Clear enters the payment.</p>
        {canEdit && <Button onClick={() => setAdding(true)} data-testid="button-add-cheque"><Plus className="h-4 w-4 mr-1" />Add cheque</Button>}
      </div>

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Due now</div><div className={cn("font-semibold", s.dueNow ? "text-amber-600" : "")}>{s.dueNow}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">To receive</div><div className="font-semibold tabular-nums text-green-700 dark:text-green-400">{money(s.receivedPending)}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">To pay</div><div className="font-semibold tabular-nums text-red-600 dark:text-red-400">{money(s.issuedPending)}</div></CardContent></Card>
          <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Bounced</div><div className={cn("font-semibold", s.bounced ? "text-red-600" : "")}>{s.bounced}</div></CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cleared">Cleared</SelectItem>
            <SelectItem value="bounced">Bounced</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Received & issued</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="issued">Issued</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading && <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
          {!isLoading && !list.length && <div className="p-8 text-center text-sm text-muted-foreground">No cheques here.</div>}
          {list.map((c) => {
            const due = dueText(c);
            const inflow = c.direction === "received";
            return (
              <div key={c.id} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center" data-testid={`row-cheque-${c.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums", inflow ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                      {inflow ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}{money(c.amount)}
                    </span>
                    <Badge className={cn("text-[10px] capitalize", STATUS_BADGE[c.status])}>{c.status}</Badge>
                    <span className="text-xs text-muted-foreground">{shortDate(c.chequeDate)}</span>
                    {due && <span className={cn("text-xs font-medium", due.cls)}>{due.text}</span>}
                  </div>
                  <div className="text-sm font-medium">{inflow ? "From" : "To"} {c.partyName}</div>
                  <div className="text-xs text-muted-foreground">
                    Cheque {c.chequeNo}{c.bankName ? ` · ${c.bankName}` : ""}{c.invoiceNo ? ` · bill ${c.invoiceNo}` : ""}
                    {c.status === "cleared" && ` · cleared ${c.clearedOn ? shortDate(c.clearedOn) : ""} in ${c.accountName ?? ""} · ${c.receiptNo ?? ""}`}
                    {c.status === "bounced" && ` · bounced ${c.bouncedOn ? shortDate(c.bouncedOn) : ""}${c.bounceReason ? ` — ${c.bounceReason}` : ""}`}
                    {c.notes ? ` · ${c.notes}` : ""}
                  </div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                    {c.status === "pending" && (
                      <Button size="sm" onClick={() => setClearing(c)} disabled={busy != null} data-testid={`button-clear-cheque-${c.id}`}>
                        <CheckCircle2 className="h-4 w-4 mr-1" />Clear
                      </Button>
                    )}
                    {(c.status === "pending" || c.status === "cleared") && (
                      <Button size="sm" variant="outline" disabled={busy != null} onClick={() => {
                        const reason = window.prompt(c.status === "cleared"
                          ? "Cheque bounced — the payment entered on clearing will be taken back. Reason (optional):"
                          : "Cheque bounced. Reason (optional):", "");
                        if (reason !== null) act(c, "/bounce", { reason }, "Marked bounced");
                      }}>
                        <XCircle className="h-4 w-4 mr-1" />Bounce
                      </Button>
                    )}
                    {c.status === "pending" && (
                      <Button size="icon" variant="ghost" title="Cancel — won't be presented" disabled={busy != null}
                        onClick={() => window.confirm("Cancel this cheque?") && act(c, "/cancel", undefined, "Cancelled")}>
                        <Ban className="h-4 w-4" />
                      </Button>
                    )}
                    {c.status !== "pending" && (
                      <Button size="sm" variant="outline" disabled={busy != null} onClick={() => {
                        if (c.status === "cleared" && !window.confirm("Undo the clearing? The payment it entered will be removed.")) return;
                        act(c, "/undo", undefined, "Back to pending");
                      }}>
                        {busy === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Undo2 className="h-4 w-4 mr-1" />{c.status === "bounced" ? "Present again" : "Undo"}</>}
                      </Button>
                    )}
                    {(c.status === "pending" || c.status === "cancelled") && (
                      <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" title="Delete (entered by mistake)" disabled={busy != null}
                        onClick={() => window.confirm("Delete this cheque?") && act(c, "", undefined, "Deleted")}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {adding && <AddChequeDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["cheques"] }); }} />}
      {clearing && (
        <ClearDialog cheque={clearing} onClose={() => setClearing(null)}
          onClear={async (accountId, date) => { if (await act(clearing, "/clear", { accountId, date }, "Cleared — payment entered")) setClearing(null); }} />
      )}
    </div>
  );
}

function AddChequeDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [direction, setDirection] = useState<"received" | "issued">("received");
  const [search, setSearch] = useState("");
  const [party, setParty] = useState<{ id: number; name: string } | null>(null);
  const [freeName, setFreeName] = useState(false);
  const [invoiceId, setInvoiceId] = useState("none");
  const [chequeNo, setChequeNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [chequeDate, setChequeDate] = useState(todayStr());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const params = { search: search.trim(), type: (direction === "received" ? "customer" : "vendor") as any };
  const { data: matches = [] } = useListEntities(params, {
    query: { queryKey: getListEntitiesQueryKey(params), enabled: !party && !freeName && search.trim().length >= 1 },
  });
  const invParams = { customerId: party?.id };
  const { data: invoices = [] } = useListInvoices(invParams, {
    query: { queryKey: getListInvoicesQueryKey(invParams), enabled: direction === "received" && !!party },
  });
  const openBills = (invoices as any[]).filter((i) => i.status !== "cancelled" && Number(i.balanceDue) > 0
    && !["quotation", "proforma_invoice", "sale_order", "delivery_challan"].includes(i.invoiceType));

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/cheques", {
        method: "POST",
        body: JSON.stringify({
          direction, entityId: party?.id ?? null, partyName: freeName ? search : null, chequeNo, bankName, chequeDate,
          amount: Number(amount), invoiceId: invoiceId !== "none" ? Number(invoiceId) : null, notes,
        }),
      });
      toast({ title: "Cheque added" });
      onSaved();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add cheque</DialogTitle>
          <DialogDescription>A post-dated cheque stays pending until its date — press Clear when it's credited / debited.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            {(["received", "issued"] as const).map((d) => (
              <Button key={d} type="button" size="sm" variant={direction === d ? "default" : "outline"}
                onClick={() => { setDirection(d); setParty(null); setSearch(""); setInvoiceId("none"); }}>
                {d === "received" ? "Received from customer" : "Issued to supplier"}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label>{direction === "received" ? "Customer" : "Supplier"}</Label>
            {party ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className="font-medium">{party.name}</span>
                <Button size="sm" variant="ghost" onClick={() => { setParty(null); setInvoiceId("none"); }}>Change</Button>
              </div>
            ) : (
              <>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={freeName ? "Name on the cheque" : "Type name or mobile"} autoFocus />
                {!freeName && search.trim() && (
                  <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                    {(matches as any[]).slice(0, 20).map((e) => (
                      <button key={e.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => setParty({ id: e.id, name: e.name })}>
                        <span className="font-medium">{e.name}</span> <span className="text-xs text-muted-foreground">{e.mobile}</span>
                      </button>
                    ))}
                    <button type="button" className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-muted" onClick={() => setFreeName(true)}>
                      Not in the list — use "{search.trim()}" as the name
                    </button>
                  </div>
                )}
                {freeName && <button type="button" className="text-xs text-primary" onClick={() => setFreeName(false)}>Pick from customers / suppliers instead</button>}
              </>
            )}
          </div>
          {direction === "received" && party && openBills.length > 0 && (
            <div>
              <Label>Against bill</Label>
              <Select value={invoiceId} onValueChange={setInvoiceId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Oldest bills first (automatic)</SelectItem>
                  {openBills.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.invoiceNo} — {money(Number(i.balanceDue))} due</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Cheque no.</Label><Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} inputMode="numeric" /></div>
            <div><Label>Bank</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC" /></div>
            <div><Label>Cheque date</Label><Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></div>
            <div><Label>Amount (₹)</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" /></div>
          </div>
          <div><Label>Note (optional)</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !(party || (freeName && search.trim())) || !chequeNo.trim() || !(Number(amount) > 0)} data-testid="button-save-cheque">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClearDialog({ cheque, onClose, onClear }: { cheque: Cheque; onClose: () => void; onClear: (accountId: number, date: string) => Promise<void> }) {
  const { data: accounts = [] } = useListAccounts();
  const banks = (accounts as any[]).filter((a) => a.isActive !== false && a.type !== "cash");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const acct = accountId || (banks[0] ? String(banks[0].id) : "");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clear cheque {cheque.chequeNo}</DialogTitle>
          <DialogDescription>
            {money(cheque.amount)} {cheque.direction === "received" ? "from" : "to"} {cheque.partyName} — the payment is entered in the Cash Book on this date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Bank account</Label>
            <Select value={acct} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Pick the bank" /></SelectTrigger>
              <SelectContent>{banks.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Cleared on</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!acct || saving} onClick={async () => { setSaving(true); try { await onClear(Number(acct), date); } finally { setSaving(false); } }} data-testid="button-confirm-clear">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Clear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
