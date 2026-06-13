import { Fragment, useState } from "react";
import {
  useGetCommissionReport,
  getGetCommissionReportQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IndianRupee,
  Droplets,
  Loader2,
  ChevronRight,
  ChevronDown,
} from "lucide-react";

const fmt = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

export default function Commission() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const params = { from: from || undefined, to: to || undefined };
  const { data, isLoading } = useGetCommissionReport(params, {
    query: { queryKey: getGetCommissionReportQueryKey(params) },
  });

  const rows = data?.rows ?? [];

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <IndianRupee className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Commission</h1>
          <p className="text-sm text-muted-foreground">Salesman commission earned on sales.</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Commission</CardTitle>
            <IndianRupee className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary" data-testid="text-total-commission">
              {fmt(data?.totalCommission)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Liters</CardTitle>
            <Droplets className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-liters">
              {fmtQty(data?.totalLiters)}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Commission by Salesman</CardTitle>
          <CardDescription>Expand a row to see the product-wise breakdown.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 items-end mb-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-[160px]"
                data-testid="input-from-date"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-[160px]"
                data-testid="input-to-date"
              />
            </div>
            {(from || to) && (
              <Button
                variant="outline"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
                data-testid="button-clear-dates"
              >
                Clear
              </Button>
            )}
          </div>

          <div className="border rounded-md overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Salesman</TableHead>
                  <TableHead className="text-right">Liters</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading...
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No commission data for this range.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const isOpen = expanded.has(r.salesmanId);
                    const breakdown = r.productBreakdown ?? [];
                    return (
                      <Fragment key={r.salesmanId}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() => toggle(r.salesmanId)}
                          data-testid={`salesman-row-${r.salesmanId}`}
                        >
                          <TableCell>
                            {breakdown.length > 0 &&
                              (isOpen ? (
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-muted-foreground" />
                              ))}
                          </TableCell>
                          <TableCell className="font-medium">{r.salesmanName}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtQty(r.liters)}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {fmt(r.commission)}
                          </TableCell>
                        </TableRow>
                        {isOpen && breakdown.length > 0 && (
                          <TableRow key={`${r.salesmanId}-detail`} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={4} className="p-0">
                              <div className="p-3">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Product</TableHead>
                                      <TableHead className="text-right">Liters</TableHead>
                                      <TableHead className="text-right">₹/L</TableHead>
                                      <TableHead className="text-right">Commission</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {breakdown.map((b) => (
                                      <TableRow
                                        key={b.productId}
                                        data-testid={`breakdown-row-${r.salesmanId}-${b.productId}`}
                                      >
                                        <TableCell>{b.productName}</TableCell>
                                        <TableCell className="text-right tabular-nums">{fmtQty(b.liters)}</TableCell>
                                        <TableCell className="text-right tabular-nums">
                                          {fmt(b.commissionPerLiter)}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums font-medium">
                                          {fmt(b.commission)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
              {rows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-semibold">
                      Total
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {fmtQty(data?.totalLiters)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {fmt(data?.totalCommission)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
