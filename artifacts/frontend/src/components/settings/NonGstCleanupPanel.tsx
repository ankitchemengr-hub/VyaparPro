// Settings → Data Management → Non-GST Data Cleanup. Two independent tabs
// (Sales, Purchase), each with its own delete-by-date-range flow and
// automatic schedule. "Delete" hides bills from every
// list and from non-admins; their amounts keep counting in reports, stock and
// ledgers (see api-server lib/non-gst-cleanup.ts).

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
import { Loader2, Trash2, Search, CalendarClock, ShieldAlert, Lock } from "lucide-react";

type Category = "sales" | "purchase";
type Preset = "daily" | "weekly" | "monthly" | "yearly" | "custom";

const LABEL: Record<Category, { title: string; bill: string; party: string }> = {
  sales: { title: "Non-GST Sales", bill: "Invoice", party: "Customer" },
  purchase: { title: "Non-GST Purchase", bill: "Bill", party: "Supplier" },
};

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
          Deleting removes Non-GST bills from every Sales and Purchase list.
          Their amounts keep counting in P&amp;L, Sales, Purchase, COGS, stock, party ledgers and the dashboard, so no total changes.
          GST bills are never touched.
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

  const runDelete = async () => {
    setDeleting(true);
    try {
      const { job } = await api<{ job: Job }>(`/api/non-gst-cleanup/${category}/delete`, {
        method: "POST",
        body: JSON.stringify({ from: range.from, to: range.to, idempotencyKey, confirm: "DELETE" }),
      });
      toast({
        title: `${job.processedCount} bill(s) deleted`,
        description: `${inr(job.totalValue)} removed from the lists. ${job.excludedCount} left alone. Report totals are unchanged.`,
      });
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
              <div className="text-sm">
                <div className="font-medium mb-1">Linked records (kept unchanged)</div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(preview.linkedRecords).map(([k, v]) => (
                    <Badge key={k} variant="secondary">{LINKED_LABELS[k] ?? k}: {v}</Badge>
                  ))}
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
                <Trash2 className="w-4 h-4 mr-2" /> Delete {preview.eligibleCount} bill(s)
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {preview?.eligibleCount} {L.title} bill(s)?</DialogTitle>
            <DialogDescription>Check the numbers before you confirm.</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Bills selected" value={String(preview.eligibleCount)} strong />
                <Stat label="Total value" value={inr(preview.eligibleValue)} strong />
              </div>
              <div className="text-muted-foreground">
                Period {fmtDate(preview.dateFrom)} – {fmtDate(preview.dateTo)}. These bills disappear from the {category === "sales" ? "Sales" : "Purchase"} lists
                and from non-admin users. P&amp;L, reports, stock and ledgers stay the same.
              </div>
              <div className="space-y-1">
                <Label htmlFor={`${category}-confirm`}>Type <span className="font-mono font-semibold">DELETE</span> to confirm</Label>
                <Input id={`${category}-confirm`} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={runDelete} disabled={deleting || confirmText !== "DELETE"} data-testid={`button-confirm-delete-${category}`}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Delete bills
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
          Deletes eligible {LABEL[category].title} bills older than the age you set. Every run checks the same rules as a manual delete.
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
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Lock className="w-3 h-3" /> Permanent erasure is locked: accounting records must be kept for {settings.retentionYears} financial years, and erasing them would change past report totals.
        </div>
      </CardContent>
    </Card>
  );
}
