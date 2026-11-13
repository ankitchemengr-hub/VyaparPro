// Settings → Data Management → Non-GST Data Cleanup. Two independent tabs
// (Sales, Purchase), each with its own delete-by-date-range flow and
// automatic schedule. A delete is permanent: bills drop out of every report,
// while stock, Cash Book and party balances stay as they are (see api-server
// lib/non-gst-cleanup.ts).

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trash2, Search, CalendarClock, ShieldAlert, Lock, History, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";

type Category = "sales" | "purchase";
type Preset = "daily" | "weekly" | "monthly" | "yearly" | "custom";

const LABEL: Record<Category, { title: string; bill: string; party: string }> = {
  sales: { title: "Non-GST Sales", bill: "Invoice", party: "Customer" },
  purchase: { title: "Non-GST Purchase", bill: "Bill", party: "Supplier" },
};

// Linked rows removed along with the bill; the rest stay.
const PURGED_LINKS = new Set(["lineItems", "ledgerEntries", "paymentAllocations", "discountExpenses", "attachments"]);

const LINKED_LABELS: Record<string, string> = {
  lineItems: "Line items",
  stockMovements: "Stock movements",
  ledgerEntries: "Ledger entries",
  paymentAllocations: "Payment allocations",
  payments: "Payments",
  discountExpenses: "Discount expenses",
  attachments: "Attachments",
};

interface Candidate { id: number; recordNo: string; recordDate: string; partyName: string | null; amount: number; reason: string | null }
interface Preview {
  dateFrom: string | null; dateTo: string;
  eligibleCount: number; eligibleValue: number; excludedCount: number; excludedValue: number;
  linkedRecords: Record<string, number>;
  eligible: Candidate[]; excluded: Candidate[];
}
interface Job {
  id: number; trigger: string; action: string; dateFrom: string | null; dateTo: string | null; status: string;
  eligibleCount: number; processedCount: number; excludedCount: number; totalValue: number;
  operatorName: string | null; error: string | null; startedAt: string; finishedAt: string | null;
}
interface JobItem { recordId: number; recordNo: string; recordDate: string | null; partyName: string | null; amount: number; outcome: string; reason: string | null }
interface Settings {
  enabled: boolean; frequency: "daily" | "weekly" | "monthly" | "yearly"; minAgeDays: number;
  nextRunAt: string | null; lastRunAt: string | null; lastJob: Job | null; retentionYears: number;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const fmtDate = (s: string | null) => (s ? format(new Date(s), "dd-MM-yyyy") : "—");
const fmtDateTime = (s: string | null) => (s ? format(new Date(s), "dd-MM-yyyy HH:mm") : "—");
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today);
  if (preset === "weekly") from.setDate(from.getDate() - 6);
  if (preset === "monthly") from.setDate(1);
  if (preset === "yearly") {
    // Indian financial year: 1 April – 31 March.
    from.setMonth(3, 1);
    if (from > today) from.setFullYear(from.getFullYear() - 1);
  }
  return { from: ymd(from), to: ymd(today) };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? data?.job?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export function NonGstCleanupPanel() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground flex gap-2">
        <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
        <div>
          Deleting erases Non-GST bills for good — from every list and every report (P&amp;L, registers, dashboard, party ledger lines).
          Stock, Cash Book and party balances stay as they are. GST bills are never touched.
        </div>
      </div>
      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales" data-testid="tab-cleanup-sales">Non-GST Sales</TabsTrigger>
          <TabsTrigger value="purchase" data-testid="tab-cleanup-purchase">Non-GST Purchase</TabsTrigger>
        </TabsList>
        <TabsContent value="sales" className="mt-4"><CategoryCleanup category="sales" /></TabsContent>
        <TabsContent value="purchase" className="mt-4"><CategoryCleanup category="purchase" /></TabsContent>
      </Tabs>
    </div>
  );
}

function CategoryCleanup({ category }: { category: Category }) {
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  return (
    <div className="space-y-4">
      <DeleteCard category={category} onDone={refresh} />
      <HistoryCard category={category} refreshTick={refreshTick} />
      <ScheduleCard category={category} refreshTick={refreshTick} />
    </div>
  );
}

// ── Delete by date range ────────────────────────────────────────────────

function DeleteCard({ category, onDone }: { category: Category; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const L = LABEL[category];
  const [preset, setPreset] = useState<Preset>("monthly");
  const [range, setRange] = useState(() => presetRange("monthly"));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  // One key per confirmation, so a double-click or retry can't run twice.
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);
  // The last delete's result stays on screen (a toast vanishes in seconds).
  const [lastResult, setLastResult] = useState<Job | null>(null);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
    setPreview(null);
  };

  const loadPreview = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ from: range.from, to: range.to });
      setPreview(await api<Preview>(`/api/non-gst-cleanup/${category}/preview?${q}`));
    } catch (e: any) {
      toast({ title: "Preview failed", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const toggleHold = async (id: number, hold: boolean) => {
    try {
      await api(`/api/non-gst-cleanup/${category}/legal-hold`, { method: "POST", body: JSON.stringify({ ids: [id], hold }) });
      await loadPreview();
    } catch (e: any) {
      toast({ title: "Could not update legal hold", description: e.message, variant: "destructive" });
    }
  };

  const confirmWord = "PERMANENT";
  const linked = Object.entries(preview?.linkedRecords ?? {});

  const runDelete = async () => {
    setDeleting(true);
    try {
      const { job } = await api<{ job: Job }>(`/api/non-gst-cleanup/${category}/delete`, {
        method: "POST",
        body: JSON.stringify({ from: range.from, to: range.to, idempotencyKey, confirm: confirmWord }),
      });
      toast({
        title: `${job.processedCount} bill(s) permanently deleted`,
        description: `${inr(job.totalValue)} removed from every report. ${job.excludedCount} left alone. Stock, Cash Book and party balances unchanged.`,
      });
      setLastResult(job);
      setConfirmOpen(false);
      setPreview(null);
      setIdempotencyKey(newKey());
      queryClient.invalidateQueries();
      onDone();
    } catch (e: any) {
      toast({ title: "Delete failed — nothing was changed", description: e.message, variant: "destructive" });
      setIdempotencyKey(newKey());
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Trash2 className="w-5 h-5" /> Delete {L.title} bills</CardTitle>
        <CardDescription>Pick a period, check what will be deleted, then confirm.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lastResult && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 p-3 text-sm flex gap-2" data-testid={`result-delete-${category}`}>
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold text-emerald-800 dark:text-emerald-300">
                {lastResult.processedCount} bill(s) deleted · {inr(lastResult.totalValue)}
              </div>
              <div className="text-xs text-muted-foreground">
                Period {fmtDate(lastResult.dateFrom)} – {fmtDate(lastResult.dateTo)}. {lastResult.excludedCount} bill(s) left alone.
                See "Delete history" below for the list.
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {(["daily", "weekly", "monthly", "yearly", "custom"] as Preset[]).map((p) => (
            <Button key={p} size="sm" variant={preset === p ? "default" : "outline"} onClick={() => choosePreset(p)} data-testid={`preset-${category}-${p}`}>
              {{ daily: "Today", weekly: "Last 7 days", monthly: "This month", yearly: "This financial year", custom: "Custom range" }[p]}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor={`${category}-from`}>From</Label>
            <Input id={`${category}-from`} type="date" value={range.from} max={range.to}
              onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, from: e.target.value })); setPreview(null); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${category}-to`}>To</Label>
            <Input id={`${category}-to`} type="date" value={range.to} max={ymd(new Date())}
              onChange={(e) => { setPreset("custom"); setRange((r) => ({ ...r, to: e.target.value })); setPreview(null); }} />
          </div>
          <Button onClick={loadPreview} disabled={loading || !range.from || !range.to} data-testid={`button-preview-${category}`}>
            {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />} Preview
          </Button>
        </div>

        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Category" value={L.title} />
              <Stat label="Period" value={`${fmtDate(preview.dateFrom)} – ${fmtDate(preview.dateTo)}`} />
              <Stat label="Will be deleted" value={`${preview.eligibleCount} · ${inr(preview.eligibleValue)}`} strong />
              <Stat label="Left alone" value={`${preview.excludedCount} · ${inr(preview.excludedValue)}`} />
            </div>

            {preview.eligibleCount > 0 && (
              <div className="text-sm space-y-2">
                <div>
                  <div className="font-medium mb-1 text-destructive">Removed with the bills</div>
                  <div className="flex flex-wrap gap-2">
                    {linked.filter(([k]) => PURGED_LINKS.has(k)).map(([k, v]) => (
                      <Badge key={k} variant="destructive">{LINKED_LABELS[k] ?? k}: {v}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-medium mb-1">Kept (stock and money stay real)</div>
                  <div className="flex flex-wrap gap-2">
                    {linked.filter(([k]) => !PURGED_LINKS.has(k)).map(([k, v]) => (
                      <Badge key={k} variant="secondary">{LINKED_LABELS[k] ?? k}: {v}</Badge>
                    ))}
                    <Badge variant="secondary">Cash Book, party balances</Badge>
                  </div>
                </div>
              </div>
            )}

            <BillTable
              title={`Will be deleted (${preview.eligibleCount})`}
              rows={preview.eligible}
              party={L.party}
              total={preview.eligibleCount}
              action={(r) => (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleHold(r.id, true)} title="Never delete this bill">
                  <Lock className="w-3 h-3 mr-1" /> Hold
                </Button>
              )}
            />
            {preview.excludedCount > 0 && (
              <BillTable
                title={`Left alone (${preview.excludedCount})`}
                rows={preview.excluded}
                party={L.party}
                total={preview.excludedCount}
                showReason
                action={(r) => r.reason === "Under legal hold" ? (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleHold(r.id, false)}>Release hold</Button>
                ) : null}
              />
            )}

            <div className="flex justify-end">
              <Button variant="destructive" disabled={preview.eligibleCount === 0}
                onClick={() => { setConfirmText(""); setConfirmOpen(true); }} data-testid={`button-delete-${category}`}>
                <Trash2 className="w-4 h-4 mr-2" /> Permanently delete {preview.eligibleCount} bill(s)
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {preview?.eligibleCount} {L.title} bill(s)?</DialogTitle>
            <DialogDescription>Check the numbers before you confirm.</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Bills selected" value={String(preview.eligibleCount)} strong />
                <Stat label="Total value" value={inr(preview.eligibleValue)} strong />
              </div>
              <div className="space-y-2">
                <div className="text-muted-foreground">
                  Period {fmtDate(preview.dateFrom)} – {fmtDate(preview.dateTo)}. These bills are erased for good and drop out of every report —
                  P&amp;L, {category === "sales" ? "Sales" : "Purchase"} registers, dashboard and party ledger lines. Stock, Cash Book and party balances stay as they are.
                </div>
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                  This cannot be undone. Take a backup first (Backup &amp; Restore). The law asks businesses to keep books of
                  account for 8 years — deleting them is your decision.
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${category}-confirm`}>Type <span className="font-mono font-semibold">{confirmWord}</span> to confirm</Label>
                <Input id={`${category}-confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={runDelete} disabled={deleting || confirmText !== confirmWord} data-testid={`button-confirm-delete-${category}`}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Delete for good
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 tabular-nums ${strong ? "font-semibold text-base" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function BillTable({ title, rows, party, total, showReason, action }: {
  title: string; rows: Candidate[]; party: string; total: number; showReason?: boolean;
  action?: (r: Candidate) => React.ReactNode;
}) {
  return (
    <div>
      <div className="text-sm font-medium mb-1">{title}</div>
      <div className="max-h-72 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>{party}</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {showReason && <TableHead>Reason</TableHead>}
              {action && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-4">None</TableCell></TableRow>
            ) : rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">{r.recordNo}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(r.recordDate)}</TableCell>
                <TableCell>{r.partyName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(r.amount)}</TableCell>
                {showReason && <TableCell className="text-amber-700 dark:text-amber-400 text-xs">{r.reason}</TableCell>}
                {action && <TableCell className="text-right">{action(r)}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {total > rows.length && <div className="text-xs text-muted-foreground mt-1">Showing first {rows.length} of {total}.</div>}
    </div>
  );
}

// ── Delete history ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  succeeded: "default", failed: "destructive", running: "secondary",
};

function HistoryCard({ category, refreshTick }: { category: Category; refreshTick: number }) {
  const { toast } = useToast();
  const L = LABEL[category];
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [items, setItems] = useState<Record<number, JobItem[]>>({});

  useEffect(() => {
    api<Job[]>(`/api/non-gst-cleanup/${category}/jobs`)
      .then(setJobs)
      .catch((e) => { setJobs([]); toast({ title: "Could not load delete history", description: e.message, variant: "destructive" }); });
  }, [category, refreshTick, toast]);

  const toggle = async (id: number) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!items[id]) {
      try {
        const job = await api<Job & { items: JobItem[] }>(`/api/non-gst-cleanup/${category}/jobs/${id}`);
        setItems((m) => ({ ...m, [id]: job.items }));
      } catch (e: any) {
        toast({ title: "Could not load the bills", description: e.message, variant: "destructive" });
      }
    }
  };

  const totalDeleted = (jobs ?? []).filter((j) => j.status === "succeeded").reduce((s, j) => s + j.processedCount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><History className="w-5 h-5" /> Delete history</CardTitle>
        <CardDescription>
          Every delete of {L.title} bills — by you or the automatic schedule. Tap a row to see which bills were deleted.
          {jobs && jobs.length > 0 && <> Total deleted so far: <span className="font-semibold text-foreground">{totalDeleted}</span>.</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!jobs ? (
          <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        ) : jobs.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground">No {L.title} bills have been deleted yet.</div>
        ) : (
          <div className="divide-y rounded-md border">
            {jobs.map((j) => {
              const open = openId === j.id;
              const rows = items[j.id];
              return (
                <div key={j.id}>
                  <button type="button" onClick={() => toggle(j.id)} className="w-full text-left px-3 py-2.5 hover:bg-muted/50 flex items-start gap-2" data-testid={`row-cleanup-job-${j.id}`}>
                    {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold">{j.processedCount} deleted</span>
                        <span className="tabular-nums text-sm">{inr(j.totalValue)}</span>
                        <Badge variant={STATUS_BADGE[j.status] ?? "outline"} className="text-[10px] px-1.5 py-0">{j.status}</Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{j.trigger === "manual" ? "Manual" : "Automatic"}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {fmtDateTime(j.startedAt)} · bills dated {fmtDate(j.dateFrom)} – {fmtDate(j.dateTo)} · {j.excludedCount} left alone
                        {j.operatorName ? ` · by ${j.operatorName}` : ""}
                      </div>
                      {j.error && <div className="text-xs text-destructive">{j.error}</div>}
                    </div>
                  </button>
                  {open && (
                    <div className="px-3 pb-3">
                      {!rows ? (
                        <div className="py-2 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
                      ) : (
                        <div className="max-h-72 overflow-auto rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>No.</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>{L.party}</TableHead>
                                <TableHead className="text-right">Amount</TableHead>
                                <TableHead>Result</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.length === 0 ? (
                                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-4">No bills in this period</TableCell></TableRow>
                              ) : rows.map((r) => (
                                <TableRow key={`${r.outcome}-${r.recordId}`}>
                                  <TableCell className="font-mono text-xs">{r.recordNo}</TableCell>
                                  <TableCell className="whitespace-nowrap">{fmtDate(r.recordDate)}</TableCell>
                                  <TableCell>{r.partyName ?? "—"}</TableCell>
                                  <TableCell className="text-right tabular-nums">{inr(r.amount)}</TableCell>
                                  <TableCell className="text-xs">
                                    {r.outcome === "deleted"
                                      ? <span className="text-destructive font-medium">Deleted</span>
                                      : <span className="text-amber-700 dark:text-amber-400">Left alone{r.reason ? ` — ${r.reason}` : ""}</span>}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Automatic schedule ──────────────────────────────────────────────────

function ScheduleCard({ category, refreshTick }: { category: Category; refreshTick: number }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Pick<Settings, "enabled" | "frequency" | "minAgeDays"> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Settings>(`/api/non-gst-cleanup/${category}/settings`)
      .then((s) => { setSettings(s); setDraft({ enabled: s.enabled, frequency: s.frequency, minAgeDays: s.minAgeDays }); })
      .catch((e) => toast({ title: "Could not load schedule", description: e.message, variant: "destructive" }));
  }, [category, refreshTick, toast]);

  if (!settings || !draft) {
    return <Card><CardContent className="py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline" /></CardContent></Card>;
  }
  const dirty = draft.enabled !== settings.enabled || draft.frequency !== settings.frequency || draft.minAgeDays !== settings.minAgeDays;

  const save = async () => {
    setSaving(true);
    try {
      const s = await api<Settings>(`/api/non-gst-cleanup/${category}/settings`, { method: "PUT", body: JSON.stringify(draft) });
      setSettings(s);
      setDraft({ enabled: s.enabled, frequency: s.frequency, minAgeDays: s.minAgeDays });
      toast({ title: s.enabled ? "Automatic cleanup on" : "Automatic cleanup off" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CalendarClock className="w-5 h-5" /> Automatic cleanup</CardTitle>
        <CardDescription>
          Permanently deletes eligible {LABEL[category].title} bills older than the age you set. Every run checks the same rules as a manual delete.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2">
            <Switch id={`${category}-auto`} checked={draft.enabled} onCheckedChange={(v) => setDraft({ ...draft, enabled: v })} />
            <Label htmlFor={`${category}-auto`}>{draft.enabled ? "On" : "Off"}</Label>
          </div>
          <div className="space-y-1">
            <Label>Runs</Label>
            <Select value={draft.frequency} onValueChange={(v) => setDraft({ ...draft, frequency: v as Settings["frequency"] })}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly (Monday)</SelectItem>
                <SelectItem value="monthly">Monthly (1st)</SelectItem>
                <SelectItem value="yearly">Yearly (1 April)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${category}-age`}>Delete bills older than (days)</Label>
            <Input id={`${category}-age`} type="number" min={0} className="w-32" value={draft.minAgeDays}
              onChange={(e) => setDraft({ ...draft, minAgeDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </div>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Next run" value={settings.enabled ? fmtDateTime(settings.nextRunAt) : "Off"} />
          <Stat label="Last run" value={fmtDateTime(settings.lastRunAt)} />
          <Stat label="Last status" value={settings.lastJob ? settings.lastJob.status : "—"} />
          <Stat label="Last result" value={settings.lastJob ? `${settings.lastJob.processedCount} deleted · ${settings.lastJob.excludedCount} left` : "—"} />
        </div>
      </CardContent>
    </Card>
  );
}
