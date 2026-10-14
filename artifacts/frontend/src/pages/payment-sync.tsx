import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getListInvoicesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, RefreshCw, Search } from "lucide-react";

type SyncInvoice = {
  invoiceId: number;
  invoiceNo: string;
  invoiceAmount: number;
  dueBefore: number;
  settled: number;
  dueAfter: number;
  status: "paid" | "partially_paid";
};
type SyncParty = {
  customerId: number;
  name: string;
  balance: number;
  openDueBefore: number;
  settled: number;
  openDueAfter: number;
  invoices: SyncInvoice[];
};
type SyncResult = {
  applied: boolean;
  partyCount: number;
  invoiceCount: number;
  totalSettled: number;
  parties: SyncParty[];
};

const rupees = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Admin clean-up: marks bills paid where the party balance says they're
// already settled (payments taken in Khatabook/Cash Book that never reached a
// bill, advances, old sales returns). Preview first — it is exactly what Apply
// will do — then Apply after a confirmation.
export default function PaymentSync() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "apply" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const run = async (mode: "preview" | "apply") => {
    setLoading(mode);
    try {
      const res = await fetch(mode === "preview" ? "/api/payment-sync/preview" : "/api/payment-sync/apply", {
        method: mode === "preview" ? "GET" : "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error ?? "Sync failed", variant: "destructive" });
        return;
      }
      setResult(data);
      if (mode === "apply") {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        toast({
          title: "Bills updated",
          description: data.invoiceCount > 0
            ? `${data.invoiceCount} bills of ${data.partyCount} parties now match their balance.`
            : "Nothing needed changing.",
        });
      }
    } catch {
      toast({ title: "Sync failed", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bill Payment Sync</h1>
        <p className="text-muted-foreground mt-2">
          Marks bills as paid when the party balance shows they are already settled (payment taken in Khatabook / Cash Book, advance, or sales return).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How it works</CardTitle>
          <CardDescription>
            For each party, the amount still due on their bills is brought down to their account balance. Newest bills are
            marked paid first, so any amount the party still owes stays on the oldest bills — the same order a new payment
            follows. Paid bills are never re-opened, and party balances and the ledger do not change.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => run("preview")} disabled={loading !== null} data-testid="button-sync-preview">
            {loading === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Check bills
          </Button>
          {result && !result.applied && result.invoiceCount > 0 && (
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={loading !== null} data-testid="button-sync-apply">
              {loading === "apply" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Apply to {result.invoiceCount} bills
            </Button>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {result.invoiceCount === 0 ? (
                <><CheckCircle2 className="h-5 w-5 text-green-600" /> All bills already match party balances</>
              ) : result.applied ? (
                <><CheckCircle2 className="h-5 w-5 text-green-600" /> Updated {result.invoiceCount} bills of {result.partyCount} parties</>
              ) : (
                <>{result.invoiceCount} bills of {result.partyCount} parties will be updated</>
              )}
            </CardTitle>
            {result.invoiceCount > 0 && (
              <CardDescription>Total marked as received on bills: {rupees(result.totalSettled)}</CardDescription>
            )}
          </CardHeader>
          {result.parties.length > 0 && (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Party / Bill</TableHead>
                      <TableHead className="text-right">Due before</TableHead>
                      <TableHead className="text-right">Marked received</TableHead>
                      <TableHead className="text-right">Due after</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.parties.map((p) => (
                      <React.Fragment key={p.customerId}>
                        <TableRow className="bg-muted/50" data-testid={`row-sync-party-${p.customerId}`}>
                          <TableCell className="font-semibold">
                            {p.name}
                            <div className="text-xs font-normal text-muted-foreground">
                              Party balance {rupees(p.balance)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">{rupees(p.openDueBefore)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap font-semibold text-green-700 dark:text-green-400">{rupees(p.settled)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">{rupees(p.openDueAfter)}</TableCell>
                          <TableCell />
                        </TableRow>
                        {p.invoices.map((inv) => (
                          <TableRow
                            key={inv.invoiceId}
                            className="cursor-pointer"
                            onClick={() => setLocation(`/invoices/${inv.invoiceId}`)}
                            data-testid={`row-sync-invoice-${inv.invoiceId}`}
                          >
                            <TableCell className="pl-8 text-sm">
                              {inv.invoiceNo}
                              <span className="text-xs text-muted-foreground"> · bill {rupees(inv.invoiceAmount)}</span>
                            </TableCell>
                            <TableCell className="text-right whitespace-nowrap text-sm">{rupees(inv.dueBefore)}</TableCell>
                            <TableCell className="text-right whitespace-nowrap text-sm">{rupees(inv.settled)}</TableCell>
                            <TableCell className="text-right whitespace-nowrap text-sm">{rupees(inv.dueAfter)}</TableCell>
                            <TableCell>
                              {inv.status === "paid"
                                ? <Badge className="bg-green-600 text-white hover:bg-green-700">Paid</Badge>
                                : <Badge className="bg-amber-500 text-white hover:bg-amber-600">Partial</Badge>}
                            </TableCell>
                          </TableRow>
                        ))}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update {result?.invoiceCount} bills?</AlertDialogTitle>
            <AlertDialogDescription>
              These bills will be marked paid / partly paid exactly as shown in the list. Take a database backup first
              (Backup &amp; Restore) — this cannot be undone from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmOpen(false); run("apply"); }}
              data-testid="button-sync-confirm"
            >
              Yes, update bills
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
