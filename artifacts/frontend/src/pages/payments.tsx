import React, { useState, useMemo, useEffect } from "react";
import { useAuth } from "@/contexts/use-auth";
import {
  useListPayments, useApprovePayment, useRejectPayment, PaymentStatus,
  useListEntities, getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { CheckCircle2, XCircle, X, Filter, Clock, Search, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { RecordPaymentDialog } from "@/components/record-payment-dialog";

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function PickCustomerDialog({
  open, onOpenChange, onSelect,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSelect: (customer: { id: number; name: string }) => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search, 250);
  const params = { type: "customer" as const, search: debounced.trim() };
  const { data: matches = [], isFetching } = useListEntities(params, {
    query: { queryKey: getListEntitiesQueryKey(params), enabled: open && debounced.trim().length >= 1 },
  });

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Search className="w-4 h-4" /> Select Customer</DialogTitle>
          <DialogDescription>Search by name or mobile to record a payment.</DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Type customer name or mobile..."
          autoComplete="off"
          data-testid="input-pick-customer-search"
        />
        <div className="max-h-72 overflow-y-auto space-y-1">
          {isFetching ? (
            <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Searching...
            </div>
          ) : debounced.trim().length < 1 ? (
            <div className="p-3 text-sm text-muted-foreground">Start typing to search customers.</div>
          ) : matches.length === 0 ? (
            <div className="p-3 text-sm text-muted-foreground">No matching customer.</div>
          ) : (
            matches.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelect({ id: e.id, name: e.name })}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-sm"
                data-testid={`option-pick-customer-${e.id}`}
              >
                <div className="font-medium">{e.name}</div>
                <div className="text-xs text-muted-foreground">{e.mobile}</div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
  const [pickCustomerOpen, setPickCustomerOpen] = useState(false);
  const [payingCustomer, setPayingCustomer] = useState<{ id: number; name: string } | null>(null);

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
  const hasActiveFilters = status !== "all" || !!from || !!to;

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Payments & Receipts</h1>
          <p className="text-muted-foreground mt-2">Manage incoming payments and escrow approvals.</p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => setPickCustomerOpen(true)} data-testid="button-log-payment">
          Log Payment
        </Button>
      </div>

      <Card>
        <CardContent className="py-3 flex items-center justify-between gap-3">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="icon" className="relative shrink-0" data-testid="button-open-filters">
                <Filter className="h-4 w-4" />
                {hasActiveFilters && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="start">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as PaymentStatus | "all")}>
                  <SelectTrigger className="w-full" data-testid="filter-payment-status">
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
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="filter-payment-from" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="filter-payment-to" />
                </div>
              </div>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => { setStatus("all"); clearDates(); }}
                  data-testid="button-clear-dates"
                >
                  <X className="w-4 h-4 mr-1" /> Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">
              {filteredPayments.length} payment{filteredPayments.length === 1 ? "" : "s"} · Total in range
            </div>
            <div className="text-2xl font-bold font-mono text-green-600">₹{totalInRange.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="hidden md:table-cell">Collected By</TableHead>
                  <TableHead className="hidden sm:table-cell">Mode</TableHead>
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
                      <TableCell className="font-mono text-xs whitespace-nowrap">{payment.receiptId || `REC-${payment.id}`}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {format(new Date(payment.createdAt), "MMM dd, yyyy")}
                        <div className="text-[10px] text-muted-foreground">{format(new Date(payment.createdAt), "hh:mm a")}</div>
                      </TableCell>
                      <TableCell className="font-medium">{payment.customerName}</TableCell>
                      <TableCell className="hidden md:table-cell">{payment.salesmanName || "Direct"}</TableCell>
                      <TableCell className="hidden sm:table-cell capitalize">{payment.mode.replace('_', ' ')}</TableCell>
                      <TableCell className="text-right font-bold text-green-600 whitespace-nowrap">₹{payment.amount.toLocaleString()}</TableCell>
                      <TableCell>
                        <span title={payment.status[0].toUpperCase() + payment.status.slice(1)} className="inline-flex">
                          {payment.status === "approved" ? (
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                          ) : payment.status === "rejected" ? (
                            <XCircle className="h-5 w-5 text-destructive" />
                          ) : (
                            <Clock className="h-5 w-5 text-amber-500" />
                          )}
                        </span>
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
          </div>
        </CardContent>
      </Card>

      <PickCustomerDialog
        open={pickCustomerOpen}
        onOpenChange={setPickCustomerOpen}
        onSelect={(c) => {
          setPayingCustomer(c);
          setPickCustomerOpen(false);
        }}
      />
      <RecordPaymentDialog
        open={!!payingCustomer}
        onOpenChange={(o) => !o && setPayingCustomer(null)}
        entityId={payingCustomer?.id}
        entityName={payingCustomer?.name}
      />
    </div>
  );
}
