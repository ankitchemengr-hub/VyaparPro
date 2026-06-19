import { Fragment, useState } from "react";
import { useAuth } from "@/contexts/use-auth";
import {
  useGetCommissionReport,
  getGetCommissionReportQueryKey,
  useGetCommissionTransactions,
  getCommissionTransactionsQueryKey,
  useMarkTransactionPaid,
  useBulkPayCommission,
  useGetCommissionSalesmenSummary,
  getCommissionSalesmenSummaryQueryKey,
  useGetCommissionPaymentHistory,
  getCommissionPaymentHistoryQueryKey,
  useListEntities,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  IndianRupee, Droplets, Loader2, ChevronRight, ChevronDown, CheckCircle2, CreditCard, History,
} from "lucide-react";

const fmt = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtQty = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

function StatusBadge({ status }: { status: string }) {
  if (status === "paid") {
    return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Paid</Badge>;
  }
  return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pending</Badge>;
}

export default function Commission() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "admin" || user?.role === "accountant";
  const isSalesman = user?.role === "salesman";

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  const [txStatus, setTxStatus] = useState<string>("all");
  const [txSalesmanId, setTxSalesmanId] = useState<string>("all");

  const [bulkPaySalesman, setBulkPaySalesman] = useState<{ id: number; name: string; pending: number } | null>(null);
  const [bulkRef, setBulkRef] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [payRef, setPayRef] = useState<Record<number, string>>({});

  const reportParams = { from: from || undefined, to: to || undefined };
  const { data, isLoading: reportLoading } = useGetCommissionReport(reportParams, {
    query: { queryKey: getGetCommissionReportQueryKey(reportParams) },
  });

  const txParams = {
    from: txFrom || undefined,
    to: txTo || undefined,
    status: txStatus !== "all" ? (txStatus as "pending" | "paid") : undefined,
    salesmanId: txSalesmanId !== "all" ? Number(txSalesmanId) : undefined,
  };
  const { data: txData, isLoading: txLoading } = useGetCommissionTransactions(txParams, {
    query: { queryKey: getCommissionTransactionsQueryKey(txParams) },
  });

  const { data: salesmenSummary } = useGetCommissionSalesmenSummary({
    query: { enabled: isAdmin, queryKey: getCommissionSalesmenSummaryQueryKey() },
  });

  const { data: paymentHistory } = useGetCommissionPaymentHistory(
    txSalesmanId !== "all" ? Number(txSalesmanId) : undefined,
    { query: { enabled: isAdmin, queryKey: getCommissionPaymentHistoryQueryKey(txSalesmanId !== "all" ? Number(txSalesmanId) : undefined) } }
  );

  const { data: salesmanEntities } = useListEntities({ type: "salesman" } as any);

  const markPaid = useMarkTransactionPaid();
  const bulkPay = useBulkPayCommission();

  const rows = data?.rows ?? [];

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMarkPaid = (id: number) => {
    markPaid.mutate(
      { id, reference: payRef[id] || undefined },
      {
        onSuccess: () => {
          toast({ title: "Marked as paid" });
          queryClient.invalidateQueries({ queryKey: getCommissionTransactionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getCommissionSalesmenSummaryQueryKey() });
          setPayRef((p) => { const next = { ...p }; delete next[id]; return next; });
        },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  const handleBulkPay = () => {
    if (!bulkPaySalesman) return;
    bulkPay.mutate(
      { salesmanId: bulkPaySalesman.id, reference: bulkRef || undefined, note: bulkNote || undefined },
      {
        onSuccess: (res) => {
          toast({ title: `Paid ${res.paidCount} transactions`, description: `Total: ${fmt(res.totalAmount)}` });
          queryClient.invalidateQueries({ queryKey: getCommissionTransactionsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getCommissionSalesmenSummaryQueryKey() });
          queryClient.invalidateQueries({ queryKey: getCommissionPaymentHistoryQueryKey() });
          setBulkPaySalesman(null);
          setBulkRef("");
          setBulkNote("");
        },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <IndianRupee className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Commission</h1>
          <p className="text-sm text-muted-foreground">Salesman commission tracking and payments.</p>
        </div>
      </div>

      <Tabs defaultValue={isAdmin ? "summary" : "transactions"}>
        <TabsList>
          {isAdmin && <TabsTrigger value="summary">Summary</TabsTrigger>}
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          {isAdmin && <TabsTrigger value="payments">Payment History</TabsTrigger>}
        </TabsList>

        {/* ── SUMMARY TAB (admin only) ──────────────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="summary" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Pending</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold text-amber-600">{fmt(salesmenSummary?.reduce((s, r) => s + r.pending, 0))}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Paid</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold text-emerald-600">{fmt(salesmenSummary?.reduce((s, r) => s + r.paid, 0))}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Grand Total</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold text-primary">{fmt(salesmenSummary?.reduce((s, r) => s + r.total, 0))}</div></CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Salesman-wise Commission</CardTitle>
                <CardDescription>Pending and paid commission per salesman.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Salesman</TableHead>
                        <TableHead className="text-right">Transactions</TableHead>
                        <TableHead className="text-right">Pending</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!salesmenSummary || salesmenSummary.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No commission data yet.</TableCell>
                        </TableRow>
                      ) : salesmenSummary.map((s) => (
                        <TableRow key={s.salesmanId}>
                          <TableCell className="font-medium">{s.salesmanName}</TableCell>
                          <TableCell className="text-right">{s.transactions}</TableCell>
                          <TableCell className="text-right text-amber-600 font-medium">{fmt(s.pending)}</TableCell>
                          <TableCell className="text-right text-emerald-600">{fmt(s.paid)}</TableCell>
                          <TableCell className="text-right font-semibold">{fmt(s.total)}</TableCell>
                          <TableCell className="text-right">
                            {s.pending > 0 && (
                              <Button size="sm" variant="outline" onClick={() => setBulkPaySalesman({ id: s.salesmanId, name: s.salesmanName, pending: s.pending })} data-testid={`btn-bulk-pay-${s.salesmanId}`}>
                                <CreditCard className="w-3 h-3 mr-1" /> Pay All
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* ── REPORT TAB ────────────────────────────────────────────────────── */}
        <TabsContent value="report" className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Commission</CardTitle>
                <IndianRupee className="w-4 h-4 text-amber-600" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold text-primary">{fmt(data?.totalCommission)}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Liters</CardTitle>
                <Droplets className="w-4 h-4 text-amber-600" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{fmtQty(data?.totalLiters)}</div></CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Commission by Salesman</CardTitle>
              <CardDescription>Product-wise breakdown per salesman.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 items-end mb-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[160px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[160px]" />
                </div>
                {(from || to) && (
                  <Button variant="outline" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>
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
                    {reportLoading ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading...</TableCell></TableRow>
                    ) : rows.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No commission data for this range.</TableCell></TableRow>
                    ) : rows.map((r) => {
                      const isOpen = expanded.has(r.salesmanId);
                      const breakdown = r.productBreakdown ?? [];
                      return (
                        <Fragment key={r.salesmanId}>
                          <TableRow className="cursor-pointer" onClick={() => toggle(r.salesmanId)}>
                            <TableCell>{breakdown.length > 0 && (isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />)}</TableCell>
                            <TableCell className="font-medium">{r.salesmanName}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtQty(r.liters)}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{fmt(r.commission)}</TableCell>
                          </TableRow>
                          {isOpen && breakdown.length > 0 && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
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
                                        <TableRow key={b.productId}>
                                          <TableCell>{b.productName}</TableCell>
                                          <TableCell className="text-right tabular-nums">{fmtQty(b.liters)}</TableCell>
                                          <TableCell className="text-right tabular-nums">{fmt(b.commissionPerLiter)}</TableCell>
                                          <TableCell className="text-right tabular-nums font-medium">{fmt(b.commission)}</TableCell>
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
                    })}
                  </TableBody>
                  {rows.length > 0 && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={2} className="font-semibold">Total</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{fmtQty(data?.totalLiters)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{fmt(data?.totalCommission)}</TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TRANSACTIONS TAB ─────────────────────────────────────────────── */}
        <TabsContent value="transactions" className="space-y-4">
          {isSalesman && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Pending Commission</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold text-amber-600">{fmt(txData?.totals.pending)}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Paid Commission</CardTitle></CardHeader>
                <CardContent><div className="text-2xl font-bold text-emerald-600">{fmt(txData?.totals.paid)}</div></CardContent>
              </Card>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Commission Transactions</CardTitle>
              <CardDescription>Invoice-level commission records.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-3 items-end mb-4">
                {isAdmin && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Salesman</label>
                    <Select value={txSalesmanId} onValueChange={setTxSalesmanId}>
                      <SelectTrigger className="w-[160px]"><SelectValue placeholder="All" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Salesmen</SelectItem>
                        {salesmanEntities?.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select value={txStatus} onValueChange={setTxStatus}>
                    <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <Input type="date" value={txFrom} onChange={(e) => setTxFrom(e.target.value)} className="w-[150px]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <Input type="date" value={txTo} onChange={(e) => setTxTo(e.target.value)} className="w-[150px]" />
                </div>
              </div>
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date</TableHead>
                      {isAdmin && <TableHead>Salesman</TableHead>}
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Liters</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead>Status</TableHead>
                      {isAdmin && <TableHead>Reference</TableHead>}
                      {isAdmin && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {txLoading ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading...</TableCell></TableRow>
                    ) : !txData?.transactions || txData.transactions.length === 0 ? (
                      <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No transactions found.</TableCell></TableRow>
                    ) : txData.transactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="font-mono text-xs">{tx.invoiceNo}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">{new Date(tx.createdAt).toLocaleDateString("en-IN")}</TableCell>
                        {isAdmin && <TableCell className="text-sm">{tx.salesmanName}</TableCell>}
                        <TableCell className="text-sm">{tx.customerName ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtQty(tx.totalLiters)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{fmt(tx.commissionAmount)}</TableCell>
                        <TableCell><StatusBadge status={tx.status} /></TableCell>
                        {isAdmin && (
                          <TableCell>
                            {tx.status === "pending" ? (
                              <Input
                                placeholder="Reference"
                                value={payRef[tx.id] ?? ""}
                                onChange={(e) => setPayRef((p) => ({ ...p, [tx.id]: e.target.value }))}
                                className="h-7 text-xs w-28"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">{tx.paymentReference ?? "—"}</span>
                            )}
                          </TableCell>
                        )}
                        {isAdmin && (
                          <TableCell>
                            {tx.status === "pending" && (
                              <Button size="sm" variant="outline" onClick={() => handleMarkPaid(tx.id)} disabled={markPaid.isPending} data-testid={`btn-mark-paid-${tx.id}`}>
                                {markPaid.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                                Mark Paid
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                  {txData && txData.transactions.length > 0 && (
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 5 : 4} className="font-semibold">Total</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{fmt(txData.totals.total)}</TableCell>
                        <TableCell colSpan={isAdmin ? 3 : 1}></TableCell>
                      </TableRow>
                    </TableFooter>
                  )}
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── PAYMENT HISTORY TAB (admin only) ─────────────────────────────── */}
        {isAdmin && (
          <TabsContent value="payments" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="w-5 h-5" /> Payment History
                </CardTitle>
                <CardDescription>Bulk commission payments recorded.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Salesman</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Note</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!paymentHistory || paymentHistory.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No payment history yet.</TableCell></TableRow>
                      ) : paymentHistory.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.salesmanName}</TableCell>
                          <TableCell>{new Date(p.paymentDate).toLocaleDateString("en-IN")}</TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">{fmt(p.amount)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.reference ?? "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.note ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Bulk Pay Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={!!bulkPaySalesman} onOpenChange={(o) => !o && setBulkPaySalesman(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay All Pending Commission</DialogTitle>
            <DialogDescription>
              Mark all pending commission for <strong>{bulkPaySalesman?.name}</strong> as paid.
              Total: <strong>{fmt(bulkPaySalesman?.pending)}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Payment Reference</label>
              <Input placeholder="e.g. UPI/NEFT/Cash reference" value={bulkRef} onChange={(e) => setBulkRef(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note (optional)</label>
              <Input placeholder="Any remarks" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkPaySalesman(null)}>Cancel</Button>
            <Button onClick={handleBulkPay} disabled={bulkPay.isPending}>
              {bulkPay.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              Confirm Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
