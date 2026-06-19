import { useState } from "react";
import {
  useGetEntityLedger,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, CreditCard, Paperclip, Loader2, BookOpen } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/use-auth";

export default function MyStatement() {
  const { user } = useAuth();
  const entityId = (user as any)?.entityId as number | undefined;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { data: ledger, isLoading } = useGetEntityLedger(entityId!, {
    query: { enabled: !!entityId, queryKey: ["ledger", entityId] },
  });

  if (!entityId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <BookOpen className="h-10 w-10 opacity-30" />
        <p className="text-sm">Your account is not linked to a customer record.</p>
        <p className="text-xs">Please contact the administrator.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const outstanding = ledger?.outstandingBalance ?? 0;
  const isDr = outstanding > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Statement</h1>
          {ledger?.entity && (
            <p className="text-muted-foreground text-sm mt-1">
              {ledger.entity.name}
              {ledger.entity.mobile && <span className="ml-2">· {ledger.entity.mobile}</span>}
            </p>
          )}
        </div>

        <div className={`rounded-lg border px-6 py-3 text-center ${isDr ? "border-destructive/30 bg-destructive/5" : "border-green-600/30 bg-green-600/5"}`}>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-0.5">Outstanding Balance</div>
          <div className={`text-3xl font-bold leading-tight ${isDr ? "text-destructive" : "text-green-600"}`}>
            ₹{Math.abs(outstanding).toLocaleString("en-IN")}
            <span className="text-lg font-semibold ml-1.5">{isDr ? "Dr" : "Cr"}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {isDr ? "Amount you owe" : "Amount in your favour"}
          </div>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {[
          {
            label: "Total Invoiced",
            value: ledger?.entries?.filter(e => e.type === "invoice").reduce((s, e) => s + e.debit, 0) ?? 0,
            color: "text-destructive",
          },
          {
            label: "Total Paid",
            value: ledger?.entries?.filter(e => e.type === "payment").reduce((s, e) => s + e.credit, 0) ?? 0,
            color: "text-green-600",
          },
          {
            label: "Invoices",
            value: ledger?.entries?.filter(e => e.type === "invoice").length ?? 0,
            isCount: true,
            color: "text-foreground",
          },
          {
            label: "Payments",
            value: ledger?.entries?.filter(e => e.type === "payment").length ?? 0,
            isCount: true,
            color: "text-foreground",
          },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4 pb-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide">{stat.label}</div>
              <div className={`text-xl font-bold mt-1 ${stat.color}`}>
                {stat.isCount ? stat.value : `₹${(stat.value as number).toLocaleString("en-IN")}`}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
          <CardDescription>All invoices and payments on your account</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Ref No</TableHead>
                <TableHead className="text-right">Debit (₹)</TableHead>
                <TableHead className="text-right">Credit (₹)</TableHead>
                <TableHead className="text-right">Balance (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger?.entries?.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {format(new Date(entry.date), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {entry.type === "invoice"
                        ? <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        : entry.type === "payment"
                        ? <CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        : null}
                      <span className="text-sm">{entry.description}</span>
                      {entry.attachmentUrl && (
                        <button
                          type="button"
                          onClick={() => setPreviewUrl(entry.attachmentUrl!)}
                          className="inline-flex items-center text-primary hover:underline"
                          title="View attachment"
                        >
                          <Paperclip className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <Badge variant="outline" className="mt-0.5 text-[10px] capitalize px-1 py-0">
                      {entry.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {entry.referenceNo || "-"}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {entry.debit > 0
                      ? <span className="text-destructive font-medium">{entry.debit.toLocaleString("en-IN")}</span>
                      : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {entry.credit > 0
                      ? <span className="text-green-600 font-medium">{entry.credit.toLocaleString("en-IN")}</span>
                      : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold">
                    <span className={entry.balance > 0 ? "text-destructive" : "text-green-600"}>
                      {Math.abs(entry.balance).toLocaleString("en-IN")}
                      <span className="text-xs font-normal ml-1">{entry.balance > 0 ? "Dr" : "Cr"}</span>
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {(!ledger?.entries || ledger.entries.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    No transactions on your account yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!previewUrl} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attachment</DialogTitle>
          </DialogHeader>
          {previewUrl && (
            <img src={previewUrl} alt="attachment" className="max-h-[70vh] w-full rounded object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
