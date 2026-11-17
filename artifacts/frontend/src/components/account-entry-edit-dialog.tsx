import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListAccounts } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAY_MODES, ACCOUNT_TYPE_LABEL } from "@/components/cash-entry-dialog";

// Edit a Payment In / Payment Out entry (account_transactions) from a party's
// Khatabook: amount, mode, the account it came out of / went into, and the
// note. The server re-balances both accounts, the party's balance and its
// ledger line (PATCH /account-transactions/:id).

type Entry = {
  id: number; receiptNo: string | null; accountId: number; accountName: string | null;
  direction: "in" | "out"; amount: number; discount: number; mode: string;
  partyName: string | null; partyMobile: string | null; notes: string | null; createdAt: string;
};

export function AccountEntryEditDialog({ txnId, onClose }: { txnId: number | null; onClose: () => void }) {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: accounts } = useListAccounts();
  const { data: entry, isLoading, isError } = useQuery<Entry>({
    queryKey: ["/api/account-transactions", txnId],
    queryFn: async () => {
      const r = await fetch(`/api/account-transactions/${txnId}`, { credentials: "include" });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Could not load");
      return r.json();
    },
    enabled: txnId != null,
  });

  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [negativeMsg, setNegativeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setAmount(String(entry.amount));
    setMode(entry.mode);
    setAccountId(String(entry.accountId));
    setNotes(entry.notes ?? "");
    setNegativeMsg(null);
  }, [entry]);

  // Active accounts, plus the entry's own account even if it was closed since.
  const choices = (accounts ?? []).filter((a) => a.isActive || a.id === entry?.accountId);
  const isOut = entry?.direction === "out";

  const chooseMode = (value: string) => {
    setMode(value);
    const want = PAY_MODES.find((m) => m.value === value)?.accountType;
    const match = want ? choices.find((a) => a.type === want && a.isActive) : undefined;
    if (match) setAccountId(String(match.id));
  };

  const save = async (allowNegative = false) => {
    if (!entry) return;
    const amt = Number(amount);
    if (!(amt > 0)) { toast({ title: "Enter an amount above 0", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/account-transactions/${entry.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amount: amt, mode, notes: notes.trim() || null,
          partyName: entry.partyName, partyMobile: entry.partyMobile,
          accountId: Number(accountId),
          ...(allowNegative ? { allowNegative: true } : {}),
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) {
        const msg = String(body?.error ?? "Could not save");
        if (msg.includes("allowNegative") && isAdmin && !allowNegative) {
          setNegativeMsg(msg.replace(/ — set allowNegative to proceed\.?/, ""));
          return;
        }
        throw new Error(msg);
      }
      // Accounts, the party's balance and ledger, Cash Book — refresh everything.
      await queryClient.invalidateQueries();
      toast({ title: `${isOut ? "Payment Out" : "Payment In"} updated`, description: entry.receiptNo ?? undefined });
      onClose();
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={txnId != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" />Edit {isOut ? "Payment Out" : "Payment In"}
          </DialogTitle>
          <DialogDescription>
            {entry ? `${entry.receiptNo ?? `#${entry.id}`} · ${entry.partyName ?? ""} · ${new Date(entry.createdAt).toLocaleDateString("en-IN")}` : " "}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-8 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></div>
        ) : isError || !entry ? (
          <p className="py-6 text-center text-sm text-muted-foreground">This entry could not be loaded.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-edit-entry-amount" />
              {entry.discount > 0 && (
                <p className="text-xs text-muted-foreground">Discount ₹{entry.discount.toLocaleString("en-IN")} on this payment stays as it is.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Payment Mode</Label>
              <div className="grid grid-cols-3 gap-2">
                {PAY_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => chooseMode(m.value)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                      mode === m.value
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                    )}
                    data-testid={`button-edit-entry-mode-${m.value}`}
                  >
                    <m.icon className="w-4 h-4" />{m.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{isOut ? "Paid from Account *" : "Deposited to Account *"}</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger data-testid="select-edit-entry-account"><SelectValue placeholder="Choose account..." /></SelectTrigger>
                <SelectContent>
                  {choices.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      <span className="font-medium">{a.name}</span>
                      <span className="text-xs text-muted-foreground ml-1.5">· {ACCOUNT_TYPE_LABEL[a.type] ?? a.type}{a.isActive ? "" : " (closed)"}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {String(entry.accountId) !== accountId && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  ₹{entry.amount.toLocaleString("en-IN")} goes back to {entry.accountName ?? "the old account"}; the new account is {isOut ? "charged" : "credited"} instead.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            {negativeMsg && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 p-3 text-sm space-y-2">
                <p>{negativeMsg}. Allow the account to go negative?</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setNegativeMsg(null)}>No</Button>
                  <Button size="sm" onClick={() => { setNegativeMsg(null); save(true); }} data-testid="button-edit-entry-allow-negative">Yes, save</Button>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => save()} disabled={saving || !entry} data-testid="button-save-edit-entry-ledger">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
