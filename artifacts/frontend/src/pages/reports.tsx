import { useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/use-auth";
import {
  useGetAuditLog,
  useGetLedgerReport,
  useListEntities,
  useGetSalesReport,
  useGetItemWiseSalesReport,
  useGetCustomerWiseSalesReport,
  useGetProductionReport,
  useGetTaxReport,
  useGetProfitLossReport,
  useGetBillWiseProfitReport,
  getGetAuditLogQueryKey,
  getGetLedgerReportQueryKey,
  getGetSalesReportQueryKey,
  getGetItemWiseSalesReportQueryKey,
  getGetCustomerWiseSalesReportQueryKey,
  getGetProductionReportQueryKey,
  getGetTaxReportQueryKey,
  getGetProfitLossReportQueryKey,
  getGetBillWiseProfitReportQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { format } from "date-fns";
import { Download, Search, FileSpreadsheet, FileText, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const fmt = (n: number | null | undefined) =>
  `₹${(Number(n ?? 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

type ExportRow = (string | number | null | undefined)[];

function sanitizeCell(c: string | number | null | undefined): string {
  let s = String(c ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function exportExcel(baseName: string, sheetName: string, rows: ExportRow[]) {
  const data = rows.map(r => r.map(sanitizeCell));
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Report");
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}

function exportPDF(baseName: string, title: string, rows: ExportRow[]) {
  if (rows.length === 0) return;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const head = [rows[0].map(c => String(c ?? ""))];
  const body = rows.slice(1).map(r => r.map(c => String(c ?? "")));
  doc.setFontSize(14);
  doc.text(title, 40, 30);
  doc.setFontSize(9);
  doc.text(`Generated: ${format(new Date(), "dd-MM-yyyy HH:mm")}`, 40, 46);
  autoTable(doc, {
    head, body,
    startY: 60,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [120, 53, 15], textColor: 255 },
    alternateRowStyles: { fillColor: [250, 245, 235] },
    margin: { left: 30, right: 30 },
  });
  doc.save(`${baseName}.pdf`);
}

/* ───────── Shared layout pieces ─────────
   Every tab follows the same shape so the page reads the same on a phone:
   a filter grid (From/To side by side, search full width, then type + export),
   a stacked card list below md, and the full table from md up. */

function ReportCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="p-4 sm:p-6">
        <CardTitle className="text-lg sm:text-2xl">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="px-3 pb-4 sm:px-6 sm:pb-6">{children}</CardContent>
    </Card>
  );
}

function FilterBar({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 items-end mb-4 sm:flex sm:flex-wrap">{children}</div>;
}

function ExportMenu({
  disabled, baseName, sheetName, title, rows, wide,
}: { disabled?: boolean; baseName: string; sheetName: string; title: string; rows: ExportRow[]; wide?: boolean }) {
  return (
    <div className={`sm:ml-auto ${wide ? "col-span-2" : ""}`}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={disabled} className="w-full sm:w-auto">
            <Download className="w-4 h-4 mr-1.5" /> Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => exportExcel(baseName, sheetName, rows)}>
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => exportPDF(baseName, title, rows)}>
            <FileText className="w-4 h-4 mr-2" /> PDF (.pdf)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; }) {
  return (
    <>
      <div className="space-y-1.5 min-w-0">
        <label className="text-xs font-medium text-muted-foreground">From</label>
        <Input type="date" value={from} onChange={e => onFrom(e.target.value)} className="w-full sm:w-[160px]" />
      </div>
      <div className="space-y-1.5 min-w-0">
        <label className="text-xs font-medium text-muted-foreground">To</label>
        <Input type="date" value={to} onChange={e => onTo(e.target.value)} className="w-full sm:w-[160px]" />
      </div>
    </>
  );
}

function TypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Type</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-[140px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="gst">GST</SelectItem>
          <SelectItem value="non_gst">Non-GST</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

type SortDir = "asc" | "desc";

function SortableHead<K extends string>({
  label, sortKey, activeKey, dir, onSort, className,
}: { label: string; sortKey: K; activeKey: K | null; dir: SortDir; onSort: (key: K) => void; className?: string }) {
  const active = activeKey === sortKey;
  const Icon = active ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${active ? "text-foreground font-semibold" : ""}`}
        title={active ? (dir === "asc" ? "Sorted ascending — click for descending" : "Sorted descending — click for ascending") : "Click to sort"}
      >
        {label}
        <Icon className="w-3.5 h-3.5" />
      </button>
    </TableHead>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5 col-span-2 sm:col-span-1">
      <label className="text-xs font-medium text-muted-foreground">Search</label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? "Search…"}
          className="pl-8 w-full sm:w-[220px]"
        />
      </div>
    </div>
  );
}

/** Desktop-only wrapper around a full table. */
function DesktopTable({ children }: { children: ReactNode }) {
  return <div className="hidden md:block border rounded-md overflow-x-auto">{children}</div>;
}

/** Phone-only stacked list, with the shared loading / empty states. */
function MobileList({ isLoading, isEmpty, emptyText, children }: {
  isLoading?: boolean; isEmpty: boolean; emptyText: string; children: ReactNode;
}) {
  return (
    <div className="md:hidden space-y-2">
      {isLoading ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg">Loading…</div>
      ) : isEmpty ? (
        <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg">{emptyText}</div>
      ) : children}
    </div>
  );
}

/** One row of a report, as a card. `title`/`sub` on the left, the headline amount on the right, details below. */
function MobileRow({ title, sub, amount, amountClass, children }: {
  title: ReactNode; sub?: ReactNode; amount?: ReactNode; amountClass?: string; children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-sm break-words">{title}</div>
          {sub && <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5">{sub}</div>}
        </div>
        {amount !== undefined && (
          <div className={`text-sm font-semibold tabular-nums whitespace-nowrap ${amountClass ?? ""}`}>{amount}</div>
        )}
      </div>
      {children && <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 mt-2 pt-2 border-t">{children}</div>}
    </div>
  );
}

/** Small label / value pair used inside MobileRow and MobileTotals. */
function KV({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xs tabular-nums font-medium truncate ${className ?? ""}`}>{value}</div>
    </div>
  );
}

/** Totals summary pinned above the phone list (desktop shows them in the table footer). */
function MobileTotals({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="md:hidden rounded-lg border bg-muted/50 p-3 mb-2">
      <div className="text-xs font-semibold mb-2">{label}</div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-2">{children}</div>
    </div>
  );
}

/** KPI tile used by the Tax, P&L and Bill-wise tabs. */
function StatTile({ label, value, sub, className, big }: {
  label: string; value: ReactNode; sub?: ReactNode; className?: string; big?: boolean;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-3 sm:pt-4 sm:p-6">
        <div className="text-[10px] sm:text-xs uppercase text-muted-foreground">{label}</div>
        <div className={`${big ? "text-lg sm:text-2xl" : "text-base sm:text-xl"} font-bold tabular-nums mt-1 break-words`}>{value}</div>
        {sub && <div className="text-[11px] sm:text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <Badge variant={type === "gst" ? "default" : "secondary"} className="uppercase text-[10px] px-1.5 py-0">
      {type.replace("_", " ")}
    </Badge>
  );
}

export default function Reports() {
  const { user } = useAuth();
  // Read-only CA login: only the GST reports (the server refuses the rest anyway).
  const gstOnly = user?.role === "gst_accountant";
  const tabs = [
    { value: "sales", label: "Sales (GST)", show: true },
    { value: "item-wise", label: "Item-wise", show: !gstOnly },
    { value: "customer-wise", label: "Customer-wise", show: !gstOnly },
    { value: "production", label: "Production", show: !gstOnly },
    { value: "tax", label: "Input / Output Tax", show: true },
    { value: "pnl", label: "Profit & Loss", show: !gstOnly },
    { value: "bill-wise-profit", label: "Bill-wise Profit Margin", show: !gstOnly },
    { value: "ledger", label: "Ledger", show: !gstOnly },
    { value: "audit", label: "Audit Log", show: !gstOnly },
  ].filter(t => t.show);
  const [tab, setTab] = useState("sales");

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Reports & Ledgers</h1>
        <p className="text-sm text-muted-foreground mt-1">Sales, taxes, production, profitability and audit trail.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        {/* Nine tabs wrap into a ragged block on a phone — a single picker reads better there. */}
        <div className="md:hidden">
          <Select value={tab} onValueChange={setTab}>
            <SelectTrigger className="w-full h-11 font-medium" data-testid="select-report-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tabs.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <TabsList className="hidden md:flex flex-wrap h-auto justify-start gap-1">
          {tabs.map(t => <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>)}
        </TabsList>

        <TabsContent value="sales" className="mt-4 md:mt-6"><SalesTab /></TabsContent>
        {!gstOnly && <TabsContent value="item-wise" className="mt-4 md:mt-6"><ItemWiseTab /></TabsContent>}
        {!gstOnly && <TabsContent value="customer-wise" className="mt-4 md:mt-6"><CustomerWiseTab /></TabsContent>}
        {!gstOnly && <TabsContent value="production" className="mt-4 md:mt-6"><ProductionTab /></TabsContent>}
        <TabsContent value="tax" className="mt-4 md:mt-6"><TaxTab /></TabsContent>
        {!gstOnly && <TabsContent value="pnl" className="mt-4 md:mt-6"><PnLTab /></TabsContent>}
        {!gstOnly && <TabsContent value="bill-wise-profit" className="mt-4 md:mt-6"><BillWiseProfitTab /></TabsContent>}
        {!gstOnly && <TabsContent value="ledger" className="mt-4 md:mt-6"><LedgerTab /></TabsContent>}
        {!gstOnly && <TabsContent value="audit" className="mt-4 md:mt-6"><AuditTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

/* ───────── SALES (GST) ───────── */
function SalesTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");

  const params: any = { from: from || undefined, to: to || undefined, type, search: search || undefined };
  const { data, isLoading } = useGetSalesReport(params, { query: { queryKey: getGetSalesReportQueryKey(params) } });

  const items = data?.items ?? [];
  const t = data?.totals;

  const exportRows: ExportRow[] = [
    ["Invoice No", "Date", "Type", "Customer", "GSTIN", "Subtotal", "CGST", "SGST", "IGST", "Tax", "Grand Total", "Paid", "Balance", "Status"],
    ...items.map(i => [
      i.invoiceNo, format(new Date(i.invoiceDate), "dd-MM-yyyy"), i.invoiceType,
      i.customerName ?? "—", i.customerGstin ?? "",
      i.subtotal, i.cgst, i.sgst, i.igst, i.totalTax, i.grandTotal, i.amountPaid, i.balanceDue, i.status,
    ] as ExportRow),
  ];

  return (
    <ReportCard title="Sales Report" description="All saved invoices with tax breakup.">
      <FilterBar>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SearchBox value={search} onChange={setSearch} placeholder="Invoice / customer…" />
        <TypeSelect value={type} onChange={setType} />
        <ExportMenu disabled={!items.length} baseName={`sales-report-${Date.now()}`} sheetName="Sales" title="Sales Report" rows={exportRows} />
      </FilterBar>

      {t && items.length > 0 && (
        <MobileTotals label={`Total (${t.count} invoices)`}>
          <KV label="Subtotal" value={fmt(t.subtotal)} />
          <KV label="Grand Total" value={fmt(t.grandTotal)} className="font-semibold" />
          <KV label="Balance" value={fmt(t.balanceDue)} className="text-amber-600" />
          <KV label="CGST" value={fmt(t.cgst)} />
          <KV label="SGST" value={fmt(t.sgst)} />
          <KV label="IGST" value={fmt(t.igst)} />
        </MobileTotals>
      )}
      <MobileList isLoading={isLoading} isEmpty={items.length === 0} emptyText="No invoices in this range.">
        {items.map((i, idx) => (
          <MobileRow
            key={i.id ?? `deleted-${idx}`}
            title={i.customerName ?? "—"}
            sub={<>
              <span className="font-mono">{i.invoiceNo}</span>
              <span>· {format(new Date(i.invoiceDate), "dd-MM-yyyy")}</span>
              <TypeBadge type={i.invoiceType} />
              {(i as any).deleted && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Deleted</Badge>}
            </>}
            amount={fmt(i.grandTotal)}
          >
            <KV label="Subtotal" value={fmt(i.subtotal)} />
            <KV label="Tax" value={fmt(i.totalTax)} />
            <KV label="Balance" value={fmt(i.balanceDue)} className={(i.balanceDue ?? 0) > 0 ? "text-amber-600" : ""} />
            {i.customerGstin && <div className="col-span-3 text-[11px] text-muted-foreground font-mono truncate">GSTIN {i.customerGstin}</div>}
            <div className="col-span-3"><Badge variant="outline" className="text-[10px]">{i.status}</Badge></div>
          </MobileRow>
        ))}
      </MobileList>

      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>GSTIN</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">CGST</TableHead>
              <TableHead className="text-right">SGST</TableHead>
              <TableHead className="text-right">IGST</TableHead>
              <TableHead className="text-right">Grand Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={12} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No invoices in this range.</TableCell></TableRow>
            ) : items.map((i, idx) => (
              <TableRow key={i.id ?? `deleted-${idx}`}>
                <TableCell className="font-mono text-xs">
                  {i.invoiceNo}
                  {(i as any).deleted && <Badge variant="outline" className="ml-1.5 text-[10px] text-muted-foreground">Deleted</Badge>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{format(new Date(i.invoiceDate), "dd-MM-yyyy")}</TableCell>
                <TableCell>
                  <Badge variant={i.invoiceType === "gst" ? "default" : "secondary"} className="uppercase">{i.invoiceType.replace("_", " ")}</Badge>
                </TableCell>
                <TableCell className="font-medium">{i.customerName ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{i.customerGstin ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.subtotal)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.cgst)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.sgst)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.igst)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(i.grandTotal)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.balanceDue)}</TableCell>
                <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
          {t && items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5} className="font-semibold">Total ({t.count} invoices)</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.subtotal)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.cgst)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.sgst)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.igst)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.grandTotal)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.balanceDue)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </DesktopTable>
    </ReportCard>
  );
}

/* ───────── ITEM-WISE ───────── */
function ItemWiseTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");

  const params: any = { from: from || undefined, to: to || undefined, type, search: search || undefined };
  const { data, isLoading } = useGetItemWiseSalesReport(params, { query: { queryKey: getGetItemWiseSalesReportQueryKey(params) } });
  const items = data?.items ?? [];
  const t = data?.totals;

  const exportRows: ExportRow[] = [
    ["Product", "HSN", "Unit", "Invoices", "Qty", "Amount", "Tax", "Total"],
    ...items.map(i => [i.productName, i.hsnCode ?? "", i.unit, i.invoices, i.qty, i.amount, i.tax, i.total] as ExportRow),
  ];

  return (
    <ReportCard title="Item-wise Sales" description="Qty sold and revenue per product.">
      <FilterBar>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SearchBox value={search} onChange={setSearch} placeholder="Product / HSN…" />
        <TypeSelect value={type} onChange={setType} />
        <ExportMenu disabled={!items.length} baseName={`item-wise-sales-${Date.now()}`} sheetName="Item-wise" title="Item-wise Sales" rows={exportRows} />
      </FilterBar>

      {t && items.length > 0 && (
        <MobileTotals label={`Total (${t.count} items)`}>
          <KV label="Qty" value={fmtQty(t.qty)} />
          <KV label="Amount" value={fmt(t.amount)} />
          <KV label="Total" value={fmt(t.total)} className="font-semibold" />
        </MobileTotals>
      )}
      <MobileList isLoading={isLoading} isEmpty={items.length === 0} emptyText="No data.">
        {items.map(i => (
          <MobileRow
            key={i.productId}
            title={i.productName}
            sub={<>{i.hsnCode && <span className="font-mono">HSN {i.hsnCode}</span>}<span>· {i.invoices} invoices</span></>}
            amount={fmt(i.total)}
          >
            <KV label="Qty" value={`${fmtQty(i.qty)} ${i.unit}`} />
            <KV label="Amount" value={fmt(i.amount)} />
            <KV label="Tax" value={fmt(i.tax)} />
          </MobileRow>
        ))}
      </MobileList>

      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>HSN</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No data.</TableCell></TableRow>
            ) : items.map(i => (
              <TableRow key={i.productId}>
                <TableCell className="font-medium">{i.productName}</TableCell>
                <TableCell className="font-mono text-xs">{i.hsnCode ?? "—"}</TableCell>
                <TableCell>{i.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{i.invoices}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(i.qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.amount)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(i.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {t && items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-semibold">Total ({t.count} items)</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmtQty(t.qty)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.amount)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.total)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </DesktopTable>
    </ReportCard>
  );
}

/* ───────── CUSTOMER-WISE ───────── */
function CustomerWiseTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");

  const params: any = { from: from || undefined, to: to || undefined, type, search: search || undefined };
  const { data, isLoading } = useGetCustomerWiseSalesReport(params, { query: { queryKey: getGetCustomerWiseSalesReportQueryKey(params) } });
  const rawItems = data?.items ?? [];
  const t = data?.totals;

  const [sortKey, setSortKey] = useState<"qty" | "total" | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const handleSort = (key: "qty" | "total") => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };
  const items = useMemo(() => {
    if (!sortKey) return rawItems;
    const sorted = [...rawItems].sort((a, b) => a[sortKey] - b[sortKey]);
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [rawItems, sortKey, sortDir]);

  const exportRows: ExportRow[] = [
    ["Customer", "Invoices", "Qty", "Subtotal", "Tax", "Total", "Paid", "Balance"],
    ...items.map(i => [i.customerName, i.invoices, i.qty, i.subtotal, i.tax, i.total, i.paid, i.balance] as ExportRow),
  ];

  // The table headers carry the sort toggles on desktop; on a phone there are
  // no headers, so the same sort state is driven from a small picker.
  const mobileSort = sortKey ? `${sortKey}-${sortDir}` : "none";
  const setMobileSort = (v: string) => {
    if (v === "none") { setSortKey(null); return; }
    const [k, d] = v.split("-") as ["qty" | "total", SortDir];
    setSortKey(k);
    setSortDir(d);
  };

  return (
    <ReportCard title="Customer-wise Sales" description="Sales and outstanding per customer.">
      <FilterBar>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SearchBox value={search} onChange={setSearch} placeholder="Customer name…" />
        <TypeSelect value={type} onChange={setType} />
        <ExportMenu disabled={!items.length} baseName={`customer-wise-sales-${Date.now()}`} sheetName="Customer-wise" title="Customer-wise Sales" rows={exportRows} />
        <div className="space-y-1.5 col-span-2 md:hidden">
          <label className="text-xs font-medium text-muted-foreground">Sort by</label>
          <Select value={mobileSort} onValueChange={setMobileSort}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Default</SelectItem>
              <SelectItem value="total-desc">Total — high to low</SelectItem>
              <SelectItem value="total-asc">Total — low to high</SelectItem>
              <SelectItem value="qty-desc">Qty — high to low</SelectItem>
              <SelectItem value="qty-asc">Qty — low to high</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      {t && items.length > 0 && (
        <MobileTotals label={`Total (${t.count} customers)`}>
          <KV label="Total" value={fmt(t.total)} className="font-semibold" />
          <KV label="Paid" value={fmt(t.paid)} className="text-emerald-600" />
          <KV label="Balance" value={fmt(t.balance)} className="text-amber-600" />
          <KV label="Qty (Ltr)" value={fmtQty(t.qty)} />
          <KV label="Subtotal" value={fmt(t.subtotal)} />
          <KV label="Tax" value={fmt(t.tax)} />
        </MobileTotals>
      )}
      <MobileList isLoading={isLoading} isEmpty={items.length === 0} emptyText="No data.">
        {items.map((i, idx) => (
          <MobileRow
            key={`${i.customerId ?? "x"}-${idx}`}
            title={i.customerName}
            sub={<span>{i.invoices} invoices · {fmtQty(i.qty)} Ltr</span>}
            amount={fmt(i.total)}
          >
            <KV label="Paid" value={fmt(i.paid)} className="text-emerald-600" />
            <KV label="Balance" value={fmt(i.balance)} className="text-amber-600" />
            <KV label="Tax" value={fmt(i.tax)} />
          </MobileRow>
        ))}
      </MobileList>

      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <SortableHead className="text-right" label="Qty (Ltr)" sortKey="qty" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <TableHead className="text-right">Subtotal</TableHead>
              <TableHead className="text-right">Tax</TableHead>
              <SortableHead className="text-right" label="Total" sortKey="total" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No data.</TableCell></TableRow>
            ) : items.map((i, idx) => (
              <TableRow key={`${i.customerId ?? "x"}-${idx}`}>
                <TableCell className="font-medium">{i.customerName}</TableCell>
                <TableCell className="text-right tabular-nums">{i.invoices}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtQty(i.qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.subtotal)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(i.total)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">{fmt(i.paid)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-600">{fmt(i.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {t && items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">Total ({t.count})</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums font-semibold">{fmtQty(t.qty)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.subtotal)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.tax)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.total)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.paid)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.balance)}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </DesktopTable>
    </ReportCard>
  );
}

/* ───────── PRODUCTION ───────── */
function ProductionTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const params = { from: from || undefined, to: to || undefined, search: search || undefined };
  const { data, isLoading } = useGetProductionReport(params, { query: { queryKey: getGetProductionReportQueryKey(params) } });
  const items = data?.items ?? [];
  const summary = data?.summary ?? [];
  const t = data?.totals;

  const exportRows: ExportRow[] = [
    ["Date", "Product", "Qty", "Unit", "Worker", "Order Type", "Cost"],
    ...items.map(i => [
      i.completedAt ? format(new Date(i.completedAt), "dd-MM-yyyy HH:mm") : "",
      i.productName, i.qty, i.unit, i.workerName ?? "", i.orderType, i.cost,
    ] as ExportRow),
  ];

  return (
    <div className="space-y-4">
      <ReportCard title="Production Summary" description="Finished goods produced per product.">
        <FilterBar>
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <SearchBox value={search} onChange={setSearch} placeholder="Product / worker…" />
          <ExportMenu wide disabled={!items.length} baseName={`production-${Date.now()}`} sheetName="Production" title="Production Report" rows={exportRows} />
        </FilterBar>

        {t && summary.length > 0 && (
          <MobileTotals label="Total">
            <KV label="Batches" value={t.count} />
            <KV label="Qty" value={fmtQty(t.qty)} />
            <KV label="Cost" value={fmt(t.cost)} className="font-semibold" />
          </MobileTotals>
        )}
        <MobileList isLoading={isLoading} isEmpty={summary.length === 0} emptyText="No production in this range.">
          {summary.map(s => (
            <MobileRow
              key={s.productId}
              title={s.productName}
              sub={<span>{s.batches} batches</span>}
              amount={`${fmtQty(s.qty)} ${s.unit}`}
            >
              <KV label="Cost" value={fmt(s.cost)} />
            </MobileRow>
          ))}
        </MobileList>

        <DesktopTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Batches</TableHead>
                <TableHead className="text-right">Qty Produced</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8">Loading…</TableCell></TableRow>
              ) : summary.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No production in this range.</TableCell></TableRow>
              ) : summary.map(s => (
                <TableRow key={s.productId}>
                  <TableCell className="font-medium">{s.productName}</TableCell>
                  <TableCell>{s.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.batches}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtQty(s.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(s.cost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {t && summary.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{t.count} batches</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmtQty(t.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{fmt(t.cost)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </DesktopTable>
      </ReportCard>

      <ReportCard title="Production Log" description="Individual completion entries.">
        <MobileList isEmpty={items.length === 0} emptyText="No entries.">
          {items.map(i => (
            <MobileRow
              key={i.id}
              title={i.productName}
              sub={<>
                <span>{i.completedAt ? format(new Date(i.completedAt), "dd-MM-yyyy HH:mm") : "—"}</span>
                {i.workerName && <span>· {i.workerName}</span>}
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{i.orderType.replace(/_/g, " ")}</Badge>
              </>}
              amount={`${fmtQty(i.qty)} ${i.unit}`}
            />
          ))}
        </MobileList>
        <DesktopTable>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Worker</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">No entries.</TableCell></TableRow>
              ) : items.map(i => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap">{i.completedAt ? format(new Date(i.completedAt), "dd-MM-yyyy HH:mm") : "—"}</TableCell>
                  <TableCell className="font-medium">{i.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtQty(i.qty)} {i.unit}</TableCell>
                  <TableCell>{i.workerName ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{i.orderType.replace(/_/g, " ")}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DesktopTable>
      </ReportCard>
    </div>
  );
}

/* ───────── TAX (Input/Output) ───────── */
function RateTable({ title, rows, split }: {
  title: string;
  rows: { rate: number; taxable: number; tax: number }[];
  split?: { cgst?: number; sgst?: number; igst?: number };
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-3">Rate</TableHead>
              <TableHead className="px-3 text-right">Taxable</TableHead>
              <TableHead className="px-3 text-right">Tax</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No data.</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.rate}>
                <TableCell className="px-3">{r.rate}%</TableCell>
                <TableCell className="px-3 text-right tabular-nums">{fmt(r.taxable)}</TableCell>
                <TableCell className="px-3 text-right tabular-nums">{fmt(r.tax)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-md bg-muted/50 p-2">
        <KV label="CGST" value={fmt(split?.cgst)} />
        <KV label="SGST" value={fmt(split?.sgst)} />
        <KV label="IGST" value={fmt(split?.igst)} />
      </div>
    </div>
  );
}

function TaxTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = { from: from || undefined, to: to || undefined };
  const { data, isLoading } = useGetTaxReport(params, { query: { queryKey: getGetTaxReportQueryKey(params) } });

  const o = data?.output;
  const i = data?.input;

  return (
    <ReportCard title="Input / Output GST" description="Tax collected from sales vs paid on purchases.">
      <FilterBar>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </FilterBar>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 mb-6">
            <StatTile
              label="Output Tax (Collected)"
              value={fmt(o?.total)}
              sub={<>on {fmt(o?.taxable)} taxable</>}
              className="bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900"
            />
            <StatTile
              label="Input Tax (Paid)"
              value={fmt(i?.total)}
              sub={<>on {fmt(i?.taxable)} taxable</>}
              className="bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900"
            />
            <StatTile
              big
              label="Net GST Payable"
              value={fmt(data.netPayable)}
              sub="Output − Input"
              className="col-span-2 md:col-span-1 bg-primary/5 border-primary/30"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RateTable title="Output Tax (Sales) by Rate" rows={data.outputByRate} split={o} />
            <RateTable title="Input Tax (Purchases) by Rate" rows={data.inputByRate} split={i} />
          </div>
        </>
      )}
    </ReportCard>
  );
}

/* ───────── P&L ───────── */
function PnLTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = { from: from || undefined, to: to || undefined };
  const { data, isLoading } = useGetProfitLossReport(params, { query: { queryKey: getGetProfitLossReportQueryKey(params) } });

  return (
    <ReportCard title="Profit & Loss" description="Revenue − COGS − Expenses = Net Profit. (Excludes GST.)">
      <FilterBar>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </FilterBar>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
      ) : (
        <div className="space-y-4">
          {/* Net Profit leads on a phone (full width, first) since it's the number people open this tab for. */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
            <StatTile
              big
              label="Net Profit"
              value={fmt(data.netProfit)}
              sub={<>Margin {data.netMargin.toFixed(1)}%</>}
              className={`col-span-2 md:col-span-1 md:order-5 ${data.netProfit >= 0 ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300" : "bg-rose-50 dark:bg-rose-950/40 border-rose-300"}`}
            />
            <StatTile label="Revenue (ex-GST)" value={fmt(data.revenue)} className="md:order-1" />
            <StatTile label="COGS" value={fmt(data.cogs)} className="md:order-2" />
            <StatTile
              label="Gross Profit"
              value={fmt(data.grossProfit)}
              sub={<>Margin {data.grossMargin.toFixed(1)}%</>}
              className="md:order-3 bg-emerald-50 dark:bg-emerald-950/40"
            />
            <StatTile label="Operating Expenses" value={fmt(data.expenses)} className="md:order-4" />
            <StatTile label="Purchases (Period)" value={fmt(data.purchases)} className="col-span-2 md:col-span-1 md:order-6" />
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2">Expenses by Category</h3>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="px-3">Category</TableHead>
                    <TableHead className="px-3 text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.expensesByCategory.length === 0 ? (
                    <TableRow><TableCell colSpan={2} className="text-center py-4 text-muted-foreground">No expenses.</TableCell></TableRow>
                  ) : data.expensesByCategory.map((e, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="px-3">{e.categoryName}</TableCell>
                      <TableCell className="px-3 text-right tabular-nums">{fmt(e.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}
    </ReportCard>
  );
}

/* ───────── BILL-WISE PROFIT MARGIN ───────── */
function BillWiseProfitTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");

  const params: any = { from: from || undefined, to: to || undefined, type, search: search || undefined };
  const { data, isLoading } = useGetBillWiseProfitReport(params, { query: { queryKey: getGetBillWiseProfitReportQueryKey(params) } });

  const items = data?.items ?? [];
  const t = data?.totals;

  const exportRows: ExportRow[] = [
    ["Invoice No", "Date", "Type", "Customer", "Revenue (ex-GST)", "COGS", "Profit", "Margin %", "Grand Total"],
    ...items.map(i => [
      i.invoiceNo, format(new Date(i.invoiceDate), "dd-MM-yyyy"), i.invoiceType,
      i.customerName ?? "—", i.revenue, i.cogs, i.profit, i.marginPct.toFixed(1), i.grandTotal,
    ] as ExportRow),
  ];

  return (
    <ReportCard title="Bill-wise Profit Margin" description="Revenue − COGS per invoice, using the cost snapshotted at sale time. (Excludes GST.)">
      <FilterBar>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SearchBox value={search} onChange={setSearch} placeholder="Invoice / customer…" />
        <TypeSelect value={type} onChange={setType} />
        <ExportMenu disabled={!items.length} baseName={`bill-wise-profit-${Date.now()}`} sheetName="Bill-wise Profit" title="Bill-wise Profit Margin" rows={exportRows} />
      </FilterBar>

      {t && items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3 mb-4">
          <StatTile label="Revenue (ex-GST)" value={fmt(t.revenue)} />
          <StatTile label="COGS" value={fmt(t.cogs)} />
          <StatTile
            label="Profit"
            value={fmt(t.profit)}
            sub={<>Margin {t.marginPct.toFixed(1)}% · {t.count} invoices</>}
            className={`col-span-2 md:col-span-1 ${t.profit >= 0 ? "bg-emerald-50 dark:bg-emerald-950/40" : "bg-rose-50 dark:bg-rose-950/40"}`}
          />
        </div>
      )}

      <MobileList isLoading={isLoading} isEmpty={items.length === 0} emptyText="No invoices in this range.">
        {items.map((i, idx) => (
          <MobileRow
            key={i.id ?? `deleted-${idx}`}
            title={i.customerName ?? "—"}
            sub={<>
              <span className="font-mono">{i.invoiceNo}</span>
              <span>· {format(new Date(i.invoiceDate), "dd-MM-yyyy")}</span>
              <TypeBadge type={i.invoiceType} />
              {(i as any).deleted && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Deleted</Badge>}
            </>}
            amount={fmt(i.profit)}
            amountClass={i.profit >= 0 ? "text-emerald-600" : "text-rose-600"}
          >
            <KV label="Revenue" value={fmt(i.revenue)} />
            <KV label="COGS" value={fmt(i.cogs)} />
            <KV label="Margin" value={`${i.marginPct.toFixed(1)}%`} className={i.marginPct >= 0 ? "text-emerald-600" : "text-rose-600"} />
          </MobileRow>
        ))}
      </MobileList>

      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice No</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">COGS</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No invoices in this range.</TableCell></TableRow>
            ) : items.map((i, idx) => (
              <TableRow key={i.id ?? `deleted-${idx}`}>
                <TableCell className="font-mono text-xs">
                  {i.invoiceNo}
                  {(i as any).deleted && <Badge variant="outline" className="ml-1.5 text-[10px] text-muted-foreground">Deleted</Badge>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{format(new Date(i.invoiceDate), "dd-MM-yyyy")}</TableCell>
                <TableCell>
                  <Badge variant={i.invoiceType === "gst" ? "default" : "secondary"} className="uppercase">{i.invoiceType.replace("_", " ")}</Badge>
                </TableCell>
                <TableCell className="font-medium">{i.customerName ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(i.cogs)}</TableCell>
                <TableCell className={`text-right tabular-nums font-semibold ${i.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(i.profit)}</TableCell>
                <TableCell className={`text-right tabular-nums ${i.marginPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{i.marginPct.toFixed(1)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {t && items.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4} className="font-semibold">Total ({t.count} invoices)</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.cogs)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(t.profit)}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{t.marginPct.toFixed(1)}%</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </DesktopTable>
    </ReportCard>
  );
}

/* ───────── LEDGER ───────── */
function LedgerTab() {
  const [entityId, setEntityId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const { data: entities } = useListEntities({});
  const params = {
    entityId: entityId !== "all" ? parseInt(entityId) : undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const { data: ledger, isLoading } = useGetLedgerReport(
    params,
    { query: { queryKey: getGetLedgerReportQueryKey(params) } },
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = ledger ?? [];
    if (!q) return arr;
    return arr.filter(e =>
      (e.description ?? "").toLowerCase().includes(q) ||
      (e.referenceNo ?? "").toLowerCase().includes(q) ||
      (e.type ?? "").toLowerCase().includes(q)
    );
  }, [ledger, search]);

  const exportRows: ExportRow[] = [
    ["Date", "Type", "Reference", "Description", "Debit", "Credit", "Balance"],
    ...filtered.map(e => [
      format(new Date(e.date), "dd-MM-yyyy"),
      e.type, e.referenceNo ?? "", e.description, e.debit, e.credit, e.balance,
    ] as ExportRow),
  ];

  return (
    <ReportCard title="Ledger Report" description="Filter transactions by entity, date and keyword.">
      <FilterBar>
        <div className="space-y-1.5 col-span-2 sm:col-span-1">
          <label className="text-xs font-medium text-muted-foreground">Entity</label>
          <Select value={entityId} onValueChange={setEntityId}>
            <SelectTrigger className="w-full sm:w-[240px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Entities</SelectItem>
              {entities?.map(e => (
                <SelectItem key={e.id} value={e.id.toString()}>{e.name} ({e.type})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <SearchBox value={search} onChange={setSearch} placeholder="Description / ref no…" />
        <ExportMenu wide disabled={!filtered.length} baseName={`ledger-${Date.now()}`} sheetName="Ledger" title="Ledger Report" rows={exportRows} />
      </FilterBar>

      <MobileList isLoading={isLoading} isEmpty={filtered.length === 0} emptyText="No ledger entries.">
        {filtered.map(e => (
          <MobileRow
            key={e.id}
            title={e.description}
            sub={<>
              <span>{format(new Date(e.date), "dd-MM-yyyy")}</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{e.type}</Badge>
              {e.referenceNo && <span className="font-mono">{e.referenceNo}</span>}
            </>}
            amount={e.credit ? fmt(e.credit) : e.debit ? fmt(e.debit) : "—"}
            amountClass={e.credit ? "text-emerald-600" : ""}
          >
            <KV label="Debit" value={e.debit ? fmt(e.debit) : "—"} />
            <KV label="Credit" value={e.credit ? fmt(e.credit) : "—"} className="text-emerald-600" />
            <KV label="Balance" value={fmt(e.balance)} className="font-semibold" />
          </MobileRow>
        ))}
      </MobileList>

      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No ledger entries.</TableCell></TableRow>
            ) : filtered.map(e => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap">{format(new Date(e.date), "dd-MM-yyyy")}</TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{e.type}</Badge></TableCell>
                <TableCell className="font-mono text-xs">{e.referenceNo ?? "—"}</TableCell>
                <TableCell>{e.description}</TableCell>
                <TableCell className="text-right tabular-nums">{e.debit ? fmt(e.debit) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">{e.credit ? fmt(e.credit) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums font-semibold">{fmt(e.balance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DesktopTable>
    </ReportCard>
  );
}

/* ───────── AUDIT ───────── */
function AuditTab() {
  const [search, setSearch] = useState("");
  const { data: logs, isLoading } = useGetAuditLog({ query: { queryKey: getGetAuditLogQueryKey() } });
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = logs ?? [];
    if (!q) return arr;
    return arr.filter(l =>
      (l.action ?? "").toLowerCase().includes(q) ||
      (l.description ?? "").toLowerCase().includes(q) ||
      (l.userName ?? "").toLowerCase().includes(q)
    );
  }, [logs, search]);

  return (
    <ReportCard title="System Audit Trail" description="Recent activity across the system.">
      <FilterBar>
        <SearchBox value={search} onChange={setSearch} placeholder="Action / user / description…" />
      </FilterBar>

      <MobileList isLoading={isLoading} isEmpty={filtered.length === 0} emptyText="No audit logs.">
        {filtered.map(l => (
          <div key={l.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[10px]">{l.action}</Badge>
              <span className="text-[11px] text-muted-foreground tabular-nums">{format(new Date(l.createdAt), "dd-MM-yyyy HH:mm")}</span>
            </div>
            <div className="text-sm mt-1.5 break-words">{l.description ?? "—"}</div>
            <div className="text-xs text-muted-foreground mt-1">by {l.userName ?? "—"}</div>
          </div>
        ))}
      </MobileList>

      <DesktopTable>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No audit logs.</TableCell></TableRow>
            ) : filtered.map(l => (
              <TableRow key={l.id}>
                <TableCell className="whitespace-nowrap">{format(new Date(l.createdAt), "dd-MM-yyyy HH:mm:ss")}</TableCell>
                <TableCell className="font-medium">{l.userName ?? "—"}</TableCell>
                <TableCell><Badge variant="outline">{l.action}</Badge></TableCell>
                <TableCell className="text-muted-foreground">{l.description ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DesktopTable>
    </ReportCard>
  );
}
