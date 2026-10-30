// Books & Audit — Tally import / export, the audit trail and Tally's keys.
// Server side: api-server routes/books-tally.ts and lib/tally.ts.

import React from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Download, FileUp, Loader2, Search } from "lucide-react";
import { BOOKS_SHORTCUTS } from "@/lib/keyboard/shortcuts";

const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
const rs = (n: unknown) => `₹${num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load");
  return r.json();
}

// ── Tally keys ───────────────────────────────────────────────────────

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  return node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.tagName === "SELECT" || node.isContentEditable;
}

const keyName = (e: KeyboardEvent) => (/^F\d+$/.test(e.key) ? e.key : e.code.startsWith("Key") ? e.code.slice(3) : e.key);

// F-keys and Ctrl/Alt combos work while typing; bare letters (T, P, B…)
// only when no field is focused, like Tally's Gateway.
export function useTallyShortcuts(opts: {
  readOnly: boolean;
  canBill: boolean;
  setTab: (tab: string) => void;
  onAction: (action: "period" | "export" | "import") => void;
}) {
  const [, setLocation] = useLocation();
  const ref = React.useRef(opts);
  ref.current = opts;
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.shiftKey) return;
      const { readOnly, canBill, setTab, onAction } = ref.current;
      const k = keyName(e);
      const match = BOOKS_SHORTCUTS.find((s) => {
        const main = s.keys[s.keys.length - 1];
        const ctrl = s.keys.includes("Ctrl"), alt = s.keys.includes("Alt");
        return main === k && ctrl === e.ctrlKey && alt === e.altKey;
      });
      if (!match || (readOnly && match.writes) || match.action === "accept") return;
      if (match.keys.length === 1 && !/^F\d+$/.test(k) && isTypingTarget(e.target)) return;
      e.preventDefault();
      if (match.tab) setTab(match.tab);
      else if (match.path) setLocation(match.path === "/billing" && !canBill ? "/invoices" : match.path);
      else if (match.action) onAction(match.action);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setLocation]);
}

// Ctrl+A on the Journal form saves it, as Tally's "Accept".
export function useAcceptKey(enabled: boolean, onAccept: () => void) {
  const ref = React.useRef(onAccept);
  ref.current = onAccept;
  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code === "KeyA") {
        e.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}

export function TallyKeysHint({ readOnly }: { readOnly: boolean }) {
  const keys = BOOKS_SHORTCUTS.filter((s) => !readOnly || !s.writes);
  return (
    <div className="hidden md:flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground print:hidden">
      {keys.map((s) => (
        <span key={s.keys.join("+")} className="whitespace-nowrap">
          <kbd className="rounded border px-1 font-mono">{s.keys.join("+")}</kbd> {s.label}
        </span>
      ))}
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────

export async function downloadTallyXml(from: string, to: string) {
  const r = await fetch(`/api/books/tally/export?from=${from}&to=${to}`, { credentials: "include" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Export failed");
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tally-${from}-to-${to}.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tally usually writes UTF-16; read either.
function decodeXml(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  if (b.length > 1 && b[1] === 0 && b[0] !== 0) return new TextDecoder("utf-16le").decode(b);
  return new TextDecoder("utf-8").decode(b);
}

// ── Tally tab ────────────────────────────────────────────────────────

interface ImportResult {
  dryRun: boolean;
  ledgersCreated: { name: string; group: string; openingBalance: number; warning?: string }[];
  ledgersExisting: string[];
  ledgersSkipped: { name: string; reason: string }[];
  journalsImported: { date: string; no: string; total: number }[];
  journalsSkipped: { no: string; date: string; reason: string }[];
  vouchersSkipped: { type: string; count: number }[];
}

export function TallyTab({ from, to, readOnly, groupLabel, fileInputRef }: {
  from: string; to: string; readOnly: boolean; groupLabel: (code: string) => string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [exporting, setExporting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [xml, setXml] = React.useState("");
  const [preview, setPreview] = React.useState<ImportResult | null>(null);

  async function exportXml() {
    setExporting(true);
    try {
      await downloadTallyXml(from, to);
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  async function post(dryRun: boolean, text: string): Promise<ImportResult> {
    const r = await fetch("/api/books/tally/import", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ xml: text, dryRun }),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error ?? "Import failed");
    return data;
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { toast({ title: "File is larger than 15 MB — export a shorter period from Tally", variant: "destructive" }); return; }
    setBusy(true);
    setPreview(null);
    try {
      const text = decodeXml(await file.arrayBuffer());
      setFileName(file.name);
      setXml(text);
      setPreview(await post(true, text));
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function confirmImport() {
    setBusy(true);
    try {
      const r = await post(false, xml);
      toast({ title: `Imported ${r.ledgersCreated.length} ledgers and ${r.journalsImported.length} Journals` });
      setPreview(null);
      setXml("");
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/books/") });
    } catch (e) {
      toast({ title: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const p = preview;
  const nothing = p && p.ledgersCreated.length === 0 && p.journalsImported.length === 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="font-semibold">Export to Tally</div>
          <p className="text-sm text-muted-foreground">
            The GST books of the period above — GST sales and purchases, their credit / debit notes, the payments received and
            made against GST bills, expenses, contra and Journals — with the ledgers they use and their opening balances, as one
            Tally XML file. Non-GST bills are not included. In Tally: <b>Import → Masters / Transactions</b> (Tally
            Prime) or <b>Gateway → Import of Data → Vouchers</b> (Tally ERP 9).
          </p>
          <Button onClick={exportXml} disabled={exporting}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />} Download Tally XML
          </Button>
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold">Import from Tally</div>
            <p className="text-sm text-muted-foreground">
              Brings in the ledgers the ERP doesn't keep elsewhere — capital, loans, fixed assets, indirect income and expenses — with
              their opening balances, and the Journal vouchers between them. Customers, suppliers, cash / bank, sales, purchases and
              GST are not imported: those come from the ERP's own bills. You'll see what will happen before anything is saved.
            </p>
            <input ref={fileInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileUp className="w-4 h-4 mr-2" />} Choose Tally XML file
            </Button>

            {p && (
              <div className="space-y-3 border-t pt-3">
                <div className="text-sm"><b>{fileName}</b></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">New ledgers</div>
                    <div className="text-2xl font-bold">{p.ledgersCreated.length}</div>
                    {p.ledgersExisting.length > 0 && <div className="text-xs text-muted-foreground">{p.ledgersExisting.length} already in Books — left as they are</div>}
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs font-semibold uppercase text-muted-foreground">Journals to import</div>
                    <div className="text-2xl font-bold">{p.journalsImported.length}</div>
                    {p.journalsSkipped.length > 0 && <div className="text-xs text-muted-foreground">{p.journalsSkipped.length} skipped (see below)</div>}
                  </div>
                </div>

                {p.ledgersCreated.length > 0 && (
                  <div className="max-h-56 overflow-y-auto rounded-md border divide-y text-sm">
                    {p.ledgersCreated.map((l) => (
                      <div key={l.name} className="p-2 flex justify-between gap-2">
                        <span className="min-w-0">
                          <span className="font-medium">{l.name}</span> <span className="text-xs text-muted-foreground">· {groupLabel(l.group)}</span>
                          {l.warning && <span className="block text-[11px] text-amber-700 dark:text-amber-400">{l.warning}</span>}
                        </span>
                        <span className="font-mono whitespace-nowrap">{l.openingBalance ? rs(l.openingBalance) : ""}</span>
                      </div>
                    ))}
                  </div>
                )}

                {p.journalsSkipped.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{p.journalsSkipped.length} Journals will not be imported
                    </summary>
                    <div className="mt-1 max-h-48 overflow-y-auto rounded-md border divide-y">
                      {p.journalsSkipped.map((j, i) => (
                        <div key={i} className="p-2 text-xs"><b>{j.no}</b> {j.date} — {j.reason}</div>
                      ))}
                    </div>
                  </details>
                )}
                {(p.ledgersSkipped.length > 0 || p.vouchersSkipped.length > 0) && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      Not imported: {p.ledgersSkipped.length} ledgers, {p.vouchersSkipped.reduce((s, v) => s + v.count, 0)} other vouchers
                    </summary>
                    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {p.vouchersSkipped.map((v) => <div key={v.type}>{v.type}: {v.count} — already in the ERP from its own bills and Cash Book</div>)}
                      <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                        {p.ledgersSkipped.map((l) => <div key={l.name} className="p-2"><b>{l.name}</b> — {l.reason}</div>)}
                      </div>
                    </div>
                  </details>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={confirmImport} disabled={busy || !!nothing}>
                    {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {nothing ? "Nothing new to import" : `Import ${p.ledgersCreated.length} ledgers and ${p.journalsImported.length} Journals`}
                  </Button>
                  <Button variant="ghost" onClick={() => { setPreview(null); setXml(""); }}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Audit trail ──────────────────────────────────────────────────────

interface AuditRow { id: number; action: string; description: string | null; userId: number; userName: string | null; metadata: string | null; createdAt: string }
interface AuditTrail { total: number; rows: AuditRow[]; users: { id: number; name: string }[]; actions: { action: string; count: number }[] }

const actionLabel = (a: string) => { const s = a.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
const ACTION_TONE = (a: string) =>
  /delet|cancel|remov|reset|restor/.test(a) ? "text-red-700 dark:text-red-400"
    : /edit|updat|chang/.test(a) ? "text-amber-700 dark:text-amber-400"
      : /creat|add|saved|import/.test(a) ? "text-emerald-700 dark:text-emerald-400" : "";
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

function prettyMeta(m: string | null): string {
  if (!m) return "";
  try { return JSON.stringify(JSON.parse(m), null, 2); } catch { return m; }
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function AuditTrailTab({ from, to }: { from: string; to: string }) {
  const [userId, setUserId] = React.useState("all");
  const [action, setAction] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [open, setOpen] = React.useState<number | null>(null);
  React.useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams({ from, to, limit: "1000" });
  if (userId !== "all") params.set("userId", userId);
  if (action !== "all") params.set("action", action);
  if (search) params.set("q", search);
  const { data, isLoading, error } = useQuery<AuditTrail>({
    queryKey: ["/api/books/audit-trail", from, to, userId, action, search],
    queryFn: () => getJson(`/api/books/audit-trail?${params}`),
  });

  function downloadCsv() {
    if (!data) return;
    const lines = [["Date & time", "User", "Action", "Description", "Details"].join(",")];
    for (const r of data.rows) lines.push([fmtTime(r.createdAt), r.userName, actionLabel(r.action), r.description, r.metadata].map(csvCell).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-trail-${from}-to-${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground print:hidden">
        Every entry made, edited, cancelled or deleted in the ERP, with who did it and when. The trail can't be edited or deleted from here.
      </p>
      <div className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search description or user" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {(data?.users ?? []).map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {(data?.actions ?? []).map((a) => <SelectItem key={a.action} value={a.action}>{actionLabel(a.action)} ({a.count})</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!data?.rows.length}>
          <Download className="w-4 h-4 mr-1" /> CSV
        </Button>
      </div>

      {isLoading || error || !data ? (
        error ? <div className="py-10 text-center text-destructive text-sm">{(error as Error).message}</div>
          : <div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
      ) : data.rows.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Nothing logged in this period.</div>
      ) : (
        <>
          {data.total > data.rows.length && (
            <div className="text-xs text-muted-foreground">Showing the latest {data.rows.length} of {data.total} — narrow the period or filter to see the rest.</div>
          )}
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>What</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <TableRow className={r.metadata ? "cursor-pointer" : ""} onClick={() => r.metadata && setOpen(open === r.id ? null : r.id)}>
                      <TableCell className="whitespace-nowrap text-sm align-top">{fmtTime(r.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm align-top">{r.userName ?? `User ${r.userId}`}</TableCell>
                      <TableCell className="min-w-[200px] align-top">
                        <div className={`text-xs font-semibold ${ACTION_TONE(r.action)}`}>{actionLabel(r.action)}</div>
                        <div className="text-sm">{r.description ?? "—"}</div>
                      </TableCell>
                    </TableRow>
                    {open === r.id && (
                      <TableRow>
                        <TableCell colSpan={3} className="bg-muted/40">
                          <pre className="text-[11px] whitespace-pre-wrap break-all max-h-72 overflow-y-auto">{prettyMeta(r.metadata)}</pre>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

export function ReadOnlyBadge() {
  return <Badge variant="secondary" className="print:hidden">View only</Badge>;
}
