import { useMemo, useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListKhatabook, useGetEntityLedger, getGetEntityLedgerQueryKey, getListKhatabookQueryKey,
  useGetPaymentReceipt, getGetPaymentReceiptQueryKey, useListAccounts,
  type AccountTransaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Search, BookOpen, Printer, MessageCircle, Loader2, Phone, Receipt,
  ArrowDownCircle, ArrowUpCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { CashEntryDialog } from "@/components/cash-entry-dialog";
import { CashReceiptDialog } from "@/components/cash-receipt-dialog";

const formatRs = (n: number) =>
  `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type StatusFilter = "all" | "you_will_get" | "you_will_give" | "settled" | "due_today" | "upcoming" | "no_due_date";
type SortBy = "highest" | "oldest" | "least";

export default function Khatabook() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<"customer" | "vendor">("customer");

  if (!hasRole(["admin", "accountant"])) return <Redirect to="/" />;

  return (
    <div className="p-4 sm:p-6 space-y-4 print:hidden">
      <div className="flex items-center gap-2">
        <BookOpen className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Khatabook</h1>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "customer" | "vendor")}>
        <TabsList>
          <TabsTrigger value="customer" data-testid="tab-khatabook-customer">Customer</TabsTrigger>
          <TabsTrigger value="vendor" data-testid="tab-khatabook-vendor">Supplier</TabsTrigger>
        </TabsList>
        <TabsContent value="customer">
          <KhatabookTab type="customer" />
        </TabsContent>
        <TabsContent value="vendor">
          <KhatabookTab type="vendor" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KhatabookTab({ type }: { type: "customer" | "vendor" }) {
  const { data, isLoading } = useListKhatabook({ type });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("highest");
  const [selected, setSelected] = useState<{ id: number; name: string; mobile: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const partyLabel = type === "customer" ? "Customer" : "Supplier";
  // Vendors and customers store outstandingBalance with opposite meaning:
  // a positive customer balance means they owe the business (You Will Get),
  // but a positive vendor balance means the business owes them (per
  // purchases.ts: "Vendor payable: increase outstanding (we owe them)") —
  // i.e. You Will Give. Flipping the sign for vendors lets every "You Will
  // Get" computation below stay written the same way for both tabs.
  const sign = type === "vendor" ? -1 : 1;

  const { youWillGet, youWillGive } = useMemo(() => {
    let get = 0, give = 0;
    for (const e of data ?? []) {
      const bal = e.outstandingBalance * sign;
      if (bal > 0) get += bal;
      else if (bal < 0) give += Math.abs(bal);
    }
    return { youWillGet: get, youWillGive: give };
  }, [data, sign]);

  const filtered = useMemo(() => {
    let rows = (data ?? []).filter((e) => e.name.toLowerCase().includes(search.trim().toLowerCase()));
    rows = rows.filter((e) => {
      const bal = e.outstandingBalance * sign;
      switch (status) {
        case "you_will_get": return bal > 0;
        case "you_will_give": return bal < 0;
        case "settled": return bal === 0;
        case "due_today": return e.nextDueDate === today;
        case "upcoming": return !!e.nextDueDate && e.nextDueDate > today;
        case "no_due_date": return !e.nextDueDate;
        default: return true;
      }
    });
    return [...rows].sort((a, b) => {
      if (sortBy === "highest") return Math.abs(b.outstandingBalance) - Math.abs(a.outstandingBalance);
      if (sortBy === "least") return Math.abs(a.outstandingBalance) - Math.abs(b.outstandingBalance);
      // oldest — earliest unpaid due date first; entries with no due date sort last
      if (!a.nextDueDate && !b.nextDueDate) return 0;
      if (!a.nextDueDate) return 1;
      if (!b.nextDueDate) return -1;
      return a.nextDueDate < b.nextDueDate ? -1 : 1;
    });
  }, [data, search, status, sortBy, today]);

  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-900 min-w-0">
          <CardContent className="p-3 sm:p-4 min-w-0">
            <div className="text-[11px] sm:text-xs text-emerald-700 dark:text-emerald-400 font-medium truncate">You Will Get</div>
            <div className="text-base sm:text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 break-all">{formatRs(youWillGet)}</div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 min-w-0">
          <CardContent className="p-3 sm:p-4 min-w-0">
            <div className="text-[11px] sm:text-xs text-red-700 dark:text-red-400 font-medium truncate">You Will Give</div>
            <div className="text-base sm:text-2xl font-bold font-mono text-red-700 dark:text-red-400 break-all">{formatRs(youWillGive)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${partyLabel.toLowerCase()}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid={`input-khatabook-search-${type}`}
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-[160px]" data-testid={`select-khatabook-filter-${type}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="you_will_get">You Will Get</SelectItem>
              <SelectItem value="you_will_give">You Will Give</SelectItem>
              <SelectItem value="settled">Settled</SelectItem>
              <SelectItem value="due_today">Due Today</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
              <SelectItem value="no_due_date">No Due Date</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
            <SelectTrigger className="w-full sm:w-[160px]" data-testid={`select-khatabook-sort-${type}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="highest">Highest Amount</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="least">Least Amount</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No {partyLabel.toLowerCase()}s found.</div>
          ) : (
            <div className="divide-y">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/50 text-left"
                  onClick={() => setSelected({ id: e.id, name: e.name, mobile: e.mobile })}
                  data-testid={`row-khatabook-${type}-${e.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{e.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{e.mobile}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-mono font-semibold text-sm sm:text-base ${e.outstandingBalance * sign > 0 ? "text-emerald-600" : e.outstandingBalance * sign < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                      {formatRs(e.outstandingBalance)}
                    </div>
                    {e.nextDueDate && <div className="text-[10px] text-muted-foreground">Due {e.nextDueDate}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <KhatabookDetailDialog party={selected} type={type} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}

function KhatabookDetailDialog({
  party, type, onOpenChange,
}: {
  party: { id: number; name: string; mobile: string } | null;
  type: "customer" | "vendor";
  onOpenChange: (open: boolean) => void;
}) {
  const sign = type === "vendor" ? -1 : 1;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [waOpen, setWaOpen] = useState(false);
  const [waNumber, setWaNumber] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [viewingReceiptNo, setViewingReceiptNo] = useState<string | null>(null);
  const [entryDirection, setEntryDirection] = useState<"in" | "out" | null>(null);
  const [receiptTxn, setReceiptTxn] = useState<AccountTransaction | null>(null);

  const { data: ledger, isLoading } = useGetEntityLedger(party?.id ?? 0, {
    query: { enabled: !!party, queryKey: getGetEntityLedgerQueryKey(party?.id ?? 0) },
  });
  const { data: accounts } = useListAccounts();
  const activeAccounts = (accounts ?? []).filter((a) => a.isActive);

  const handleEntryCreated = (txn: AccountTransaction) => {
    if (party) queryClient.invalidateQueries({ queryKey: getGetEntityLedgerQueryKey(party.id) });
    queryClient.invalidateQueries({ queryKey: getListKhatabookQueryKey({ type }) });
    setReceiptTxn(txn);
  };

  const openWaDialog = () => {
    if (!party) return;
    fetch(`/api/whatsapp/entity/${party.id}/number`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWaNumber(d?.whatsappNumber || party.mobile))
      .catch(() => setWaNumber(party.mobile));
    setWaOpen(true);
  };

  const handleSendWa = async () => {
    if (!party || !waNumber) return;
    setWaSending(true);
    try {
      const res = await fetch("/api/whatsapp/send/outstanding-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ customerId: party.id, toNumber: waNumber }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error ?? "Send failed");
      toast({ title: "WhatsApp sent ✓", description: `Reminder sent to ${waNumber}` });
      setWaOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to send", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setWaSending(false);
    }
  };

  const balance = (ledger?.outstandingBalance ?? 0) * sign;

  return (
    <>
    <Dialog open={!!party} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="print:hidden">
          <DialogTitle>{party?.name}</DialogTitle>
          <DialogDescription>Date-wise ledger entries.</DialogDescription>
        </DialogHeader>

        <div className="hidden print:block mb-2">
          <h1 className="text-xl font-bold">{party?.name} — Ledger Report</h1>
          <p className="text-sm text-muted-foreground">{party?.mobile}</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">Total Balance</div>
            <div className={`text-lg sm:text-2xl font-bold font-mono break-all ${balance > 0 ? "text-emerald-600" : balance < 0 ? "text-red-600" : "text-muted-foreground"}`}>
              {formatRs(balance)} {balance > 0 ? "(You Will Get)" : balance < 0 ? "(You Will Give)" : "(Settled)"}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              size="sm" className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700"
              onClick={() => setEntryDirection("in")} data-testid="button-khatabook-payment-in"
            >
              <ArrowDownCircle className="w-4 h-4 mr-1.5" /> Payment In
            </Button>
            <Button
              size="sm" className="flex-1 sm:flex-none bg-rose-600 hover:bg-rose-700"
              onClick={() => setEntryDirection("out")} data-testid="button-khatabook-payment-out"
            >
              <ArrowUpCircle className="w-4 h-4 mr-1.5" /> Payment Out
            </Button>
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={openWaDialog} data-testid="button-whatsapp-reminder">
              <MessageCircle className="w-4 h-4 mr-1.5" /> Remind
            </Button>
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => window.print()} data-testid="button-print-ledger">
              <Printer className="w-4 h-4 mr-1.5" /> Report
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
        ) : (ledger?.entries ?? []).length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No ledger entries yet.</div>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ledger?.entries ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {entry.date?.slice(0, 10)}
                      {entry.date && (
                        <div className="text-[10px] text-muted-foreground">
                          {new Date(entry.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm max-w-[160px]">
                      {entry.type === "invoice" && entry.referenceId ? (
                        <button
                          type="button"
                          className="truncate text-left text-primary hover:underline print:no-underline print:text-inherit"
                          onClick={() => setLocation(`/invoices/${entry.referenceId}`)}
                          data-testid={`link-ledger-invoice-${entry.id}`}
                        >
                          {entry.description}
                        </button>
                      ) : entry.type === "payment" && entry.referenceNo ? (
                        <button
                          type="button"
                          className="truncate text-left text-primary hover:underline print:no-underline print:text-inherit"
                          onClick={() => setViewingReceiptNo(entry.referenceNo!)}
                          data-testid={`link-ledger-receipt-${entry.id}`}
                        >
                          {entry.description}
                        </button>
                      ) : (
                        <div className="truncate">{entry.description}</div>
                      )}
                      {entry.referenceNo && <div className="text-[10px] text-muted-foreground font-mono truncate">{entry.referenceNo}</div>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap">{entry.debit > 0 ? formatRs(entry.debit) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap">{entry.credit > 0 ? formatRs(entry.credit) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium whitespace-nowrap">{formatRs(entry.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <Dialog open={waOpen} onOpenChange={setWaOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageCircle className="w-4 h-4" /> Send Balance Reminder</DialogTitle>
          <DialogDescription>Send a WhatsApp message with the current balance.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> WhatsApp Number</label>
          <Input value={waNumber} onChange={(e) => setWaNumber(e.target.value.replace(/\D/g, ""))} maxLength={10} data-testid="input-whatsapp-number" />
        </div>
        <Button onClick={handleSendWa} disabled={waSending || waNumber.length !== 10} className="w-full" data-testid="button-send-whatsapp-reminder">
          {waSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-2" />}
          Send Reminder
        </Button>
      </DialogContent>
    </Dialog>

    <ReceiptViewDialog receiptNo={viewingReceiptNo} onOpenChange={(o) => !o && setViewingReceiptNo(null)} />

    <CashEntryDialog
      open={entryDirection !== null}
      direction={entryDirection ?? "in"}
      accounts={activeAccounts}
      presetEntity={party ? { id: party.id, name: party.name, mobile: party.mobile, balance: ledger?.outstandingBalance ?? 0 } : null}
      onClose={() => setEntryDirection(null)}
      onCreated={handleEntryCreated}
    />
    <CashReceiptDialog txn={receiptTxn} onClose={() => setReceiptTxn(null)} />
    </>
  );
}

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  cheque: "Cheque",
  bank_transfer: "Bank Transfer",
  other: "Other",
};

function ReceiptViewDialog({ receiptNo, onOpenChange }: { receiptNo: string | null; onOpenChange: (open: boolean) => void }) {
  const open = !!receiptNo;
  const { data: receipt, isLoading } = useGetPaymentReceipt(receiptNo ?? "", {
    query: { enabled: open, queryKey: getGetPaymentReceiptQueryKey(receiptNo ?? "") },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" /> Payment Receipt
          </DialogTitle>
          {receipt && <DialogDescription className="font-mono">{receipt.receiptNo}</DialogDescription>}
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center print:hidden"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : receipt ? (
          <>
            <div className="space-y-2 text-sm print:hidden">
              <div className="flex justify-between"><span className="text-muted-foreground">Date</span><span>{new Date(receipt.date).toLocaleDateString("en-IN")} <span className="text-xs text-muted-foreground">{new Date(receipt.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{receipt.direction === "in" ? "Received From" : "Paid To"}</span><span className="font-medium">{receipt.partyName ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Mode</span><span>{MODE_LABELS[receipt.mode] ?? receipt.mode}</span></div>
              {receipt.invoiceNo && <div className="flex justify-between"><span className="text-muted-foreground">Against Invoice</span><span>{receipt.invoiceNo}</span></div>}
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="capitalize">{receipt.status}</span></div>
              <div className="flex justify-between border-t pt-2 mt-2 font-bold text-base">
                <span>Amount</span>
                <span>₹{receipt.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            {/* Printable slip — hidden on screen, shown only for print/PDF */}
            <div className="hidden print:block p-6 text-sm">
              <div className="font-bold text-lg mb-4">Payment Receipt</div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div><span className="text-muted-foreground">Receipt No: </span>{receipt.receiptNo}</div>
                <div><span className="text-muted-foreground">Date: </span>{new Date(receipt.date).toLocaleDateString("en-IN")} {new Date(receipt.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
                <div><span className="text-muted-foreground">{receipt.direction === "in" ? "Received From" : "Paid To"}: </span>{receipt.partyName ?? "—"}</div>
                {receipt.invoiceNo && <div><span className="text-muted-foreground">Against Invoice: </span>{receipt.invoiceNo}</div>}
                <div><span className="text-muted-foreground">Mode: </span>{MODE_LABELS[receipt.mode] ?? receipt.mode}</div>
                <div><span className="text-muted-foreground">Status: </span>{receipt.status}</div>
              </div>
              <div className="border-t border-b py-3 my-3">
                <div className="flex justify-between font-bold text-base">
                  <span>Amount</span>
                  <span>₹{receipt.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground print:hidden">Receipt not found.</p>
        )}

        <DialogFooter className="print:hidden">
          {receipt && (
            <Button variant="outline" onClick={() => window.print()} data-testid="button-print-ledger-receipt">
              <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
