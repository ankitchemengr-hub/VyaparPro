import { useState, useEffect } from "react";
import {
  useGetCashbook,
  useCollectCashFromSalesman,
  useListAccountTransactions,
  getGetCashbookQueryKey,
  getListPaymentsQueryKey,
  getListAccountsQueryKey,
  type SalesmanCashSummary,
  type Account,
  type AccountTransaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Wallet, Smartphone, Landmark, HandCoins, Loader2, ArrowRight, Users,
  ArrowDownCircle, ArrowUpCircle, Printer, BookOpen,
} from "lucide-react";
import { CashEntryDialog } from "@/components/cash-entry-dialog";
import { CashReceiptDialog } from "@/components/cash-receipt-dialog";

const formatRs = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const TYPE_ICONS: Record<string, React.ElementType> = {
  cash: Wallet, upi: Smartphone, bank: Landmark,
};

export default function CashBookPage() {
  const { data, isLoading } = useGetCashbook();
  const [collectFrom, setCollectFrom] = useState<SalesmanCashSummary | null>(null);
  const [entryDirection, setEntryDirection] = useState<"in" | "out" | null>(null);
  const [receiptTxn, setReceiptTxn] = useState<AccountTransaction | null>(null);

  const salesmen = data?.salesmen ?? [];
  const accounts = data?.accounts ?? [];
  const activeAccounts = accounts.filter((a) => a.isActive);
  const totalPending = data?.totalPendingCash ?? 0;
  const totalInAccounts = accounts.reduce((s, a) => s + (a.isActive ? Number(a.currentBalance ?? 0) : 0), 0);

  const { data: txns = [], isLoading: txnsLoading } = useListAccountTransactions();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cash Book</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Record Payment In / Out, collect cash from salesmen, and reconcile your accounts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setEntryDirection("in")}
            className="bg-green-600 hover:bg-green-700"
            data-testid="button-payment-in"
          >
            <ArrowDownCircle className="w-4 h-4 mr-1" /> Payment In
          </Button>
          <Button
            onClick={() => setEntryDirection("out")}
            className="bg-rose-600 hover:bg-rose-700"
            data-testid="button-payment-out"
          >
            <ArrowUpCircle className="w-4 h-4 mr-1" /> Payment Out
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-amber-800 uppercase">Pending with Salesmen</CardTitle>
            <HandCoins className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-900 tabular-nums">{formatRs(totalPending)}</div>
            <p className="text-xs text-amber-700 mt-1">{salesmen.length} salesman{salesmen.length === 1 ? "" : "men"} holding cash</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total in Accounts</CardTitle>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatRs(totalInAccounts)}</div>
            <p className="text-xs text-muted-foreground mt-1">{accounts.filter(a => a.isActive).length} active accounts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Grand Total</CardTitle>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatRs(totalPending + totalInAccounts)}</div>
            <p className="text-xs text-muted-foreground mt-1">Pending + Accounts</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4" /> Cash Pending Collection
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
            ) : salesmen.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm">
                <HandCoins className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No salesman is holding cash right now.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Salesman</TableHead>
                    <TableHead className="text-right"># Receipts</TableHead>
                    <TableHead className="text-right">Cash Held</TableHead>
                    <TableHead className="w-32"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesmen.map((s) => (
                    <TableRow key={s.salesmanId}>
                      <TableCell className="font-medium">{s.salesmanName}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{s.paymentCount}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatRs(s.pendingCash)}</TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => setCollectFrom(s)} data-testid={`button-collect-${s.salesmanId}`}>
                          Collect
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="w-4 h-4" /> Account Balances
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {accounts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm">
                <Wallet className="w-10 h-10 mx-auto mb-3 opacity-30" />
                No accounts yet. Go to <strong>Accounts</strong> to add Cash, UPI, or Bank.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.filter(a => a.isActive).map((a) => {
                    const Icon = TYPE_ICONS[a.type] ?? Wallet;
                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="font-medium">{a.name}</div>
                          {a.identifier && <div className="text-xs text-muted-foreground font-mono">{a.identifier}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="gap-1 capitalize">
                            <Icon className="w-3 h-3" />{a.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatRs(Number(a.currentBalance))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="w-4 h-4" /> Recent Cash Book Entries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {txnsLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : txns.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground text-sm">
              <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
              No Payment In / Out entries recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Recorded By</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.map((t) => (
                  <TableRow key={t.id} data-testid={`row-txn-${t.id}`}>
                    <TableCell className="font-mono text-xs">{t.receiptNo ?? `#${t.id}`}</TableCell>
                    <TableCell className="text-xs">{new Date(t.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    <TableCell>
                      {t.direction === "in" ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1"><ArrowDownCircle className="w-3 h-3" /> IN</Badge>
                      ) : (
                        <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 gap-1"><ArrowUpCircle className="w-3 h-3" /> OUT</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{t.accountName ?? `#${t.accountId}`}</TableCell>
                    <TableCell className="text-xs capitalize">{t.mode.replace("_", " ")}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-1">
                        {t.partyName ?? "—"}
                        {t.partyEntityId && (
                          <span title="Linked to customer master" className="text-[10px] uppercase px-1 rounded bg-green-100 text-green-800">linked</span>
                        )}
                      </div>
                      {t.partyMobile && <div className="text-xs text-muted-foreground font-mono">{t.partyMobile}</div>}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{t.createdByName ?? "—"}</div>
                      {t.createdById && <div className="text-muted-foreground">ID: {t.createdById}</div>}
                    </TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${t.direction === "in" ? "text-green-700" : "text-rose-700"}`}>
                      {t.direction === "in" ? "+" : "−"} {formatRs(Number(t.amount))}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReceiptTxn(t)}
                        data-testid={`button-print-${t.id}`}
                      >
                        <Printer className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CollectDialog
        salesman={collectFrom}
        accounts={activeAccounts}
        onClose={() => setCollectFrom(null)}
      />

      <CashEntryDialog
        open={entryDirection !== null}
        direction={entryDirection ?? "in"}
        accounts={activeAccounts}
        onClose={() => setEntryDirection(null)}
        onCreated={(txn) => setReceiptTxn(txn)}
      />

      <CashReceiptDialog
        txn={receiptTxn}
        onClose={() => setReceiptTxn(null)}
      />
    </div>
  );
}

function CollectDialog({
  salesman, accounts, onClose,
}: {
  salesman: SalesmanCashSummary | null;
  accounts: Account[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const collect = useCollectCashFromSalesman();

  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [notes, setNotes] = useState("");

  const open = salesman !== null;
  const maxAmount = salesman?.pendingCash ?? 0;

  const handleClose = () => {
    onClose();
    setAccountId(""); setAmount(""); setNotes("");
  };

  useEffect(() => {
    if (salesman) setAmount(String(salesman.pendingCash));
  }, [salesman?.salesmanId, salesman?.pendingCash]);

  const handleCollect = () => {
    if (!salesman || !accountId || !amount) {
      toast({ title: "Pick an account and amount", variant: "destructive" });
      return;
    }
    const amt = Number(amount);
    if (amt <= 0 || amt > maxAmount + 0.001) {
      toast({ title: "Invalid amount", description: `Must be between 0 and ${formatRs(maxAmount)}`, variant: "destructive" });
      return;
    }
    collect.mutate(
      {
        data: {
          salesmanId: salesman.salesmanId,
          accountId: Number(accountId),
          amount: amt,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: (r) => {
          queryClient.invalidateQueries({ queryKey: getGetCashbookQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          toast({
            title: `Collected ${formatRs(r.totalAmount)}`,
            description: `${r.collectedCount} receipt(s) deposited to ${r.account.name}.`,
          });
          handleClose();
        },
        onError: (err: any) => {
          toast({ title: "Failed to collect", description: err?.message ?? "Server error", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Cash from {salesman?.salesmanName}</DialogTitle>
          <DialogDescription>
            Holding <strong>{formatRs(maxAmount)}</strong> across {salesman?.paymentCount} receipt(s). Choose the account to deposit into.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Deposit to Account *</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger data-testid="select-collect-account"><SelectValue placeholder="Choose account..." /></SelectTrigger>
              <SelectContent>
                {accounts.length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted-foreground">No active accounts. Add one in Accounts.</div>
                )}
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name} <span className="text-muted-foreground ml-2 text-xs capitalize">({a.type})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Amount (₹) *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              max={maxAmount}
              data-testid="input-collect-amount"
            />
            <p className="text-xs text-muted-foreground">
              Will mark the oldest receipts as collected up to this amount.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleCollect} disabled={collect.isPending} data-testid="button-confirm-collect">
            {collect.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Confirm Collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
