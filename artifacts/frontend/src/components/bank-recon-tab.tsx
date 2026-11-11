// Bank Reconciliation (Books & Audit card): upload a bank statement (PDF / Excel / CSV), see each
// line matched to the books — OK the suggestions, link the unknown ones
// (Suspense) to a customer, supplier, expense, transfer or anything else.
// Server: api-server routes/bank-recon.ts + lib/bank-recon.ts.

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListAccounts, useListEntities, useListInvoices, useListExpenseCategories,
  getListEntitiesQueryKey, getListInvoicesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";
import { cn } from "@/lib/utils";
import { parseStatementFile, StatementPasswordError, type StatementRow } from "@/lib/bank-statement";
import {
  Upload, Loader2, Check, CheckCheck, Link2, EyeOff, Undo2, Trash2, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, AlertTriangle,
} from "lucide-react";

type Suggestion = {
  kind: "existing" | "party" | "expense" | "transfer" | "other";
  label: string; confidence: "high" | "medium";
  accountTxnId?: number; entityId?: number; entityName?: string; entityType?: string; invoiceId?: number; invoiceNo?: string;
  categoryName?: string; otherAccountId?: number; partyName?: string;
};
type Line = {
  id: number; date: string; description: string; refNo: string | null; debit: number; credit: number; balance: number | null;
  status: "pending" | "matched" | "ignored"; matchedKind: string | null; matchedLabel: string | null; matchedByName: string | null;
  receiptNo: string | null; suggestion: Suggestion | null;
};
type LinesResponse = {
  lines: Line[];
  summary: { open: number; matched: number; ignored: number; bookBalance: number | null; statementBalance: number | null; statementBalanceDate: string | null };
};

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Something went wrong");
  return data as T;
}

function Amount({ line }: { line: { debit: number; credit: number } }) {
  const inflow = line.credit > 0;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold tabular-nums whitespace-nowrap", inflow ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
      {inflow ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
      {money(inflow ? line.credit : line.debit)}
    </span>
  );
}

export function BankReconTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canEdit = hasRole(["admin"]);
  const { data: accounts = [] } = useListAccounts();
  const bankAccounts = accounts.filter((a: any) => a.isActive !== false && (a.type === "bank" || a.type === "upi"));
  const [accountId, setAccountId] = useState<string>("");
  const acctId = accountId || (bankAccounts[0] ? String(bankAccounts[0].id) : "");
  const [tab, setTab] = useState<"suggested" | "suspense" | "done" | "ignored">("suggested");
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [linking, setLinking] = useState<Line | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const key = ["bank-recon-lines", acctId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    enabled: !!acctId,
    queryFn: () => api<LinesResponse>(`/api/bank-recon/lines?accountId=${acctId}&status=all`),
  });
  const lines = data?.lines ?? [];
  const groups = useMemo(() => ({
    suggested: lines.filter((l) => l.status === "pending" && l.suggestion),
    suspense: lines.filter((l) => l.status === "pending" && !l.suggestion),
    done: lines.filter((l) => l.status === "matched"),
    ignored: lines.filter((l) => l.status === "ignored"),
  }), [lines]);

  // A booking moves balances, bills and ledgers all over the app.
  const refreshAll = () => qc.invalidateQueries();

  const run = async (id: number | "all", fn: () => Promise<any>, ok?: string) => {
    setBusy(id);
    try {
      const out = await fn();
      if (ok) toast({ title: ok });
      return out;
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(null);
      refreshAll();
    }
  };

  const confirm = (l: Line, action: any) =>
    run(l.id, () => api(`/api/bank-recon/lines/${l.id}/confirm`, { method: "POST", body: JSON.stringify({ action }) }), "Done");
  const okAll = () => run("all", async () => {
    const out = await api<{ done: number; results: Array<{ ok: boolean; error?: string }> }>("/api/bank-recon/confirm-many", {
      method: "POST", body: JSON.stringify({ items: groups.suggested.map((l) => ({ lineId: l.id, action: l.suggestion })) }),
    });
    const failed = out.results.filter((r) => !r.ok);
    toast({
      title: `${out.done} entries done`,
      description: failed.length ? `${failed.length} could not be saved: ${failed[0].error}` : undefined,
      variant: failed.length ? "destructive" : undefined,
    });
  });

  const s = data?.summary;
  const diff = s && s.statementBalance != null && s.bookBalance != null ? Math.round((s.bookBalance - s.statementBalance) * 100) / 100 : null;
  const shown = groups[tab];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">Upload the bank statement, OK the matched entries and link the rest.</p>
        <div className="flex items-center gap-2">
          <Select value={acctId} onValueChange={(v) => setAccountId(v)}>
            <SelectTrigger className="w-[200px]" data-testid="select-bank-account"><SelectValue placeholder="Bank account" /></SelectTrigger>
            <SelectContent>
              {bankAccounts.map((a: any) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {canEdit && (
            <Button onClick={() => setUploadOpen(true)} disabled={!acctId} data-testid="button-upload-statement">
              <Upload className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Upload Statement</span>
            </Button>
          )}
        </div>
      </div>

      {!bankAccounts.length && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Add your bank account first in <b>Accounts</b> (type Bank or UPI), then upload its statement here.
        </CardContent></Card>
      )}

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Bank says{s.statementBalanceDate ? ` (${shortDate(s.statementBalanceDate)})` : ""}</div>
            <div className="font-semibold tabular-nums">{s.statementBalance != null ? money(s.statementBalance) : "—"}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Books say (today)</div>
            <div className="font-semibold tabular-nums">{s.bookBalance != null ? money(s.bookBalance) : "—"}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Difference</div>
            <div className={cn("font-semibold tabular-nums", diff != null && Math.abs(diff) > 0.009 ? "text-amber-600" : "text-green-700 dark:text-green-400")}>
              {diff == null ? "—" : Math.abs(diff) <= 0.009 ? "Matched ✓" : `${diff > 0 ? "Books" : "Bank"} higher by ${money(Math.abs(diff))}`}
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">To do</div>
            <div className="font-semibold">{groups.suggested.length + groups.suspense.length} <span className="text-xs font-normal text-muted-foreground">of {lines.length}</span></div>
          </CardContent></Card>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="suggested" data-testid="tab-suggested">Matched ({groups.suggested.length})</TabsTrigger>
            <TabsTrigger value="suspense" data-testid="tab-suspense">
              Suspense ({groups.suspense.length})
            </TabsTrigger>
            <TabsTrigger value="done">Done ({groups.done.length})</TabsTrigger>
            <TabsTrigger value="ignored">Ignored ({groups.ignored.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        {canEdit && tab === "suggested" && groups.suggested.length > 0 && (
          <Button size="sm" onClick={okAll} disabled={busy != null} data-testid="button-ok-all">
            {busy === "all" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCheck className="h-4 w-4 mr-1" />}OK all {groups.suggested.length}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        {tab === "suggested" && "Entries the system matched with a bill, a party or the Cash Book. Check and press OK — the payment is entered and the bill cleared."}
        {tab === "suspense" && "Money in or out the system could not place. Press Link and choose whose it is."}
        {tab === "done" && "Entries already in the books. Undo removes what was entered from the statement."}
        {tab === "ignored" && "Lines you chose not to enter (e.g. already handled another way)."}
      </p>

      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading && <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
          {!isLoading && !shown.length && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {lines.length ? "Nothing here." : "No statement uploaded for this account yet."}
            </div>
          )}
          {shown.map((l) => (
            <div key={l.id} className="p-3 flex flex-col gap-2 sm:flex-row sm:items-center" data-testid={`row-bank-line-${l.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{shortDate(l.date)}</span>
                  <Amount line={l} />
                  {l.balance != null && <span className="text-[11px] text-muted-foreground tabular-nums">Bal {money(l.balance)}</span>}
                </div>
                <div className="text-sm break-words">{l.description || <span className="text-muted-foreground">—</span>}</div>
                {l.status === "pending" && l.suggestion && (
                  <div className="mt-1 text-xs flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className={cn("text-[10px]", l.suggestion.confidence === "high" ? "border-green-600 text-green-700 dark:text-green-400" : "border-amber-500 text-amber-700 dark:text-amber-300")}>
                      {l.suggestion.confidence === "high" ? "Sure" : "Check"}
                    </Badge>
                    <span className="font-medium">{l.suggestion.label}</span>
                  </div>
                )}
                {l.status !== "pending" && l.matchedLabel && (
                  <div className="mt-1 text-xs text-muted-foreground">{l.matchedLabel}{l.matchedByName ? ` · by ${l.matchedByName}` : ""}</div>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                  {l.status === "pending" && l.suggestion && (
                    <Button size="sm" onClick={() => confirm(l, l.suggestion)} disabled={busy != null} data-testid={`button-ok-${l.id}`}>
                      {busy === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1" />OK</>}
                    </Button>
                  )}
                  {l.status === "pending" && (
                    <Button size="sm" variant={l.suggestion ? "outline" : "default"} onClick={() => setLinking(l)} disabled={busy != null} data-testid={`button-link-${l.id}`}>
                      <Link2 className="h-4 w-4 mr-1" />{l.suggestion ? "Change" : "Link"}
                    </Button>
                  )}
                  {l.status === "pending" && (
                    <Button size="icon" variant="ghost" title="Ignore — don't enter this line" onClick={() => run(l.id, () => api(`/api/bank-recon/lines/${l.id}/ignore`, { method: "POST" }))} disabled={busy != null}>
                      <EyeOff className="h-4 w-4" />
                    </Button>
                  )}
                  {l.status !== "pending" && (
                    <Button size="sm" variant="outline" onClick={() => {
                      if (l.status === "matched" && l.matchedKind !== "existing" && !window.confirm("Undo removes the payment / expense / transfer that was entered from this line. Continue?")) return;
                      run(l.id, () => api(`/api/bank-recon/lines/${l.id}/undo`, { method: "POST" }), "Back in the list");
                    }} disabled={busy != null} data-testid={`button-undo-${l.id}`}>
                      <Undo2 className="h-4 w-4 mr-1" />{l.status === "ignored" ? "Restore" : "Undo"}
                    </Button>
                  )}
                  {l.status !== "matched" && (
                    <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" title="Remove this line (read wrongly from the file)"
                      onClick={() => window.confirm("Remove this line from the statement?") && run(l.id, () => api(`/api/bank-recon/lines/${l.id}`, { method: "DELETE" }))} disabled={busy != null}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {uploadOpen && acctId && (
        <UploadDialog accountId={Number(acctId)} onClose={() => setUploadOpen(false)} onImported={() => {
          setUploadOpen(false); setTab("suggested"); qc.refetchQueries({ queryKey: key }); refreshAll();
        }} />
      )}
      {linking && (
        <LinkDialog line={linking} accountId={Number(acctId)} accounts={accounts as any[]} onClose={() => setLinking(null)}
          onLink={async (action) => { if (await confirm(linking, action)) setLinking(null); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function UploadDialog({ accountId, onClose, onImported }: { accountId: number; onClose: () => void; onImported: () => void }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needPassword, setNeedPassword] = useState(false);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<StatementRow[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [check, setCheck] = useState<{ added: number; duplicates: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const read = async (f: File, pw?: string) => {
    setReading(true);
    setRows(null);
    setCheck(null);
    try {
      const out = await parseStatementFile(f, pw);
      setNeedPassword(false);
      if (!out.rows.length) {
        toast({ title: "No entries found", description: "Could not find dated entries with amounts in this file. Try the Excel/CSV download from net banking.", variant: "destructive" });
        return;
      }
      setRows(out.rows);
      setSkipped(out.skipped);
      const pre = await api<{ added: number; duplicates: number }>("/api/bank-recon/import", {
        method: "POST", body: JSON.stringify({ accountId, rows: out.rows, fileName: f.name, dryRun: true }),
      });
      setCheck(pre);
    } catch (e: any) {
      if (e instanceof StatementPasswordError) {
        setNeedPassword(true);
        if (e.wrong) toast({ title: "Wrong password", variant: "destructive" });
      } else {
        toast({ title: "Could not read this file", description: e?.message, variant: "destructive" });
      }
    } finally {
      setReading(false);
    }
  };

  const flip = (i: number) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, debit: r.credit, credit: r.debit, unsure: false } : r)));
  const drop = (i: number) => setRows((rs) => rs && rs.filter((_, j) => j !== i));

  const save = async () => {
    if (!rows || !file) return;
    setSaving(true);
    try {
      const out = await api<{ added: number; duplicates: number }>("/api/bank-recon/import", {
        method: "POST", body: JSON.stringify({ accountId, rows, fileName: file.name, dryRun: false }),
      });
      toast({ title: `${out.added} entries added`, description: out.duplicates ? `${out.duplicates} were already uploaded earlier` : undefined });
      onImported();
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const unsure = rows?.filter((r) => r.unsure).length ?? 0;
  const totIn = rows?.reduce((a, r) => a + r.credit, 0) ?? 0;
  const totOut = rows?.reduce((a, r) => a + r.debit, 0) ?? 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload bank statement</DialogTitle>
          <DialogDescription>PDF (from net banking, not a scan), Excel or CSV. The file is read on this device; only the entries are saved.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); setPassword(""); read(f); } }} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={reading} data-testid="button-choose-statement">
            {reading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {file ? file.name : "Choose file"}
          </Button>

          {needPassword && file && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label>PDF password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Bank statement password" autoFocus
                  onKeyDown={(e) => e.key === "Enter" && password && read(file, password)} />
              </div>
              <Button onClick={() => read(file, password)} disabled={!password || reading}>Open</Button>
            </div>
          )}

          {rows && (
            <>
              <div className="text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span><b>{rows.length}</b> entries</span>
                <span className="text-green-700 dark:text-green-400">In {money(totIn)}</span>
                <span className="text-red-600 dark:text-red-400">Out {money(totOut)}</span>
                {check && <span className="text-muted-foreground">{check.added} new{check.duplicates ? ` · ${check.duplicates} already uploaded` : ""}</span>}
                {skipped > 0 && <span className="text-muted-foreground">{skipped} lines skipped (no date / amount)</span>}
              </div>
              {unsure > 0 && (
                <div className="text-xs rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  {unsure} entries could not be read as money in or out for sure (marked). Tap <ArrowLeftRight className="inline h-3 w-3" /> to switch one.
                </div>
              )}
              <div className="border rounded-md divide-y max-h-[45vh] overflow-y-auto">
                {rows.map((r, i) => (
                  <div key={i} className={cn("px-2 py-1.5 flex items-center gap-2 text-sm", r.unsure && "bg-amber-50 dark:bg-amber-950/30")}>
                    <span className="text-xs text-muted-foreground w-16 shrink-0">{shortDate(r.date)}</span>
                    <span className="flex-1 min-w-0 truncate" title={r.description}>{r.description || "—"}</span>
                    <Amount line={r} />
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Switch money in / out" onClick={() => flip(i)}><ArrowLeftRight className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Leave out" onClick={() => drop(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!rows?.length || saving || check?.added === 0} data-testid="button-import-statement">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {check?.added === 0 ? "All already uploaded" : `Import ${check?.added ?? rows?.length ?? 0} entries`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

type LinkKind = "customer" | "supplier" | "expense" | "transfer" | "other";

function LinkDialog({ line, accountId, accounts, onClose, onLink }: {
  line: Line; accountId: number; accounts: any[]; onClose: () => void; onLink: (action: any) => Promise<void>;
}) {
  const inflow = line.credit > 0;
  const sug = line.suggestion;
  const [kind, setKind] = useState<LinkKind>(
    sug?.kind === "party" ? (sug.entityType === "vendor" ? "supplier" : "customer")
      : sug?.kind === "expense" ? "expense" : sug?.kind === "transfer" ? "transfer" : sug?.kind === "other" ? "other"
      : inflow ? "customer" : "supplier",
  );
  const [search, setSearch] = useState("");
  const [party, setParty] = useState<{ id: number; name: string; type: string } | null>(
    sug?.kind === "party" && sug.entityId ? { id: sug.entityId, name: sug.entityName ?? "", type: sug.entityType ?? "customer" } : null,
  );
  const [invoiceId, setInvoiceId] = useState<string>(sug?.invoiceId ? String(sug.invoiceId) : "auto");
  const [categoryId, setCategoryId] = useState<string>("");
  const [newCategory, setNewCategory] = useState(sug?.categoryName ?? "");
  const [otherAccountId, setOtherAccountId] = useState<string>(sug?.otherAccountId ? String(sug.otherAccountId) : "");
  const [partyName, setPartyName] = useState(sug?.partyName ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const entityType = kind === "supplier" ? "vendor" : "customer";
  const params = { search: search.trim(), type: entityType as any };
  const { data: matches = [] } = useListEntities(params, {
    query: { queryKey: getListEntitiesQueryKey(params), enabled: (kind === "customer" || kind === "supplier") && !party && search.trim().length >= 1 },
  });
  const invParams = { customerId: party?.id };
  const { data: invoices = [] } = useListInvoices(invParams, {
    query: { queryKey: getListInvoicesQueryKey(invParams), enabled: kind === "customer" && inflow && !!party },
  });
  const openBills = (invoices as any[]).filter((i) => i.status !== "cancelled" && Number(i.balanceDue) > 0
    && !["quotation", "proforma_invoice", "sale_order", "delivery_challan"].includes(i.invoiceType));
  const { data: categories = [] } = useListExpenseCategories({ query: { enabled: kind === "expense" } as any });
  const otherAccounts = accounts.filter((a) => a.id !== accountId && a.isActive !== false);

  const kinds: Array<{ k: LinkKind; label: string }> = [
    { k: "customer", label: inflow ? "Customer paid" : "Refund to customer" },
    { k: "supplier", label: inflow ? "Refund from supplier" : "Paid supplier" },
    ...(!inflow ? [{ k: "expense" as const, label: "Expense" }] : []),
    { k: "transfer", label: inflow ? "From my other account" : "To my other account" },
    { k: "other", label: inflow ? "Other income / capital / loan" : "Other payment" },
  ];

  const action = (): any => {
    if (kind === "customer" || kind === "supplier") return party ? { kind: "party", entityId: party.id, invoiceId: invoiceId !== "auto" ? Number(invoiceId) : null } : null;
    if (kind === "expense") return categoryId ? { kind: "expense", categoryId: Number(categoryId) } : newCategory.trim() ? { kind: "expense", categoryName: newCategory.trim() } : null;
    if (kind === "transfer") return otherAccountId ? { kind: "transfer", otherAccountId: Number(otherAccountId) } : null;
    return { kind: "other", partyName: partyName.trim() || null, note: note.trim() || null };
  };
  const ready = !!action();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Whose money is this?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              <div className="flex items-center gap-2"><span>{shortDate(line.date)}</span><Amount line={line} /></div>
              <div className="text-foreground break-words">{line.description}</div>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {kinds.map(({ k, label }) => (
              <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} onClick={() => { setKind(k); setParty(null); setSearch(""); setInvoiceId("auto"); }}>
                {label}
              </Button>
            ))}
          </div>

          {(kind === "customer" || kind === "supplier") && (
            <div className="space-y-2">
              <Label>{kind === "customer" ? "Customer" : "Supplier"}</Label>
              {party ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span className="font-medium">{party.name}</span>
                  <Button size="sm" variant="ghost" onClick={() => { setParty(null); setInvoiceId("auto"); }}>Change</Button>
                </div>
              ) : (
                <>
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type name or mobile" autoFocus data-testid="input-link-party" />
                  {search.trim() && (
                    <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                      {(matches as any[]).slice(0, 30).map((e) => (
                        <button key={e.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => setParty({ id: e.id, name: e.name, type: e.type })}>
                          <span className="font-medium">{e.name}</span> <span className="text-xs text-muted-foreground">{e.mobile}</span>
                          {Number(e.outstandingBalance ?? 0) !== 0 && <span className="text-xs text-muted-foreground"> · bal {money(Number(e.outstandingBalance))}</span>}
                        </button>
                      ))}
                      {!(matches as any[]).length && <div className="px-3 py-2 text-xs text-muted-foreground">No match</div>}
                    </div>
                  )}
                </>
              )}
              {kind === "customer" && inflow && party && (
                <div>
                  <Label>Against bill</Label>
                  <Select value={invoiceId} onValueChange={setInvoiceId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Oldest bills first (automatic)</SelectItem>
                      {openBills.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.invoiceNo} — {money(Number(i.balanceDue))} due</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {kind === "expense" && (
            <div className="space-y-2">
              <Label>Expense category</Label>
              <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setNewCategory(""); }}>
                <SelectTrigger><SelectValue placeholder="Pick a category" /></SelectTrigger>
                <SelectContent>
                  {(categories as any[]).filter((c) => c.isActive !== false).map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={newCategory} onChange={(e) => { setNewCategory(e.target.value); setCategoryId(""); }} placeholder="…or type a new category, e.g. Bank Charges" />
            </div>
          )}

          {kind === "transfer" && (
            <div className="space-y-2">
              <Label>{inflow ? "Money came from" : "Money went to"}</Label>
              <Select value={otherAccountId} onValueChange={setOtherAccountId}>
                <SelectTrigger><SelectValue placeholder="Pick the account" /></SelectTrigger>
                <SelectContent>
                  {otherAccounts.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === "other" && (
            <div className="space-y-2">
              <Label>Name (optional)</Label>
              <Input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder={inflow ? "e.g. Owner capital, Loan from bank" : "e.g. Owner drawings"} />
              <Label>Note (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!ready || saving} onClick={async () => { setSaving(true); try { await onLink(action()); } finally { setSaving(false); } }} data-testid="button-save-link">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
