import { useState, useEffect } from "react";
import {
  useListAccounts,
  useCreateAccount,
  useUpdateAccount,
  useDeleteAccount,
  getListAccountsQueryKey,
  getGetCashbookQueryKey,
  type Account,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  Wallet, Smartphone, Landmark, Plus, Pencil, Trash2, Loader2, ArrowLeftRight,
} from "lucide-react";

type AccountType = "cash" | "upi" | "bank";

const TYPE_META: Record<AccountType, { label: string; icon: React.ElementType; tone: string }> = {
  cash: { label: "Cash", icon: Wallet, tone: "bg-amber-500/10 text-amber-700 border-amber-200" },
  upi: { label: "UPI", icon: Smartphone, tone: "bg-blue-500/10 text-blue-700 border-blue-200" },
  bank: { label: "Bank", icon: Landmark, tone: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
};

const formatRs = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

export default function AccountsPage() {
  const { data: accounts, isLoading } = useListAccounts();
  const [editing, setEditing] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const handleNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const handleEdit = (acct: Account) => {
    setEditing(acct);
    setOpen(true);
  };

  const totals = (accounts ?? []).reduce(
    (acc, a) => {
      if (!a.isActive) return acc;
      acc.total += Number(a.currentBalance ?? 0);
      acc[a.type as AccountType] = (acc[a.type as AccountType] ?? 0) + Number(a.currentBalance ?? 0);
      return acc;
    },
    { total: 0, cash: 0, upi: 0, bank: 0 } as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your cash, UPI, and bank accounts. All payment deposits are tracked against these accounts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTransferOpen(true)}>
            <ArrowLeftRight className="w-4 h-4 mr-2" /> Transfer
          </Button>
          <Button onClick={handleNew} data-testid="button-new-account">
            <Plus className="w-4 h-4 mr-2" /> Add Account
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Balance</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{formatRs(totals.total)}</div></CardContent>
        </Card>
        {(["cash", "upi", "bank"] as AccountType[]).map((t) => {
          const M = TYPE_META[t];
          return (
            <Card key={t}>
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">{M.label}</CardTitle>
                <M.icon className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent><div className="text-2xl font-bold">{formatRs(totals[t] ?? 0)}</div></CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : !accounts || accounts.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No accounts yet. Add a Cash account, your UPI IDs, and your bank accounts to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Identifier (UPI / Acct No)</TableHead>
                  <TableHead className="text-right">Opening Balance</TableHead>
                  <TableHead className="text-right">Current Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a) => {
                  const M = TYPE_META[a.type as AccountType] ?? TYPE_META.cash;
                  return (
                    <TableRow key={a.id} className={!a.isActive ? "opacity-50" : ""}>
                      <TableCell>
                        <Badge variant="outline" className={M.tone + " gap-1"}>
                          <M.icon className="w-3 h-3" />{M.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm font-mono">{a.identifier || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRs(Number(a.openingBalance))}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{formatRs(Number(a.currentBalance))}</TableCell>
                      <TableCell>
                        {a.isActive ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleEdit(a)} data-testid={`button-edit-account-${a.id}`}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AccountDialog open={open} onOpenChange={setOpen} editing={editing} />
      <TransferDialog open={transferOpen} onOpenChange={setTransferOpen} accounts={accounts ?? []} />
    </div>
  );
}

function AccountDialog({
  open, onOpenChange, editing,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; editing: Account | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const remove = useDeleteAccount();

  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("cash");
  const [identifier, setIdentifier] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Sync form fields whenever the dialog opens or the editing target changes
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setType(editing.type as AccountType);
      setIdentifier(editing.identifier ?? "");
      setOpeningBalance(String(editing.openingBalance ?? 0));
      setNotes(editing.notes ?? "");
      setIsActive(editing.isActive);
    } else {
      setName(""); setType("cash"); setIdentifier(""); setOpeningBalance("0"); setNotes(""); setIsActive(true);
    }
  }, [open, editing]);

  const reset = () => {
    setName(""); setType("cash"); setIdentifier(""); setOpeningBalance("0"); setNotes(""); setIsActive(true);
  };

  const handleClose = () => { onOpenChange(false); reset(); };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const body = {
      name: name.trim(),
      type,
      identifier: identifier.trim() || undefined,
      openingBalance: Number(openingBalance) || 0,
      notes: notes.trim() || undefined,
      isActive,
    };
    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCashbookQueryKey() });
      toast({ title: editing ? "Account updated" : "Account created" });
      handleClose();
    };
    const onError = () => toast({ title: "Failed to save account", variant: "destructive" });

    if (editing) {
      update.mutate({ id: editing.id, data: body }, { onSuccess, onError });
    } else {
      create.mutate({ data: body }, { onSuccess, onError });
    }
  };

  const handleDelete = () => {
    if (!editing) return;
    if (!confirm(`Deactivate account "${editing.name}"?`)) return;
    remove.mutate({ id: editing.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        toast({ title: "Account deactivated" });
        handleClose();
      },
      onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Account" : "Add Account"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update account details and opening balance." : "Add a Cash, UPI, or Bank account."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Account Type *</Label>
            <Select value={type} onValueChange={(v) => setType(v as AccountType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="bank">Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={type === "cash" ? "e.g. Cash on Hand" : type === "upi" ? "e.g. PhonePe — Vipro" : "e.g. HDFC Current"}
              data-testid="input-account-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{type === "upi" ? "UPI ID" : type === "bank" ? "Account Number" : "Identifier"} <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={type === "upi" ? "owner@upi" : type === "bank" ? "XXXX1234" : ""}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Opening Balance (₹)</Label>
            <Input
              type="number"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="0"
              data-testid="input-opening-balance"
            />
            {editing && (
              <p className="text-xs text-muted-foreground">
                Changing this will shift the current balance by the same amount.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          {editing && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="m-0">Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {editing && (
            <Button variant="ghost" onClick={handleDelete} className="text-destructive mr-auto">
              <Trash2 className="w-4 h-4 mr-1" /> Deactivate
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={create.isPending || update.isPending} data-testid="button-save-account">
            {(create.isPending || update.isPending) && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {editing ? "Save Changes" : "Create Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  open, onOpenChange, accounts,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; accounts: Account[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const activeAccounts = accounts.filter((a) => a.isActive);

  const reset = () => { setFromId(""); setToId(""); setAmount(""); setNotes(""); };
  const handleClose = () => { onOpenChange(false); reset(); };

  const fromAcct = activeAccounts.find((a) => String(a.id) === fromId);
  const available = fromAcct ? Number(fromAcct.currentBalance) : null;

  const handleTransfer = async () => {
    if (!fromId || !toId) { toast({ title: "Select both accounts", variant: "destructive" }); return; }
    if (fromId === toId) { toast({ title: "Source and destination must differ", variant: "destructive" }); return; }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    if (available !== null && amt > available + 0.001) {
      toast({ title: `Insufficient balance (₹${available.toFixed(2)} available)`, variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/accounts/transfer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromAccountId: Number(fromId), toAccountId: Number(toId), amount: amt, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Transfer failed", variant: "destructive" }); return; }
      queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetCashbookQueryKey() });
      toast({ title: "Transfer successful", description: `₹${amt.toFixed(2)} moved from ${data.fromAccountName} → ${data.toAccountName}` });
      handleClose();
    } catch {
      toast({ title: "Transfer failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowLeftRight className="w-4 h-4" /> Transfer Between Accounts
          </DialogTitle>
          <DialogDescription>Move funds from one account to another. Both balances update instantly.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>From Account *</Label>
            <Select value={fromId} onValueChange={setFromId}>
              <SelectTrigger><SelectValue placeholder="Select source account" /></SelectTrigger>
              <SelectContent>
                {activeAccounts.map((a) => {
                  const M = TYPE_META[a.type as AccountType] ?? TYPE_META.cash;
                  return (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="flex items-center gap-2">
                        <M.icon className="w-3.5 h-3.5" />
                        {a.name}
                        <span className="text-muted-foreground text-xs ml-1">
                          (₹{Number(a.currentBalance).toLocaleString("en-IN")})
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {available !== null && (
              <p className="text-xs text-muted-foreground">Available: ₹{available.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>To Account *</Label>
            <Select value={toId} onValueChange={setToId}>
              <SelectTrigger><SelectValue placeholder="Select destination account" /></SelectTrigger>
              <SelectContent>
                {activeAccounts.filter((a) => String(a.id) !== fromId).map((a) => {
                  const M = TYPE_META[a.type as AccountType] ?? TYPE_META.cash;
                  return (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="flex items-center gap-2">
                        <M.icon className="w-3.5 h-3.5" />
                        {a.name}
                        <span className="text-muted-foreground text-xs ml-1">
                          (₹{Number(a.currentBalance).toLocaleString("en-IN")})
                        </span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Amount (₹) *</Label>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Deposited to bank" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button onClick={handleTransfer} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
