// Payments page: View / Edit / Delete a payment after it was received.
// Server: GET /api/payments/:id/details, PUT /api/payments/:id,
// DELETE /api/payments/:id (api-server lib/payment-edit.ts) — an edit or
// delete also corrects the bills, the customer's balance and ledger, the
// Cash Book / account and the discount expense.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListAccounts } from "@workspace/api-client-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, AlertTriangle } from "lucide-react";

export interface PaymentDetails {
  id: number; receiptId: string; customerId: number; customerName: string;
  amount: number; discount: number; mode: string; status: string; notes: string | null;
  accountId: number | null; accountName: string | null; salesmanName: string | null; approvedByName: string | null;
  startInvoiceNo: string | null; createdAt: string; approvedAt: string | null; updatedAt: string | null;
  allocations: { invoiceId: number; invoiceNo: string; allocated: number; balanceAfter: number }[];
  balanceBefore: number | null; balanceAfter: number | null;
}

const MODES: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank Transfer", cheque: "Cheque", other: "Other" };
const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function useDetails(id: number | null) {
  return useQuery({
    queryKey: ["/api/payments", id, "details"],
    queryFn: () => api<PaymentDetails>(`/api/payments/${id}/details`),
    enabled: id != null,
  });
}

// A payment change moves bills, balances, Cash Book and expenses — refresh all.
function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries();
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm border-b last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium min-w-0 break-words">{children}</span>
    </div>
  );
}

export function PaymentViewDialog({ id, onClose, onEdit, onDelete, onApprove, onReject }: {
  id: number | null;
  onClose: () => void;
  // Admin actions, shown at the bottom (the only way to reach them on a phone).
  onEdit?: (id: number) => void;
  onDelete?: (p: { id: number; receiptId: string; customerName: string | null; amount: number; status: string }) => void;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
}) {
  const { data: d, isLoading, error } = useDetails(id);
  return (
    <Dialog open={id != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment {d?.receiptId ?? ""}</DialogTitle>
          <DialogDescription>{d ? d.customerName : "Loading…"}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div>
        ) : error || !d ? (
          <p className="text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</p>
        ) : (
          <div className="space-y-4">
            <div>
              <Row label="Date">{format(new Date(d.createdAt), "dd MMM yyyy, hh:mm a")}</Row>
              <Row label="Amount received"><span className="text-green-600">{rs(d.amount)}</span></Row>
              {d.discount > 0 && <Row label="Discount given">{rs(d.discount)}</Row>}
              <Row label="Paid by">{MODES[d.mode] ?? d.mode}</Row>
              <Row label="Deposited to">{d.accountName ?? "Not deposited to an account"}</Row>
              <Row label="Collected by">{d.salesmanName ?? "Direct (office)"}</Row>
              <Row label="Status"><span className="capitalize">{d.status}</span>{d.approvedByName && d.status === "approved" ? ` · by ${d.approvedByName}` : ""}</Row>
              {d.startInvoiceNo && <Row label="Taken against bill">{d.startInvoiceNo}</Row>}
              {d.balanceBefore != null && <Row label="Customer due before">{rs(d.balanceBefore)}</Row>}
              {d.balanceAfter != null && <Row label="Customer due after">{rs(d.balanceAfter)}</Row>}
              {d.notes && <Row label="Note">{d.notes}</Row>}
              {d.updatedAt && d.updatedAt !== d.createdAt && <Row label="Last changed">{format(new Date(d.updatedAt), "dd MMM yyyy, hh:mm a")}</Row>}
            </div>
            {d.allocations.length > 0 && (
              <div>
                <div className="text-sm font-semibold mb-1">Bills settled by this payment</div>
                <div className="rounded-md border divide-y text-sm">
                  {d.allocations.map((a, i) => (
                    <div key={i} className="flex justify-between gap-2 px-3 py-1.5">
                      <span className="font-mono">{a.invoiceNo}</span>
                      <span>{rs(a.allocated)} <span className="text-xs text-muted-foreground">({a.balanceAfter <= 0.001 ? "paid" : `${rs(a.balanceAfter)} left`})</span></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {d && (onEdit || onDelete || onApprove) && (
          <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-end">
            {d.status === "pending" && onApprove && (
              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => onApprove(d.id)}>Approve</Button>
            )}
            {d.status === "pending" && onReject && (
              <Button size="sm" variant="outline" className="text-destructive border-destructive" onClick={() => onReject(d.id)}>Reject</Button>
            )}
            {onEdit && <Button size="sm" variant="outline" onClick={() => onEdit(d.id)} data-testid="button-view-edit-payment">Edit</Button>}
            {onDelete && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => onDelete({ id: d.id, receiptId: d.receiptId, customerName: d.customerName, amount: d.amount, status: d.status })}>
                Delete
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PaymentEditDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: d, isLoading } = useDetails(id);
  const { data: accounts } = useListAccounts();
  const [f, setF] = useState({ amount: "", discount: "", mode: "cash", accountId: "none", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (d) setF({
      amount: String(d.amount), discount: d.discount ? String(d.discount) : "", mode: d.mode,
      accountId: d.accountId ? String(d.accountId) : "none", notes: d.notes ?? "",
    });
  }, [d]);

  const approved = d?.status === "approved";
  const amount = Number(f.amount) || 0;
  const discount = Number(f.discount) || 0;
  const oldSettled = d ? d.amount + d.discount : 0;
  const diff = Math.round((amount + discount - oldSettled) * 100) / 100;

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/payments/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          amount, discount: approved ? discount : 0, mode: f.mode,
          accountId: approved && f.accountId !== "none" ? Number(f.accountId) : null,
          notes: f.notes,
        }),
      });
      toast({ title: "Payment updated", description: `${d?.receiptId} — bills and balances corrected.` });
      invalidateAll(queryClient);
      onClose();
    } catch (e: any) {
      toast({ title: "Could not update payment", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={id != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit payment {d?.receiptId ?? ""}</DialogTitle>
          <DialogDescription>{d?.customerName ?? "Loading…"}</DialogDescription>
        </DialogHeader>
        {isLoading || !d ? (
          <div className="py-8 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pe-amount">Amount received (₹)</Label>
                <Input id="pe-amount" type="number" inputMode="decimal" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              </div>
              {approved && (
                <div className="space-y-1">
                  <Label htmlFor="pe-disc">Discount (₹)</Label>
                  <Input id="pe-disc" type="number" inputMode="decimal" min={0} placeholder="0" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label>Paid by</Label>
              <Select value={f.mode} onValueChange={(v) => setF({ ...f, mode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(MODES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {approved && (
              <div className="space-y-1">
                <Label>Deposited to</Label>
                <Select value={f.accountId} onValueChange={(v) => setF({ ...f, accountId: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not deposited to an account</SelectItem>
                    {(accounts ?? []).filter((a) => a.isActive || a.id === d.accountId).map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="pe-notes">Note</Label>
              <Textarea id="pe-notes" rows={2} value={f.notes} placeholder="e.g. customer paid ₹300 less" onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </div>
            {approved && diff !== 0 && (
              <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {diff < 0
                  ? `The customer will owe ${rs(-diff)} more. The bills this payment settled are worked out again.`
                  : `The customer will owe ${rs(diff)} less. The bills this payment settled are worked out again.`}
                {" "}Cash Book and the account balance change to match.
              </p>
            )}
            {!approved && <p className="text-xs text-muted-foreground">This payment is not approved yet, so no money has been booked — only the payment entry changes.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !d || amount + discount <= 0} data-testid="button-save-payment-edit">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDeleteDialog({ payment, onClose }: {
  payment: { id: number; receiptId: string; customerName: string | null; amount: number; status: string } | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const del = async () => {
    if (!payment) return;
    setBusy(true);
    try {
      await api(`/api/payments/${payment.id}`, { method: "DELETE" });
      toast({ title: "Payment deleted", description: `${payment.receiptId} removed.` });
      invalidateAll(queryClient);
      onClose();
    } catch (e: any) {
      toast({ title: "Could not delete payment", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" /> Delete payment {payment?.receiptId}?</DialogTitle>
          <DialogDescription>
            {payment?.customerName} · {payment ? rs(payment.amount) : ""}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {payment?.status === "approved"
            ? "The customer will owe this amount again, the bills it paid open up again, and its Cash Book entry, account balance and any discount are removed. This can't be undone."
            : "This payment was not approved, so no money was booked — only the entry is removed."}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={del} disabled={busy} data-testid="button-confirm-delete-payment">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
