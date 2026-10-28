// Books & Audit — Trial Balance, Profit & Loss, Balance Sheet, Journal
// vouchers and the business's own ledgers. Figures come from /api/books/*
// (api-server lib/books.ts); each statement shows one "Difference" line for
// whatever the rest of the ERP records with no other side.

import React from "react";
import { Link, Redirect } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpenCheck, Loader2, Plus, Printer, Trash2, Info, Search, AlertTriangle } from "lucide-react";

interface Line { name: string; amount: number; note?: string }
interface Group { group: string; lines: Line[] }
interface TrialBalance { from: string; to: string; rows: { name: string; group: string; debit: number; credit: number }[]; difference: number; totals: { debit: number; credit: number } }
interface ProfitLoss {
  from: string; to: string; salesGross: number; salesReturns: number; sales: number; costOfGoodsSold: number; grossProfit: number;
  otherIncome: Line[]; otherIncomeTotal: number; expenses: Line[]; expensesTotal: number; netProfit: number;
}
interface BalanceSheet { from: string; to: string; liabilities: Group[]; assets: Group[]; profit: { earlier: number; current: number; total: number }; difference: number; total: number }
interface LedgerGroupInfo { code: string; label: string; nature: "dr" | "cr"; statement: "bs" | "pl" }
interface Ledger { id: number; name: string; group: string; openingBalance: number; isActive: boolean; balance: number }
interface Voucher {
  id: number; voucherNo: string; date: string; narration: string | null; total: number; status: string; createdByName: string | null;
  lines: { ledgerId: number; ledgerName: string; debit: number; credit: number }[];
}

const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
const rs = (n: unknown) => `₹${num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const drCr = (signed: number) => (signed === 0 ? rs(0) : `${rs(Math.abs(signed))} ${signed > 0 ? "Dr" : "Cr"}`);
const fmtDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function todayIst(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
function fyStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load");
  return r.json();
}
async function sendJson(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method, credentials: "include", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

function Loading({ error }: { error?: unknown }) {
  if (error) return <div className="py-10 text-center text-destructive text-sm">{(error as Error).message}</div>;
  return <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>;
}

function DifferenceNote({ amount }: { amount: number }) {
  if (Math.abs(amount) < 0.005) return null;
  return (
    <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-xs sm:text-sm print:hidden">
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
      <div>
        <span className="font-semibold">Difference {rs(Math.abs(amount))}</span> — entries with no other side, such as the owner's
        starting capital, cash bills without a customer, or Cash Book entries without a party. Enter the capital and
        opening balances in <b>Ledgers</b> and post a <b>Journal</b> to bring it down.
      </div>
    </div>
  );
}

// ── Reports ──────────────────────────────────────────────────────────

function TrialBalanceView({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuery<TrialBalance>({
    queryKey: ["/api/books/trial-balance", from, to],
    queryFn: () => getJson(`/api/books/trial-balance?from=${from}&to=${to}`),
  });
  if (isLoading || error || !data) return <Loading error={error} />;
  return (
    <div className="space-y-3">
      <DifferenceNote amount={data.difference} />
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Particulars</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r, i) => (
              <TableRow key={`${r.name}-${i}`}>
                <TableCell className="min-w-[160px]">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground">{r.group}</div>
                </TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap">{r.debit ? rs(r.debit) : ""}</TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap">{r.credit ? rs(r.credit) : ""}</TableCell>
              </TableRow>
            ))}
            {Math.abs(data.difference) >= 0.005 && (
              <TableRow className="text-amber-700 dark:text-amber-400">
                <TableCell className="font-medium">Difference in opening balances</TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap">{data.difference < 0 ? rs(-data.difference) : ""}</TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap">{data.difference > 0 ? rs(data.difference) : ""}</TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-bold">Total</TableCell>
              <TableCell className="text-right font-mono font-bold whitespace-nowrap">{rs(data.totals.debit)}</TableCell>
              <TableCell className="text-right font-mono font-bold whitespace-nowrap">{rs(data.totals.credit)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}

function AmountRow({ label, amount, bold, indent, tone }: { label: string; amount: number; bold?: boolean; indent?: boolean; tone?: string }) {
  return (
    <div className={`flex justify-between gap-3 py-1.5 ${bold ? "font-semibold border-t" : ""} ${indent ? "pl-4 text-sm" : ""} ${tone ?? ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="font-mono whitespace-nowrap">{rs(amount)}</span>
    </div>
  );
}

function ProfitLossView({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuery<ProfitLoss>({
    queryKey: ["/api/books/profit-loss", from, to],
    queryFn: () => getJson(`/api/books/profit-loss?from=${from}&to=${to}`),
  });
  if (isLoading || error || !data) return <Loading error={error} />;
  const profit = data.netProfit >= 0;
  return (
    <Card className="max-w-2xl">
      <CardContent className="p-4 space-y-1">
        <AmountRow label="Sales (excl. GST)" amount={data.salesGross} />
        {data.salesReturns !== 0 && <AmountRow label="Less: Sales returns" amount={-data.salesReturns} indent />}
        <AmountRow label="Net sales" amount={data.sales} bold />
        <AmountRow label="Less: Cost of goods sold" amount={-data.costOfGoodsSold} indent />
        <AmountRow label="Gross profit" amount={data.grossProfit} bold tone={data.grossProfit < 0 ? "text-red-600" : ""} />
        {data.otherIncome.length > 0 && (
          <div className="pt-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase">Other income</div>
            {data.otherIncome.map((l) => <AmountRow key={l.name} label={l.name} amount={l.amount} indent />)}
          </div>
        )}
        <div className="pt-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase">Expenses</div>
          {data.expenses.length === 0
            ? <div className="pl-4 text-sm text-muted-foreground py-1">No expenses in this period</div>
            : data.expenses.map((l) => <AmountRow key={l.name} label={l.name} amount={-l.amount} indent />)}
          <AmountRow label="Total expenses" amount={-data.expensesTotal} bold />
        </div>
        <div className={`flex justify-between gap-3 pt-3 mt-2 border-t-2 text-lg font-bold ${profit ? "text-emerald-600" : "text-red-600"}`}>
          <span>{profit ? "Net profit" : "Net loss"}</span>
          <span className="font-mono">{rs(Math.abs(data.netProfit))}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SideCard({ title, groups, extra, total }: { title: string; groups: Group[]; extra?: React.ReactNode; total: number }) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col h-full">
        <div className="font-semibold mb-2">{title}</div>
        <div className="flex-1 space-y-3">
          {groups.map((g) => (
            <div key={g.group}>
              <AmountRow label={g.group} amount={g.lines.reduce((s, l) => s + l.amount, 0)} />
              {g.lines.map((l) => (
                <div key={l.name}>
                  <AmountRow label={l.name} amount={l.amount} indent />
                  {l.note && <div className="pl-4 text-[11px] text-muted-foreground -mt-1">{l.note}</div>}
                </div>
              ))}
            </div>
          ))}
          {extra}
        </div>
        <div className="flex justify-between gap-3 pt-2 mt-3 border-t-2 font-bold">
          <span>Total</span><span className="font-mono">{rs(total)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function BalanceSheetView({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useQuery<BalanceSheet>({
    queryKey: ["/api/books/balance-sheet", from, to],
    queryFn: () => getJson(`/api/books/balance-sheet?from=${from}&to=${to}`),
  });
  if (isLoading || error || !data) return <Loading error={error} />;
  const diff = data.difference;
  const diffRow = (show: boolean) => show && Math.abs(diff) >= 0.005
    ? <AmountRow label="Difference (capital not entered / unmatched)" amount={Math.abs(diff)} tone="text-amber-700 dark:text-amber-400" />
    : null;
  return (
    <div className="space-y-3">
      <DifferenceNote amount={diff} />
      <div className="grid gap-3 md:grid-cols-2">
        <SideCard
          title="Liabilities"
          groups={data.liabilities}
          total={data.total}
          extra={
            <>
              <div>
                <AmountRow label="Profit & Loss A/c" amount={data.profit.total} />
                <AmountRow label="Up to last year" amount={data.profit.earlier} indent />
                <AmountRow label="This period" amount={data.profit.current} indent />
              </div>
              {diffRow(diff > 0)}
            </>
          }
        />
        <SideCard title="Assets" groups={data.assets} total={data.total} extra={diffRow(diff < 0)} />
      </div>
    </div>
  );
}

// ── Journal ──────────────────────────────────────────────────────────

interface DraftLine { ledgerId: string; side: "dr" | "cr"; amount: string }

function JournalTab({ from, to, ledgers, isAdmin }: { from: string; to: string; ledgers: Ledger[]; isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [date, setDate] = React.useState(todayIst());
  const [narration, setNarration] = React.useState("");
  const [lines, setLines] = React.useState<DraftLine[]>([{ ledgerId: "", side: "dr", amount: "" }, { ledgerId: "", side: "cr", amount: "" }]);
  const [saving, setSaving] = React.useState(false);

  const { data: vouchers, isLoading, error } = useQuery<Voucher[]>({
    queryKey: ["/api/books/vouchers", from, to],
    queryFn: () => getJson(`/api/books/vouchers?from=${from}&to=${to}`),
  });

  const active = ledgers.filter((l) => l.isActive);
  const dr = lines.filter((l) => l.side === "dr").reduce((s, l) => s + num(l.amount), 0);
  const cr = lines.filter((l) => l.side === "cr").reduce((s, l) => s + num(l.amount), 0);
  const balanced = Math.abs(dr - cr) < 0.005 && dr > 0;

  const setLine = (i: number, patch: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/books/") });

  async function save() {
    setSaving(true);
    try {
      const body = {
        date, narration,
        lines: lines.filter((l) => l.ledgerId && num(l.amount) > 0).map((l) => ({
          ledgerId: Number(l.ledgerId), debit: l.side === "dr" ? num(l.amount) : 0, credit: l.side === "cr" ? num(l.amount) : 0,
        })),
      };
      const r = await sendJson("/api/books/vouchers", "POST", body);
      toast({ title: `Journal ${r.voucherNo} saved` });
      setNarration("");
      setLines([{ ledgerId: "", side: "dr", amount: "" }, { ledgerId: "", side: "cr", amount: "" }]);
      refresh();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function cancel(v: Voucher) {
    if (!window.confirm(`Cancel ${v.voucherNo}? It stays in the list but no longer counts in any report.`)) return;
    try {
      await sendJson(`/api/books/vouchers/${v.id}/cancel`, "POST");
      toast({ title: `${v.voucherNo} cancelled` });
      refresh();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="font-semibold">New Journal voucher</div>
          {active.length < 2 ? (
            <div className="text-sm text-muted-foreground">Add at least two ledgers in the Ledgers tab first.</div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div>
                  <Label>Narration</Label>
                  <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Depreciation on furniture for the year" />
                </div>
              </div>
              <div className="space-y-2">
                {lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-[72px_1fr] sm:grid-cols-[80px_1fr_160px_36px] gap-2 items-center">
                    <Select value={l.side} onValueChange={(v) => setLine(i, { side: v as "dr" | "cr" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dr">Dr</SelectItem>
                        <SelectItem value="cr">Cr</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={l.ledgerId} onValueChange={(v) => setLine(i, { ledgerId: v })}>
                      <SelectTrigger><SelectValue placeholder="Choose ledger" /></SelectTrigger>
                      <SelectContent>
                        {active.map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      className="col-start-2 sm:col-start-auto" inputMode="decimal" placeholder="Amount" value={l.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })}
                    />
                    <Button
                      type="button" variant="ghost" size="icon" className="hidden sm:inline-flex" disabled={lines.length <= 2}
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { ledgerId: "", side: dr > cr ? "cr" : "dr", amount: "" }])}>
                  <Plus className="w-4 h-4 mr-1" /> Add line
                </Button>
                <div className={`text-sm font-mono ${balanced ? "text-emerald-600" : "text-amber-600"}`}>
                  Dr {rs(dr)} · Cr {rs(cr)}
                </div>
              </div>
              <Button onClick={save} disabled={!balanced || saving} className="w-full sm:w-auto">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save Journal
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {isLoading || error ? <Loading error={error} /> : (vouchers ?? []).length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No Journal vouchers in this period.</div>
      ) : (
        <div className="space-y-2">
          {vouchers!.map((v) => (
            <Card key={v.id} className={v.status === "cancelled" ? "opacity-60" : ""}>
              <CardContent className="p-3 sm:p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{v.voucherNo}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(v.date)}</span>
                    {v.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{rs(v.total)}</span>
                    {isAdmin && v.status === "saved" && (
                      <Button size="sm" variant="ghost" className="text-destructive print:hidden" onClick={() => cancel(v)}>Cancel</Button>
                    )}
                  </div>
                </div>
                <div className="text-sm space-y-0.5">
                  {v.lines.map((l, i) => (
                    <div key={i} className={`flex justify-between gap-3 ${l.credit ? "pl-6" : ""}`}>
                      <span className="min-w-0 truncate">{l.credit ? "To " : ""}{l.ledgerName}</span>
                      <span className="font-mono whitespace-nowrap">{l.debit ? `${rs(l.debit)} Dr` : `${rs(l.credit)} Cr`}</span>
                    </div>
                  ))}
                </div>
                {(v.narration || v.createdByName) && (
                  <div className="text-xs text-muted-foreground">
                    {v.narration}{v.narration && v.createdByName ? " · " : ""}{v.createdByName ? `by ${v.createdByName}` : ""}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ledgers ──────────────────────────────────────────────────────────

function LedgersTab({ ledgers, groups }: { ledgers: Ledger[]; groups: LedgerGroupInfo[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const empty = { id: 0, name: "", group: "", openingBalance: "", isActive: true };
  const [form, setForm] = React.useState(empty);
  const [saving, setSaving] = React.useState(false);
  const groupOf = (code: string) => groups.find((g) => g.code === code);
  const formGroup = groupOf(form.group);

  async function save() {
    setSaving(true);
    try {
      const body = { name: form.name, group: form.group, openingBalance: num(form.openingBalance), isActive: form.isActive };
      if (form.id) await sendJson(`/api/books/ledgers/${form.id}`, "PATCH", body);
      else await sendJson("/api/books/ledgers", "POST", body);
      toast({ title: form.id ? "Ledger updated" : "Ledger created" });
      setForm(empty);
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/books/") });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="font-semibold">{form.id ? `Edit "${form.name}"` : "New ledger"}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Furniture, Bank Loan" />
            </div>
            <div>
              <Label>Group</Label>
              <Select value={form.group} onValueChange={(v) => setForm({ ...form, group: v })}>
                <SelectTrigger><SelectValue placeholder="Choose group" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => <SelectItem key={g.code} value={g.code}>{g.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {formGroup?.statement === "bs" && (
              <div>
                <Label>Opening balance ({formGroup.nature === "dr" ? "Dr" : "Cr"})</Label>
                <Input inputMode="decimal" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving || !form.name.trim() || !form.group}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} {form.id ? "Save changes" : "Create ledger"}
            </Button>
            {form.id > 0 && (
              <>
                <Button variant="outline" onClick={() => setForm({ ...form, isActive: !form.isActive })}>
                  {form.isActive ? "Mark inactive" : "Mark active"}
                </Button>
                <Button variant="ghost" onClick={() => setForm(empty)}>Cancel</Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Customers, suppliers, Cash Book accounts, sales, purchases and expenses are already in the books — add only
            what the ERP doesn't record elsewhere: capital, loans, fixed assets, depreciation, interest and similar.
          </p>
        </CardContent>
      </Card>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ledger</TableHead>
              <TableHead>Group</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledgers.map((l) => (
              <TableRow
                key={l.id} className="cursor-pointer"
                onClick={() => setForm({ id: l.id, name: l.name, group: l.group, openingBalance: l.openingBalance ? String(l.openingBalance) : "", isActive: l.isActive })}
              >
                <TableCell className="font-medium min-w-[140px]">
                  {l.name} {!l.isActive && <Badge variant="secondary" className="ml-1">Inactive</Badge>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{groupOf(l.group)?.label ?? l.group}</TableCell>
                <TableCell className="text-right font-mono whitespace-nowrap">{drCr(l.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ── Day Book ─────────────────────────────────────────────────────────

interface DayBookRow { date: string; kind: string; id: number; no: string | null; party: string | null; amount: number; detail: string | null }

const KIND_LABEL: Record<string, string> = {
  sale: "Sales", purchase: "Purchase", credit_note: "Credit Note", debit_note: "Debit Note",
  receipt: "Receipt", payment: "Payment", contra: "Contra", journal: "Journal",
};
const KIND_TONE: Record<string, string> = {
  sale: "text-emerald-700 dark:text-emerald-400", receipt: "text-emerald-700 dark:text-emerald-400",
  purchase: "text-blue-700 dark:text-blue-400", payment: "text-red-700 dark:text-red-400",
  credit_note: "text-amber-700 dark:text-amber-400", debit_note: "text-amber-700 dark:text-amber-400",
};

function useDayBook(from: string, to: string) {
  return useQuery<DayBookRow[]>({
    queryKey: ["/api/books/day-book", from, to],
    queryFn: () => getJson(`/api/books/day-book?from=${from}&to=${to}`),
  });
}

function DayBookTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useDayBook(from, to);
  const [kind, setKind] = React.useState("all");
  if (isLoading || error || !data) return <Loading error={error} />;
  const rows = kind === "all" ? data : data.filter((r) => r.kind === kind);
  const totals = Object.keys(KIND_LABEL)
    .map((k) => ({ k, total: data.filter((r) => r.kind === k).reduce((s, r) => s + r.amount, 0) }))
    .filter((t) => t.total !== 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 print:hidden">
        <Button size="sm" variant={kind === "all" ? "default" : "outline"} onClick={() => setKind("all")}>All ({data.length})</Button>
        {totals.map((t) => (
          <Button key={t.k} size="sm" variant={kind === t.k ? "default" : "outline"} onClick={() => setKind(t.k)}>
            {KIND_LABEL[t.k]} · {rs(t.total)}
          </Button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No entries in this period.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Voucher</TableHead>
                <TableHead>Particulars</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.kind}-${r.id}`}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDate(r.date)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className={`text-xs font-semibold ${KIND_TONE[r.kind] ?? ""}`}>{KIND_LABEL[r.kind] ?? r.kind}</div>
                    <div className="text-sm">
                      {r.kind === "sale" ? <Link href={`/invoices/${r.id}`} className="underline underline-offset-2">{r.no}</Link> : r.no}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[160px]">
                    <div className="text-sm">{r.party || "—"}</div>
                    {r.detail && <div className="text-[11px] text-muted-foreground">{r.detail}</div>}
                  </TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">{rs(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Contra ───────────────────────────────────────────────────────────

interface CashAccount { id: number; name: string; type: string; currentBalance: number; isActive: boolean }

// Uses the Accounts module's own transfer (POST /accounts/transfer, admin only).
function ContraTab({ from, to, isAdmin }: { from: string; to: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rows, isLoading, error } = useDayBook(from, to);
  const { data: accounts } = useQuery<CashAccount[]>({ queryKey: ["/api/accounts"], queryFn: () => getJson("/api/accounts"), enabled: isAdmin });
  const [fromId, setFromId] = React.useState("");
  const [toId, setToId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const active = (accounts ?? []).filter((a) => a.isActive);
  const source = active.find((a) => String(a.id) === fromId);
  const short = !!source && num(amount) > source.currentBalance + 0.001;

  async function save() {
    setSaving(true);
    try {
      await sendJson("/api/accounts/transfer", "POST", { fromAccountId: Number(fromId), toAccountId: Number(toId), amount: num(amount), notes });
      toast({ title: "Contra entry saved" });
      setAmount("");
      setNotes("");
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/books/") || q.queryKey[0] === "/api/accounts" });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const contra = (rows ?? []).filter((r) => r.kind === "contra");
  return (
    <div className="space-y-4">
      {isAdmin && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold">New Contra (cash ↔ bank transfer)</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>From account</Label>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {active.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name} ({rs(a.currentBalance)})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To account</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {active.filter((a) => String(a.id) !== fromId).map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Amount</Label>
                <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" />
              </div>
            </div>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional), e.g. Cash deposited in bank" />
            {short && <div className="text-xs text-destructive">{source!.name} has only {rs(source!.currentBalance)}.</div>}
            <Button onClick={save} disabled={saving || !fromId || !toId || fromId === toId || num(amount) <= 0 || short}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save Contra
            </Button>
          </CardContent>
        </Card>
      )}
      {isLoading || error ? <Loading error={error} /> : contra.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No transfers between accounts in this period.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Transfer</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {contra.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDate(r.date)}</TableCell>
                  <TableCell className="min-w-[160px]">
                    <div className="text-sm">{r.party}</div>
                    {r.detail && <div className="text-[11px] text-muted-foreground">{r.detail}</div>}
                  </TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">{rs(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Debit Note (purchase return) ─────────────────────────────────────

interface PurchaseBill { id: number; billNo: string; vendorBillNo: string | null; billDate: string; isGst: boolean; vendorName: string | null; grandTotal: number }
interface ReturnableItem { purchaseItemId: number; productName: string; unit: string; taxPct: number; qty: number; amount: number; returnableQty: number; currentStock: number }
interface DebitNote {
  id: number; returnNo: string; date: string; billNo: string; vendorName: string | null; reason: string | null;
  grandTotal: number; totalTax: number; status: string; createdByName: string | null; isGst: boolean;
  items: { productName: string; qty: number; unit: string; amount: number }[];
}

function DebitNoteTab({ from, to, isAdmin }: { from: string; to: string; isAdmin: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [bill, setBill] = React.useState<PurchaseBill | null>(null);
  const [qtys, setQtys] = React.useState<Record<number, string>>({});
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const { data: bills } = useQuery<PurchaseBill[]>({
    queryKey: ["/api/purchase-returns/bills", search],
    queryFn: () => getJson(`/api/purchase-returns/bills?search=${encodeURIComponent(search.trim())}`),
    enabled: !bill,
  });
  const { data: items } = useQuery<ReturnableItem[]>({
    queryKey: ["/api/purchase-returns/bills", bill?.id, "items"],
    queryFn: () => getJson(`/api/purchase-returns/bills/${bill!.id}/items`),
    enabled: !!bill,
  });
  const { data: notes, isLoading, error } = useQuery<DebitNote[]>({
    queryKey: ["/api/purchase-returns", from, to],
    queryFn: () => getJson(`/api/purchase-returns?from=${from}&to=${to}`),
  });

  const qtyOf = (it: ReturnableItem) => num(qtys[it.purchaseItemId]);
  const total = (items ?? []).reduce((s, it) => s + (it.qty > 0 ? (it.amount / it.qty) * qtyOf(it) : 0), 0);
  const over = (items ?? []).some((it) => qtyOf(it) > it.returnableQty + 0.0001);
  const lowStock = (items ?? []).filter((it) => qtyOf(it) > it.currentStock + 0.0001);
  const refresh = () => qc.invalidateQueries({
    predicate: (q) => String(q.queryKey[0]).startsWith("/api/books/") || String(q.queryKey[0]).startsWith("/api/purchase-returns"),
  });

  async function save() {
    // Warn, never block: stock may simply not have been entered.
    if (lowStock.length && !window.confirm(`Stock is lower than the quantity being returned for ${lowStock.map((i) => i.productName).join(", ")} — it will go below zero. Save anyway?`)) return;
    setSaving(true);
    try {
      const r = await sendJson("/api/purchase-returns", "POST", {
        purchaseId: bill!.id, reason,
        items: (items ?? []).filter((it) => qtyOf(it) > 0).map((it) => ({ purchaseItemId: it.purchaseItemId, qty: qtyOf(it) })),
      });
      toast({ title: `Debit note ${r.returnNo} saved for ${rs(r.grandTotal)}` });
      setBill(null);
      setQtys({});
      setReason("");
      refresh();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function cancel(n: DebitNote) {
    if (!window.confirm(`Cancel ${n.returnNo}? The stock comes back and the supplier's dues go back up.`)) return;
    try {
      await sendJson(`/api/purchase-returns/${n.id}/cancel`, "POST");
      toast({ title: `${n.returnNo} cancelled` });
      refresh();
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="font-semibold">New Debit Note — goods returned to a supplier</div>
          {!bill ? (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" placeholder="Search purchase bill no. or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="max-h-64 overflow-y-auto divide-y rounded-md border">
                {(bills ?? []).length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">No purchase bills found.</div>
                ) : bills!.map((b) => (
                  <button key={b.id} type="button" className="w-full text-left p-2.5 hover:bg-muted flex justify-between gap-2" onClick={() => setBill(b)}>
                    <span className="min-w-0">
                      <span className="font-medium">{b.billNo}</span>
                      {!b.isGst && <Badge variant="secondary" className="ml-1.5">Non-GST</Badge>}
                      {b.vendorBillNo && <span className="text-xs text-muted-foreground"> · Supplier bill {b.vendorBillNo}</span>}
                      <span className="block text-xs text-muted-foreground truncate">{b.vendorName ?? "—"} · {new Date(b.billDate).toLocaleDateString("en-IN")}</span>
                    </span>
                    <span className="font-mono text-sm whitespace-nowrap">{rs(b.grandTotal)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  <b>{bill.billNo}</b> · {bill.vendorName ?? "—"}
                  {!bill.isGst && <span className="block text-xs text-amber-700 dark:text-amber-400">Non-GST bill — stock and supplier dues change, but it stays out of these books.</span>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setBill(null); setQtys({}); }}>Change bill</Button>
              </div>
              <div className="space-y-2">
                {(items ?? []).map((it) => (
                  <div key={it.purchaseItemId} className="grid grid-cols-[1fr_110px] gap-2 items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{it.productName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Can return {it.returnableQty} {it.unit} · In stock {it.currentStock} · GST {it.taxPct}%
                      </div>
                    </div>
                    <Input
                      inputMode="decimal" placeholder="Qty" value={qtys[it.purchaseItemId] ?? ""} disabled={it.returnableQty <= 0}
                      onChange={(e) => setQtys({ ...qtys, [it.purchaseItemId]: e.target.value.replace(/[^0-9.]/g, "") })}
                    />
                  </div>
                ))}
              </div>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. damaged / wrong item" rows={2} />
              {over && <div className="text-xs text-destructive">A quantity is more than can still be returned.</div>}
              {lowStock.length > 0 && !over && (
                <div className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Stock is lower than the quantity for {lowStock.map((i) => i.productName).join(", ")}.
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">Debit note value <b className="font-mono">{rs(total)}</b></div>
                <Button onClick={save} disabled={saving || total <= 0 || over}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save Debit Note
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {isLoading || error ? <Loading error={error} /> : (notes ?? []).length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No debit notes in this period.</div>
      ) : (
        <div className="space-y-2">
          {notes!.map((n) => (
            <Card key={n.id} className={n.status === "cancelled" ? "opacity-60" : ""}>
              <CardContent className="p-3 sm:p-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{n.returnNo}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(n.date)} · Bill {n.billNo}</span>
                    {!n.isGst && <Badge variant="secondary">Non-GST</Badge>}
                    {n.status === "cancelled" && <Badge variant="secondary">Cancelled</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">{rs(n.grandTotal)}</span>
                    {isAdmin && n.status === "saved" && (
                      <Button size="sm" variant="ghost" className="text-destructive print:hidden" onClick={() => cancel(n)}>Cancel</Button>
                    )}
                  </div>
                </div>
                <div className="text-sm">{n.vendorName ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {n.items.map((i) => `${i.productName} × ${i.qty} ${i.unit}`).join(", ")}
                  {n.reason ? ` · ${n.reason}` : ""}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Credit Note (sales return) ───────────────────────────────────────

// Credit notes are the existing Sales Returns; this tab lists the ones made
// against GST invoices in the period (from the Day Book).
function CreditNoteTab({ from, to }: { from: string; to: string }) {
  const { data, isLoading, error } = useDayBook(from, to);
  const rows = (data ?? []).filter((r) => r.kind === "credit_note");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">A credit note is made when a customer returns goods, from the Sales Return page.</p>
        <Link href="/sales-return"><Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Credit Note</Button></Link>
      </div>
      {isLoading || error ? <Loading error={error} /> : rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No credit notes in this period.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Credit Note</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Amount</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">{fmtDate(r.date)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <div className="text-sm font-medium">{r.no}</div>
                    {r.detail && <div className="text-[11px] text-muted-foreground">{r.detail}</div>}
                  </TableCell>
                  <TableCell className="min-w-[140px] text-sm">{r.party ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">{rs(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function BooksAudit() {
  const { user } = useAuth();
  const today = todayIst();
  const [to, setTo] = React.useState(today);
  const [from, setFrom] = React.useState(fyStart(today));
  const [tab, setTab] = React.useState("trial-balance");
  const allowed = user?.role === "admin" || user?.role === "accountant";

  const { data: ledgerData } = useQuery<{ groups: LedgerGroupInfo[]; ledgers: Ledger[] }>({
    queryKey: ["/api/books/ledgers"],
    queryFn: () => getJson("/api/books/ledgers"),
    enabled: allowed,
  });

  if (!allowed) return <Redirect to="/" />;
  const validRange = !!from && !!to && from <= to;
  const showPeriod = tab !== "ledgers";
  const title = {
    "trial-balance": "Trial Balance", "profit-loss": "Profit & Loss", "balance-sheet": "Balance Sheet", "day-book": "Day Book",
    journal: "Journal", contra: "Contra", "debit-note": "Debit Note", "credit-note": "Credit Note", ledgers: "Ledgers",
  }[tab];
  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Books &amp; Audit</h1>
            <p className="text-xs sm:text-sm text-muted-foreground print:hidden">Trial Balance, Profit &amp; Loss, Balance Sheet, Day Book and vouchers.</p>
            <p className="hidden print:block text-sm">{title} · {fmtDate(from)} to {fmtDate(to)}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
          <Printer className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">Print</span>
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto -mx-1 px-1 print:hidden">
          <TabsList>
            <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
            <TabsTrigger value="profit-loss">Profit &amp; Loss</TabsTrigger>
            <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
            <TabsTrigger value="day-book">Day Book</TabsTrigger>
            <TabsTrigger value="journal">Journal</TabsTrigger>
            <TabsTrigger value="contra">Contra</TabsTrigger>
            <TabsTrigger value="debit-note">Debit Note</TabsTrigger>
            <TabsTrigger value="credit-note">Credit Note</TabsTrigger>
            <TabsTrigger value="ledgers">Ledgers</TabsTrigger>
          </TabsList>
        </div>

        {showPeriod && (
          <div className="flex flex-wrap items-end gap-2 mt-3 print:hidden">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setTo(today); setFrom(fyStart(today)); }}>This year</Button>
          </div>
        )}

        <div className="mt-3">
          {!validRange && showPeriod ? (
            <div className="py-8 text-center text-sm text-destructive">Choose a valid date range.</div>
          ) : (
            <>
              <TabsContent value="trial-balance"><TrialBalanceView from={from} to={to} /></TabsContent>
              <TabsContent value="profit-loss"><ProfitLossView from={from} to={to} /></TabsContent>
              <TabsContent value="balance-sheet"><BalanceSheetView from={from} to={to} /></TabsContent>
              <TabsContent value="journal">
                <JournalTab from={from} to={to} ledgers={ledgerData?.ledgers ?? []} isAdmin={isAdmin} />
              </TabsContent>
              <TabsContent value="day-book"><DayBookTab from={from} to={to} /></TabsContent>
              <TabsContent value="contra"><ContraTab from={from} to={to} isAdmin={isAdmin} /></TabsContent>
              <TabsContent value="debit-note"><DebitNoteTab from={from} to={to} isAdmin={isAdmin} /></TabsContent>
              <TabsContent value="credit-note"><CreditNoteTab from={from} to={to} /></TabsContent>
              <TabsContent value="ledgers">
                {ledgerData ? <LedgersTab ledgers={ledgerData.ledgers} groups={ledgerData.groups} /> : <Loading />}
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
