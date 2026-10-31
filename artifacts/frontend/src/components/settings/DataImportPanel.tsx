// Settings → Data Import. A new company brings its parties (with opening
// balance) and items (with opening stock) over from the software it used
// before — Vyapar, Busy, Marg, Hitech or plain Excel. The file is read here,
// its columns are matched to ours (guessed from common export headings, and
// changeable), the server previews every row, and only then saves. Rows
// already in the ERP are skipped (see api-server lib/data-import.ts).

import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Download, Users, Package, CheckCircle2 } from "lucide-react";

type Kind = "parties" | "items";
interface Field { key: string; label: string; required?: boolean; aliases: string[]; sample: string[] }

const FIELDS: Record<Kind, Field[]> = {
  parties: [
    { key: "name", label: "Name", required: true, aliases: ["party name", "name", "account name", "customer name", "supplier name", "ledger name", "party"], sample: ["Sharma Traders", "Gupta Hardware"] },
    { key: "mobile", label: "Mobile", aliases: ["mobile", "mobile no", "phone", "phone no", "contact no", "contact", "contact number", "mobile number", "whatsapp"], sample: ["9876543210", "9123456780"] },
    { key: "type", label: "Customer / Supplier", aliases: ["party type", "type", "party group", "group", "under", "category"], sample: ["Customer", "Supplier"] },
    { key: "gstin", label: "GSTIN", aliases: ["gstin", "gst no", "gstin no", "gst number", "gstin/uin", "gst"], sample: ["08ABCDE1234F1Z5", ""] },
    { key: "address", label: "Address", aliases: ["address", "billing address", "address1", "address 1", "full address"], sample: ["Station Road", "Main Bazar"] },
    { key: "city", label: "City", aliases: ["city", "town", "place"], sample: ["Jaipur", "Ajmer"] },
    { key: "state", label: "State", aliases: ["state", "state name", "place of supply"], sample: ["Rajasthan", "Rajasthan"] },
    { key: "pinCode", label: "PIN code", aliases: ["pin", "pin code", "pincode", "zip", "postal code"], sample: ["302001", "305001"] },
    { key: "openingBalance", label: "Opening balance", aliases: ["opening balance", "balance", "closing balance", "current balance", "outstanding", "opening bal"], sample: ["12500", "4000 Cr"] },
    { key: "receivable", label: "Receivable (to collect)", aliases: ["receivable balance", "receivable", "to receive", "debit"], sample: ["", ""] },
    { key: "payable", label: "Payable (to pay)", aliases: ["payable balance", "payable", "to pay", "credit"], sample: ["", ""] },
    { key: "creditLimit", label: "Credit limit", aliases: ["credit limit", "limit"], sample: ["50000", ""] },
  ],
  items: [
    { key: "name", label: "Item name", required: true, aliases: ["item name", "name", "product name", "stock item", "item", "product", "description"], sample: ["Wall Putty 20kg", "Primer 1L"] },
    { key: "itemCode", label: "Item code", aliases: ["item code", "code", "sku", "product code", "barcode", "part no"], sample: ["WP-20", ""] },
    { key: "hsnCode", label: "HSN", aliases: ["hsn", "hsn/sac", "hsn code", "hsn/sac code", "sac"], sample: ["3214", "3209"] },
    { key: "taxRate", label: "GST %", aliases: ["tax rate", "gst rate", "gst", "gst %", "tax", "tax %", "igst rate", "gst slab"], sample: ["18", "GST@18%"] },
    { key: "unit", label: "Unit", aliases: ["unit", "base unit", "uom", "primary unit", "units"], sample: ["BAG", "LTR"] },
    { key: "group", label: "Group / Category", aliases: ["category", "group", "item group", "stock group", "item category"], sample: ["Putty", "Paint"] },
    { key: "brand", label: "Brand", aliases: ["brand", "company", "make", "manufacturer"], sample: ["Birla", "Asian"] },
    { key: "salePrice", label: "Sale price (retail)", aliases: ["sale price", "selling price", "retail price", "rate", "price", "sales price"], sample: ["650", "320"] },
    { key: "wholesalePrice", label: "Wholesale price", aliases: ["wholesale price", "dealer price", "wholesale rate"], sample: ["600", ""] },
    { key: "purchasePrice", label: "Purchase price", aliases: ["purchase price", "cost price", "purchase rate", "cost", "landing price"], sample: ["520", "250"] },
    { key: "mrp", label: "MRP", aliases: ["mrp", "max retail price"], sample: ["700", "350"] },
    { key: "openingStock", label: "Opening stock (qty)", aliases: ["opening stock quantity", "opening stock", "opening qty", "stock", "current stock", "stock quantity", "quantity", "qty", "closing stock"], sample: ["40", "120"] },
    { key: "minStock", label: "Minimum stock", aliases: ["minimum stock quantity", "min stock", "minimum stock", "reorder level", "low stock"], sample: ["10", ""] },
  ],
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9%/]+/g, " ").trim();
const NONE = "__none";

// Exports often start with a title or company name: the header is the first
// of the top rows that has at least two of our known headings.
function findHeader(rows: unknown[][], kind: Kind): number {
  const known = new Set(FIELDS[kind].flatMap((f) => f.aliases));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (rows[i].filter((c) => known.has(norm(c))).length >= 2) return i;
  }
  return Math.max(0, rows.findIndex((r) => r.some((c) => String(c ?? "").trim())));
}

function guessMapping(headers: string[], kind: Kind): Record<string, string> {
  const map: Record<string, string> = {};
  const taken = new Set<number>();
  // Exact heading first, then a heading that starts with an alias.
  for (const pass of [0, 1]) {
    for (const f of FIELDS[kind]) {
      if (map[f.key] != null) continue;
      for (const a of f.aliases) {
        const i = headers.findIndex((h, idx) => !taken.has(idx) && (pass === 0 ? norm(h) === a : norm(h).startsWith(a)));
        if (i >= 0) { map[f.key] = String(i); taken.add(i); break; }
      }
    }
  }
  return map;
}

interface Result { row: number; name: string; status: "new" | "exists" | "error"; reason?: string; detail?: string }
interface Response { dryRun: boolean; asOn: string; created: number; results: Result[]; openingTotal?: { customer: number; vendor: number }; stockValue?: number }

const inr = (v: number) => `₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function downloadSample(kind: Kind) {
  const f = FIELDS[kind];
  const ws = XLSX.utils.aoa_to_sheet([f.map((x) => x.label), ...[0, 1].map((i) => f.map((x) => x.sample[i] ?? ""))]);
  ws["!cols"] = f.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind === "parties" ? "Parties" : "Items");
  XLSX.writeFile(wb, `import-${kind}-sample.xlsx`);
}

function ImportFlow({ kind }: { kind: Kind }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<unknown[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [defaultType, setDefaultType] = useState<"customer" | "vendor">("customer");
  const [pricingTier, setPricingTier] = useState<"retail" | "wholesale">("wholesale");
  const [asOn, setAsOn] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Response | null>(null);
  const [done, setDone] = useState<Response | null>(null);
  const [filter, setFilter] = useState<"all" | Result["status"]>("all");

  const fields = FIELDS[kind];

  const onFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false });
      if (!rows.length) { toast({ title: "The file is empty", variant: "destructive" }); return; }
      const h = findHeader(rows, kind);
      const hdr = rows[h].map((c) => String(c ?? "").trim());
      setFileName(file.name);
      setHeaderRow(h + 1);
      setHeaders(hdr);
      setData(rows.slice(h + 1).filter((r) => r.some((c) => String(c ?? "").trim())));
      setMapping(guessMapping(hdr, kind));
      setPreview(null);
      setDone(null);
    } catch {
      toast({ title: "Could not read this file", description: "Upload an Excel (.xlsx / .xls) or CSV file.", variant: "destructive" });
    }
  };

  const rows = useMemo(() => data.map((r, i) => {
    const o: Record<string, string | number> = { row: headerRow + 1 + i };
    for (const f of fields) {
      const col = mapping[f.key];
      if (col != null && col !== NONE) o[f.key] = String(r[Number(col)] ?? "").trim();
    }
    return o;
  }).filter((o) => fields.some((f) => o[f.key])), [data, mapping, fields, headerRow]);

  const send = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/data-import/${kind}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, dryRun, defaultType, pricingTier, asOn }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Failed (${r.status})`);
      if (dryRun) { setPreview(body); setFilter("all"); }
      else {
        setDone(body);
        setPreview(null);
        qc.invalidateQueries();
        toast({ title: `${body.created} ${kind === "parties" ? "parties" : "items"} imported` });
      }
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const counts = preview ? {
    new: preview.results.filter((r) => r.status === "new").length,
    exists: preview.results.filter((r) => r.status === "exists").length,
    error: preview.results.filter((r) => r.status === "error").length,
  } : null;
  const shown = preview ? preview.results.filter((r) => filter === "all" || r.status === filter) : [];

  const reset = () => { setHeaders([]); setData([]); setPreview(null); setDone(null); setFileName(""); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="space-y-4">
      {done && (
        <div className="rounded-md border border-green-600/40 bg-green-600/10 p-4 text-sm flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div className="space-y-1">
            <div className="font-medium">{done.created} {kind === "parties" ? "parties" : "items"} added.</div>
            {kind === "parties" && done.openingTotal && (
              <div className="text-muted-foreground">
                Opening as on {done.asOn}: customers {inr(done.openingTotal.customer)} receivable, suppliers {inr(done.openingTotal.vendor)} payable.
                Each party's khata starts with an "Opening balance (imported)" line.
              </div>
            )}
            {kind === "items" && <div className="text-muted-foreground">Opening stock value {inr(done.stockValue ?? 0)} (at purchase price). Check Inventory.</div>}
            <Button size="sm" variant="outline" className="mt-2" onClick={reset}>Import another file</Button>
          </div>
        </div>
      )}

      {!done && (
        <div className="flex flex-wrap items-end gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.ods" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          <Button onClick={() => fileRef.current?.click()} data-testid={`import-${kind}-file`}>
            <Upload className="mr-2 h-4 w-4" /> {fileName ? "Choose another file" : "Choose Excel / CSV file"}
          </Button>
          <Button variant="outline" onClick={() => downloadSample(kind)}>
            <Download className="mr-2 h-4 w-4" /> Sample file
          </Button>
          {fileName && <span className="text-sm text-muted-foreground">{fileName} · {rows.length} rows (headings on row {headerRow})</span>}
        </div>
      )}

      {!done && headers.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {kind === "parties" && (
              <>
                <div className="space-y-1">
                  <Label>Rows without a type are</Label>
                  <Select value={defaultType} onValueChange={(v) => { setDefaultType(v as any); setPreview(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Customers</SelectItem>
                      <SelectItem value="vendor">Suppliers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Customers' price list</Label>
                  <Select value={pricingTier} onValueChange={(v) => { setPricingTier(v as any); setPreview(null); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wholesale">Wholesale</SelectItem>
                      <SelectItem value="retail">Retail</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Opening balance as on</Label>
                  <Input type="date" value={asOn} onChange={(e) => { setAsOn(e.target.value); setPreview(null); }} />
                </div>
              </>
            )}
          </div>

          <div>
            <div className="text-sm font-medium mb-2">Match the columns</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((f) => (
                <div key={f.key} className="flex items-center gap-2">
                  <Label className="w-40 shrink-0 text-xs">{f.label}{f.required && <span className="text-destructive"> *</span>}</Label>
                  <Select value={mapping[f.key] ?? NONE} onValueChange={(v) => { setMapping((m) => ({ ...m, [f.key]: v })); setPreview(null); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— not in file —</SelectItem>
                      {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || `Column ${i + 1}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {kind === "parties" && (
              <p className="text-xs text-muted-foreground mt-2">
                Opening balance: a customer's amount is what they owe you, a supplier's is what you owe them; "Cr" / "Dr" after the amount, or a minus sign, means an advance.
                If the file has separate Receivable and Payable columns, match those instead.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => send(true)} disabled={busy || !rows.length || mapping.name == null || mapping.name === NONE}>
              {busy && !preview ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Check {rows.length} rows
            </Button>
            {preview && counts && (
              <Button onClick={() => send(false)} disabled={busy || counts.new === 0} data-testid={`import-${kind}-save`}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Import {counts.new} new {kind === "parties" ? "parties" : "items"}
              </Button>
            )}
          </div>
        </>
      )}

      {preview && counts && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-sm">
            {(["all", "new", "exists", "error"] as const).map((s) => (
              <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>
                {s === "all" ? `All ${preview.results.length}` : s === "new" ? `New ${counts.new}` : s === "exists" ? `Already in ERP ${counts.exists}` : `Errors ${counts.error}`}
              </Button>
            ))}
          </div>
          {kind === "parties" && preview.openingTotal && (
            <p className="text-xs text-muted-foreground">
              Opening of new parties: customers {inr(preview.openingTotal.customer)}, suppliers {inr(preview.openingTotal.vendor)}.
            </p>
          )}
          {kind === "items" && <p className="text-xs text-muted-foreground">Opening stock value of new items: {inr(preview.stockValue ?? 0)}.</p>}
          {counts.error > 0 && <p className="text-xs text-destructive">Rows with errors are left out. Fix them in the file and import it again — rows already imported are skipped.</p>}
          <div className="max-h-[420px] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow><TableHead className="w-16">Row</TableHead><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Details</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shown.slice(0, 1000).map((r) => (
                  <TableRow key={r.row}>
                    <TableCell className="text-xs text-muted-foreground">{r.row}</TableCell>
                    <TableCell className="text-sm">{r.name}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "error" ? "destructive" : r.status === "exists" ? "secondary" : "default"}>
                        {r.status === "new" ? "New" : r.status === "exists" ? "Skip" : "Error"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.reason ?? r.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {shown.length > 1000 && <p className="text-xs text-muted-foreground">Showing the first 1000 rows.</p>}
        </div>
      )}
    </div>
  );
}

export function DataImportPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Import</CardTitle>
        <CardDescription>
          Moving from Vyapar, Busy, Marg, Hitech or another software? Export the Party list and Item list from it to Excel
          and upload them here. Parties come with their opening balance and items with their opening stock; old bills stay in the old software.
          Anything already in the ERP is skipped, so the same file can be uploaded again safely.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="parties">
          <TabsList>
            <TabsTrigger value="parties"><Users className="mr-2 h-4 w-4" /> Customers & Suppliers</TabsTrigger>
            <TabsTrigger value="items"><Package className="mr-2 h-4 w-4" /> Items & Stock</TabsTrigger>
          </TabsList>
          <TabsContent value="parties" className="mt-4"><ImportFlow kind="parties" /></TabsContent>
          <TabsContent value="items" className="mt-4"><ImportFlow kind="items" /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
