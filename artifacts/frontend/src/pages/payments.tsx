import React, { useState, useMemo } from "react";
import { useAuth } from "@/contexts/use-auth";
import { useListPayments, useApprovePayment, useRejectPayment, PaymentStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const todayISO = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function Payments() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(todayISO());

  const queryClient = useQueryClient();
  const approvePayment = useApprovePayment();
  const rejectPayment = useRejectPayment();

  const { data: payments, isLoading } = useListPayments({
    status: status !== "all" ? status as PaymentStatus : undefined
  });

  const filteredPayments = useMemo(() => {
    if (!payments) return [];
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
    const toTs = to ? new Date(to + "T23:59:59.999").getTime() : Infinity;
    return payments.filter((p) => {
      const t = new Date(p.createdAt).getTime();
      return t >= fromTs && t <= toTs;
    });
  }, [payments, from, to]);

  const totalInRange = filteredPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const clearDates = () => { setFrom(""); setTo(""); };

  const handleApprove = (id: number) => {
    approvePayment.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      }
    });
  };

  const handleReject = (id: number) => {
    rejectPayment.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments & Receipts</h1>
          <p className="text-muted-foreground mt-2">Manage incoming payments and escrow approvals.</p>
        </div>
        <Button>Log Payment</Button>
      </div>

      <Card>
        <CardContent className="py-3 flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as PaymentStatus | "all")}>
              <SelectTrigger className="w-[180px]" data-testid="filter-payment-status">
                <SelectValue placeholder="Status Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payments</SelectItem>
                <SelectItem value="pending">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" data-testid="filter-payment-from" />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" data-testid="filter-payment-to" />
          </div>
          {(from || to) && (
            <Button variant="ghost" size="sm" onClick={clearDates} data-testid="button-clear-dates">
              <X className="w-4 h-4 mr-1" /> Clear dates
            </Button>
          )}
          <div className="ml-auto text-right">
            <div className="text-xs text-muted-foreground">
              {filteredPayments.length} payment{filteredPayments.length === 1 ? "" : "s"} · Total in range
            </div>
            <div className="text-2xl font-bold font-mono text-green-600">₹{totalInRange.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt ID</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Collected By</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8">Loading...</TableCell>
                </TableRow>
              ) : filteredPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 7} className="text-center py-8 text-muted-foreground">No payments found in selected range.</TableCell>
                </TableRow>
              ) : (
                filteredPayments.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell className="font-mono text-xs">{payment.receiptId || `REC-${payment.id}`}</TableCell>
                    <TableCell>{format(new Date(payment.createdAt), "MMM dd, yyyy")}</TableCell>
                    <TableCell className="font-medium">{payment.customerName}</TableCell>
                    <TableCell>{payment.salesmanName || "Direct"}</TableCell>
                    <TableCell className="capitalize">{payment.mode.replace('_', ' ')}</TableCell>
                    <TableCell className="text-right font-bold text-green-600">₹{payment.amount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={
                        payment.status === "approved" ? "default" : 
                        payment.status === "rejected" ? "destructive" : 
                        "secondary"
                      } className={payment.status === "approved" ? "bg-green-500" : payment.status === "pending" ? "bg-amber-500 text-white" : ""}>
                        {payment.status}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        {payment.status === "pending" && (
                          <div className="flex justify-end gap-2">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="text-green-600 border-green-600 hover:bg-green-50"
                              onClick={() => handleApprove(payment.id)}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="text-destructive border-destructive hover:bg-destructive/10"
                              onClick={() => handleReject(payment.id)}
                            >
                              <XCircle className="h-4 w-4 mr-1" /> Reject
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
