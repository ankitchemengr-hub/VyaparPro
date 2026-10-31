// Books & Audit → GST Returns: GSTR-1 for a month or a quarter, section by
// section, with the HSN summary and document series, as Excel and as the
// JSON the GST portal takes. Server side: api-server lib/gstr1.ts.

import React from "react";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Download, FileJson, Loader2 } from "lucide-react";

const num = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? v : 0; };
const rs = (n: unknown) => num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "");

interface Tax { txval: number; iamt: number; camt: number; samt: number; csamt: number }
interface Gstr1 {
  gstin: string; fp: string; from: string; to: string; warnings: string[];
  summary: ({ section: string; label: string; count: number } & Tax)[];
  b2b: ({ gstin: string; party: string; no: string; date: string; value: number; pos: string; rate: number } & Tax)[];
  b2cl: { no: string; date: string; value: number; pos: string; rate: number; txval: number; iamt: number; csamt: number }[];
  b2cs: ({ pos: string; type: string; rate: number } & Tax)[];
  cdn: ({ section: string; gstin: string | null; party: string; no: string; date: string; invoiceNo: string; value: number; pos: string; rate: number } & Tax)[];
  nil: { type: string; amount: number }[];
  hsn: ({ table: string; hsn: string; desc: string; uqc: string; qty: number; rate: number } & Tax)[];
  docs: { doc: string; from: string; to: string; total: number; cancelled: number; net: number }[];
}

// A column: heading, value, and whether it is money.
type Col<T> = [string, (r: T) => string | number, boolean?];
const TAX_COLS: Col<Tax>[] = [["Taxable", (r) => r.txval, true], ["IGST", (r) => r.iamt, true], ["CGST", (r) => r.camt, true], ["SGST", (r) => r.samt, true], ["Cess", (r) => r.csamt, true]];

function SectionTable<T>({ rows, cols, totals = true, empty }: { rows: T[]; cols: Col<T>[]; totals?: boolean; empty: string }) {
  if (!rows.length) return <div className="py-6 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>{cols.map(([h, , m]) => <TableHead key={h} className={m ? "text-right" : ""}>{h}</TableHead>)}</TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 2000).map((r, i) => (
            <TableRow key={i}>
              {cols.map(([h, f, m]) => <TableCell key={h} className={m ? "text-right tabular-nums" : "text-sm"}>{m ? rs(f(r)) : f(r)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
        {totals && (
          <TableFooter>
            <TableRow>
              {cols.map(([h, f, m], i) => (
                <TableCell key={h} className={m ? "text-right tabular-nums font-semibold" : "font-semibold"}>
                  {m && h !== "Invoice value" && h !== "Note value" && h !== "Rate %" ? rs(rows.reduce((s, r) => s + num(f(r)), 0)) : i === 0 ? "Total" : ""}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}

const B2B_COLS: Col<Gstr1["b2b"][number]>[] = [["GSTIN", (r) => r.gstin], ["Party", (r) => r.party], ["Invoice", (r) => r.no], ["Date", (r) => fmtDate(r.date)], ["Invoice value", (r) => r.value, true], ["Place of supply", (r) => r.pos], ["Rate %", (r) => r.rate], ...TAX_COLS];
const B2CL_COLS: Col<Gstr1["b2cl"][number]>[] = [["Invoice", (r) => r.no], ["Date", (r) => fmtDate(r.date)], ["Invoice value", (r) => r.value, true], ["Place of supply", (r) => r.pos], ["Rate %", (r) => r.rate], ["Taxable", (r) => r.txval, true], ["IGST", (r) => r.iamt, true], ["Cess", (r) => r.csamt, true]];
const B2CS_COLS: Col<Gstr1["b2cs"][number]>[] = [["Place of supply", (r) => r.pos], ["Type", (r) => (r.type === "INTER" ? "Inter-state" : "Intra-state")], ["Rate %", (r) => r.rate], ...TAX_COLS];
const CDN_COLS: Col<Gstr1["cdn"][number]>[] = [["Type", (r) => (r.section === "cdnr" ? "Registered" : "Unregistered (B2CL)")], ["GSTIN", (r) => r.gstin ?? ""], ["Party", (r) => r.party], ["Note", (r) => r.no], ["Date", (r) => fmtDate(r.date)], ["Against invoice", (r) => r.invoiceNo], ["Note value", (r) => r.value, true], ["Place of supply", (r) => r.pos], ["Rate %", (r) => r.rate], ...TAX_COLS];
const HSN_COLS: Col<Gstr1["hsn"][number]>[] = [["HSN", (r) => r.hsn], ["Description", (r) => r.desc], ["UQC", (r) => r.uqc], ["Qty", (r) => r.qty], ["Rate %", (r) => r.rate], ...TAX_COLS];
const NIL_LABEL: Record<string, string> = { INTRB2B: "Inter-state, registered", INTRAB2B: "Intra-state, registered", INTRB2C: "Inter-state, unregistered", INTRAB2C: "Intra-state, unregistered" };

function excel(g: Gstr1) {
  const wb = XLSX.utils.book_new();
  const sheet = <T,>(name: string, rows: T[], cols: Col<T>[]) => {
    const ws = XLSX.utils.aoa_to_sheet([cols.map(([h]) => h), ...rows.map((r) => cols.map(([, f, m]) => (m ? num(f(r)) : f(r))))]);
    ws["!cols"] = cols.map(([h]) => ({ wch: Math.max(10, h.length + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  sheet("Summary", g.summary, [["Section", (r) => r.label], ["Count", (r) => r.count], ...(TAX_COLS as Col<any>[])]);
  sheet("b2b", g.b2b, B2B_COLS);
  sheet("b2cl", g.b2cl, B2CL_COLS);
  sheet("b2cs", g.b2cs, B2CS_COLS);
  sheet("cdnr-cdnur", g.cdn, CDN_COLS);
  sheet("nil", g.nil, [["Supply", (r) => NIL_LABEL[r.type] ?? r.type], ["Nil rated", (r) => r.amount, true]]);
  sheet("hsn-b2b", g.hsn.filter((h) => h.table === "B2B"), HSN_COLS);
  sheet("hsn-b2c", g.hsn.filter((h) => h.table === "B2C"), HSN_COLS);
  sheet("docs", g.docs, [["Document", (r) => r.doc], ["From", (r) => r.from], ["To", (r) => r.to], ["Total", (r) => r.total], ["Cancelled", (r) => r.cancelled], ["Net issued", (r) => r.net]]);
  XLSX.writeFile(wb, `GSTR1_${g.gstin || "GSTIN"}_${g.fp}.xlsx`);
}

async function downloadJson(from: string, to: string, name: string) {
  const r = await fetch(`/api/books/gstr1/json?from=${from}&to=${to}`, { credentials: "include" });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Download failed");
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Last month, or the last quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar).
function periodOf(month: string, quarterly: boolean): { from: string; to: string } {
  let [y, m] = month.split("-").map(Number);
  let start = m;
  if (quarterly) { start = Math.floor((m - 1) / 3) * 3 + 1; m = start + 2; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${String(start).padStart(2, "0")}-01`, to: `${y}-${String(m).padStart(2, "0")}-${last}` };
}

export function GstReturnsTab() {
  const { toast } = useToast();
  const [month, setMonth] = React.useState(() => {
    const d = new Date(Date.now() + 5.5 * 3600_000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [quarterly, setQuarterly] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const valid = /^\d{4}-\d{2}$/.test(month);
  const { from, to } = valid ? periodOf(month, quarterly) : { from: "", to: "" };

  const { data: g, isLoading, error } = useQuery<Gstr1>({
    queryKey: ["/api/books/gstr1", from, to],
    queryFn: async () => {
      const r = await fetch(`/api/books/gstr1?from=${from}&to=${to}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Failed to load");
      return r.json();
    },
    enabled: valid,
  });

  const getJson = async () => {
    if (!g) return;
    setDownloading(true);
    try { await downloadJson(from, to, `GSTR1_${g.gstin || "GSTIN"}_${g.fp}.json`); }
    catch (e: any) { toast({ title: "Download failed", description: e.message, variant: "destructive" }); }
    finally { setDownloading(false); }
  };

  const total = g?.summary.reduce((s, r) => ({ txval: s.txval + (r.section.startsWith("cdn") ? -r.txval : r.txval), tax: s.tax + (r.section.startsWith("cdn") ? -1 : 1) * (r.iamt + r.camt + r.samt + r.csamt) }), { txval: 0, tax: 0 });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Return</Label>
          <Select value="gstr1" onValueChange={() => {}}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="gstr1">GSTR-1</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Filing</Label>
          <Select value={quarterly ? "q" : "m"} onValueChange={(v) => setQuarterly(v === "q")}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="m">Monthly</SelectItem>
              <SelectItem value="q">Quarterly (QRMP)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">{quarterly ? "Any month of the quarter" : "Month"}</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-[170px]" />
        </div>
        {valid && <div className="text-xs text-muted-foreground pb-2">{fmtDate(from)} to {fmtDate(to)}</div>}
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" disabled={!g} onClick={() => g && excel(g)}><Download className="w-4 h-4 mr-1" /> Excel</Button>
          <Button size="sm" disabled={!g || downloading} onClick={getJson} title="Upload on the GST portal: Returns → GSTR-1 → Prepare offline → Upload">
            {downloading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileJson className="w-4 h-4 mr-1" />} Portal JSON
          </Button>
        </div>
      </div>

      {isLoading && <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline" /></div>}
      {error && <div className="py-8 text-center text-sm text-destructive">{(error as Error).message}</div>}
      {g && (
        <>
          {g.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-1">
              {g.warnings.map((w, i) => <div key={i} className="flex gap-2"><AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />{w}</div>)}
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">GSTIN {g.gstin || "—"}</Badge>
            <Badge variant="outline">Period {g.fp.slice(0, 2)}/{g.fp.slice(2)}</Badge>
            {total && <Badge variant="outline">Net taxable ₹{rs(total.txval)}</Badge>}
            {total && <Badge variant="outline">Net tax ₹{rs(total.tax)}</Badge>}
          </div>

          <Tabs defaultValue="summary">
            <div className="overflow-x-auto -mx-1 px-1">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="b2b">B2B ({new Set(g.b2b.map((r) => r.no)).size})</TabsTrigger>
                <TabsTrigger value="b2cl">B2C Large ({new Set(g.b2cl.map((r) => r.no)).size})</TabsTrigger>
                <TabsTrigger value="b2cs">B2C Small</TabsTrigger>
                <TabsTrigger value="cdn">Credit notes ({new Set(g.cdn.map((r) => r.no)).size})</TabsTrigger>
                <TabsTrigger value="nil">Nil rated</TabsTrigger>
                <TabsTrigger value="hsn">HSN summary</TabsTrigger>
                <TabsTrigger value="docs">Documents</TabsTrigger>
              </TabsList>
            </div>
            <div className="mt-3">
              <TabsContent value="summary">
                <SectionTable rows={g.summary} cols={[["Section", (r) => r.label], ["Count", (r) => r.count], ...(TAX_COLS as Col<any>[])]} empty="" />
                <Card className="mt-3"><CardContent className="p-3 text-xs text-muted-foreground space-y-1">
                  <p>Only GST invoices are in GSTR-1; cancelled ones show only in Documents. Credit notes are the sales returns against GST invoices — on a B2C Small invoice they reduce B2C Small.</p>
                  <p>To file: download Portal JSON, then on gst.gov.in open Returns → GSTR-1 → Prepare offline → Upload, wait for it to process, check the summary there and file.</p>
                </CardContent></Card>
              </TabsContent>
              <TabsContent value="b2b"><SectionTable rows={g.b2b} cols={B2B_COLS} empty="No invoices to registered buyers." /></TabsContent>
              <TabsContent value="b2cl"><SectionTable rows={g.b2cl} cols={B2CL_COLS} empty="No inter-state invoices above ₹1 lakh to unregistered buyers." /></TabsContent>
              <TabsContent value="b2cs"><SectionTable rows={g.b2cs} cols={B2CS_COLS} empty="No small sales to unregistered buyers." /></TabsContent>
              <TabsContent value="cdn"><SectionTable rows={g.cdn} cols={CDN_COLS} empty="No credit notes to report separately." /></TabsContent>
              <TabsContent value="nil">
                <SectionTable rows={g.nil} cols={[["Supply", (r) => NIL_LABEL[r.type] ?? r.type], ["Nil rated", (r) => r.amount, true]]} empty="No 0 % sales." />
              </TabsContent>
              <TabsContent value="hsn" className="space-y-3">
                <div className="text-sm font-medium">B2B (registered buyers)</div>
                <SectionTable rows={g.hsn.filter((h) => h.table === "B2B")} cols={HSN_COLS} empty="None." />
                <div className="text-sm font-medium">B2C (unregistered buyers)</div>
                <SectionTable rows={g.hsn.filter((h) => h.table === "B2C")} cols={HSN_COLS} empty="None." />
              </TabsContent>
              <TabsContent value="docs">
                <SectionTable totals={false} rows={g.docs} cols={[["Document", (r) => r.doc], ["From", (r) => r.from], ["To", (r) => r.to], ["Total", (r) => r.total], ["Cancelled", (r) => r.cancelled], ["Net issued", (r) => r.net]]} empty="No documents in this period." />
              </TabsContent>
            </div>
          </Tabs>
        </>
      )}
    </div>
  );
}
