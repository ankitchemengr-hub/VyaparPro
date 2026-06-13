import { useMemo, useState } from "react";
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
  getGetAuditLogQueryKey,
  getGetLedgerReportQueryKey,
  getGetSalesReportQueryKey,
  getGetItemWiseSalesReportQueryKey,
  getGetCustomerWiseSalesReportQueryKey,
  getGetProductionReportQueryKey,
  getGetTaxReportQueryKey,
  getGetProfitLossReportQueryKey,
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
import { Download, Search, FileSpreadsheet, FileText } from "lucide-react";
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

function ExportMenu({
  disabled, baseName, sheetName, title, rows,
}: { disabled?: boolean; baseName: string; sheetName: string; title: string; rows: ExportRow[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={disabled}>
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
  );
}

function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; }) {
  return (
    <>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">From</label>
        <Input type="date" value={from} onChange={e => onFrom(e.target.value)} className="w-[160px]" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">To</label>
        <Input type="date" value={to} onChange={e => onTo(e.target.value)} className="w-[160px]" />
      </div>
    </>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">Search</label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? "Search…"}
          className="pl-8 w-[220px]"
        />
      </div>
    </div>
  );
}

export default function Reports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports & Ledgers</h1>
        <p className="text-sm text-muted-foreground mt-1">Sales, taxes, production, profitability and audit trail.</p>
      </div>

      <Tabs defaultValue="sales" className="w-full">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          <TabsTrigger value="sales">Sales (GST)</TabsTrigger>
          <TabsTrigger value="item-wise">Item-wise</TabsTrigger>
          <TabsTrigger value="customer-wise">Customer-wise</TabsTrigger>
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="tax">Input / Output Tax</TabsTrigger>
          <TabsTrigger value="pnl">Profit & Loss</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-6"><SalesTab /></TabsContent>
        <TabsContent value="item-wise" className="mt-6"><ItemWiseTab /></TabsContent>
        <TabsContent value="customer-wise" className="mt-6"><CustomerWiseTab /></TabsContent>
        <TabsContent value="production" className="mt-6"><ProductionTab /></TabsContent>
        <TabsContent value="tax" className="mt-6"><TaxTab /></TabsContent>
        <TabsContent value="pnl" className="mt-6"><PnLTab /></TabsContent>
        <TabsContent value="ledger" className="mt-6"><LedgerTab /></TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditTab /></TabsContent>
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
    <Card>
      <CardHeader>
        <CardTitle>Sales Report</CardTitle>
        <CardDescription>All saved invoices with tax breakup.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="gst">GST</SelectItem>
                <SelectItem value="non_gst">Non-GST</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Invoice / customer…" />
          <div className="ml-auto">
            <ExportMenu disabled={!items.length} baseName={`sales-report-${Date.now()}`} sheetName="Sales" title="Sales Report" rows={exportRows} />
          </div>
        </div>

        <div className="border rounded-md overflow-x-auto">
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
              ) : items.map(i => (
                <TableRow key={i.id}>
                  <TableCell className="font-mono text-xs">{i.invoiceNo}</TableCell>
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
        </div>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Item-wise Sales</CardTitle>
        <CardDescription>Qty sold and revenue per product.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="gst">GST</SelectItem>
                <SelectItem value="non_gst">Non-GST</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Product / HSN…" />
          <div className="ml-auto">
            <ExportMenu disabled={!items.length} baseName={`item-wise-sales-${Date.now()}`} sheetName="Item-wise" title="Item-wise Sales" rows={exportRows} />
          </div>
        </div>

        <div className="border rounded-md overflow-x-auto">
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
        </div>
      </CardContent>
    </Card>
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
  const items = data?.items ?? [];
  const t = data?.totals;

  const exportRows: ExportRow[] = [
    ["Customer", "Invoices", "Qty", "Subtotal", "Tax", "Total", "Paid", "Balance"],
    ...items.map(i => [i.customerName, i.invoices, i.qty, i.subtotal, i.tax, i.total, i.paid, i.balance] as ExportRow),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer-wise Sales</CardTitle>
        <CardDescription>Sales and outstanding per customer.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="gst">GST</SelectItem>
                <SelectItem value="non_gst">Non-GST</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Customer name…" />
          <div className="ml-auto">
            <ExportMenu disabled={!items.length} baseName={`customer-wise-sales-${Date.now()}`} sheetName="Customer-wise" title="Customer-wise Sales" rows={exportRows} />
          </div>
        </div>

        <div className="border rounded-md overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Qty (Ltr)</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
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
        </div>
      </CardContent>
    </Card>
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
      <Card>
        <CardHeader>
          <CardTitle>Production Summary</CardTitle>
          <CardDescription>Finished goods produced per product.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
            <SearchBox value={search} onChange={setSearch} placeholder="Product / worker…" />
            <div className="ml-auto">
              <ExportMenu disabled={!items.length} baseName={`production-${Date.now()}`} sheetName="Production" title="Production Report" rows={exportRows} />
            </div>
          </div>

          <div className="border rounded-md overflow-x-auto">
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Production Log</CardTitle>
          <CardDescription>Individual completion entries.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md overflow-x-auto">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────── TAX (Input/Output) ───────── */
function TaxTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = { from: from || undefined, to: to || undefined };
  const { data, isLoading } = useGetTaxReport(params, { query: { queryKey: getGetTaxReportQueryKey(params) } });

  const o = data?.output;
  const i = data?.input;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Input / Output GST</CardTitle>
          <CardDescription>Tax collected from sales vs paid on purchases.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
          </div>

          {isLoading || !data ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                <Card className="bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900">
                  <CardContent className="pt-4">
                    <div className="text-xs uppercase text-muted-foreground">Output Tax (Collected)</div>
                    <div className="text-2xl font-bold tabular-nums mt-1">{fmt(o?.total)}</div>
                    <div className="text-xs text-muted-foreground mt-1">on {fmt(o?.taxable)} taxable</div>
                  </CardContent>
                </Card>
                <Card className="bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900">
                  <CardContent className="pt-4">
                    <div className="text-xs uppercase text-muted-foreground">Input Tax (Paid)</div>
                    <div className="text-2xl font-bold tabular-nums mt-1">{fmt(i?.total)}</div>
                    <div className="text-xs text-muted-foreground mt-1">on {fmt(i?.taxable)} taxable</div>
                  </CardContent>
                </Card>
                <Card className="bg-primary/5 border-primary/30">
                  <CardContent className="pt-4">
                    <div className="text-xs uppercase text-muted-foreground">Net GST Payable</div>
                    <div className="text-2xl font-bold tabular-nums mt-1">{fmt(data.netPayable)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Output − Input</div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Output Tax (Sales) by Rate</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.outputByRate.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No data.</TableCell></TableRow>
                      ) : data.outputByRate.map(r => (
                        <TableRow key={r.rate}>
                          <TableCell>{r.rate}%</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(r.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(r.tax)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>CGST: <span className="font-semibold text-foreground tabular-nums">{fmt(o?.cgst)}</span></div>
                    <div>SGST: <span className="font-semibold text-foreground tabular-nums">{fmt(o?.sgst)}</span></div>
                    <div>IGST: <span className="font-semibold text-foreground tabular-nums">{fmt(o?.igst)}</span></div>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-2">Input Tax (Purchases) by Rate</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Rate</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">Tax</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.inputByRate.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-4">No data.</TableCell></TableRow>
                      ) : data.inputByRate.map(r => (
                        <TableRow key={r.rate}>
                          <TableCell>{r.rate}%</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(r.taxable)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmt(r.tax)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>CGST: <span className="font-semibold text-foreground tabular-nums">{fmt(i?.cgst)}</span></div>
                    <div>SGST: <span className="font-semibold text-foreground tabular-nums">{fmt(i?.sgst)}</span></div>
                    <div>IGST: <span className="font-semibold text-foreground tabular-nums">{fmt(i?.igst)}</span></div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────── P&L ───────── */
function PnLTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = { from: from || undefined, to: to || undefined };
  const { data, isLoading } = useGetProfitLossReport(params, { query: { queryKey: getGetProfitLossReportQueryKey(params) } });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profit &amp; Loss</CardTitle>
        <CardDescription>Revenue − COGS − Expenses = Net Profit. (Excludes GST.)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </div>

        {isLoading || !data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs uppercase text-muted-foreground">Revenue (ex-GST)</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{fmt(data.revenue)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs uppercase text-muted-foreground">COGS</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{fmt(data.cogs)}</div>
                </CardContent>
              </Card>
              <Card className="bg-emerald-50 dark:bg-emerald-950/40">
                <CardContent className="pt-4">
                  <div className="text-xs uppercase text-muted-foreground">Gross Profit</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{fmt(data.grossProfit)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Margin {data.grossMargin.toFixed(1)}%</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs uppercase text-muted-foreground">Operating Expenses</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{fmt(data.expenses)}</div>
                </CardContent>
              </Card>
              <Card className={data.netProfit >= 0 ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300" : "bg-rose-50 dark:bg-rose-950/40 border-rose-300"}>
                <CardContent className="pt-4">
                  <div className="text-xs uppercase text-muted-foreground">Net Profit</div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{fmt(data.netProfit)}</div>
                  <div className="text-xs text-muted-foreground mt-1">Margin {data.netMargin.toFixed(1)}%</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-xs uppercase text-muted-foreground">Purchases (Period)</div>
                  <div className="text-xl font-bold tabular-nums mt-1">{fmt(data.purchases)}</div>
                </CardContent>
              </Card>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Expenses by Category</h3>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.expensesByCategory.length === 0 ? (
                      <TableRow><TableCell colSpan={2} className="text-center py-4 text-muted-foreground">No expenses.</TableCell></TableRow>
                    ) : data.expensesByCategory.map((e, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{e.categoryName}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmt(e.total)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Ledger Report</CardTitle>
        <CardDescription>Filter transactions by entity, date and keyword.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Entity</label>
            <Select value={entityId} onValueChange={setEntityId}>
              <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
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
          <div className="ml-auto">
            <ExportMenu disabled={!filtered.length} baseName={`ledger-${Date.now()}`} sheetName="Ledger" title="Ledger Report" rows={exportRows} />
          </div>
        </div>

        <div className="border rounded-md overflow-x-auto">
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
        </div>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>System Audit Trail</CardTitle>
        <CardDescription>Recent activity across the system.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <SearchBox value={search} onChange={setSearch} placeholder="Action / user / description…" />
        </div>
        <div className="border rounded-md overflow-x-auto">
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
        </div>
      </CardContent>
    </Card>
  );
}
