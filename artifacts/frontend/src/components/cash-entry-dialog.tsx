import { useState, useEffect, useRef } from "react";
import {
  useCreateAccountTransaction,
  useListEntities,
  getListEntitiesQueryKey,
  getGetCashbookQueryKey,
  getListAccountsQueryKey,
  getListAccountTransactionsQueryKey,
  type Account,
  type AccountTransaction,
  type Entity,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowDownCircle, ArrowUpCircle, Loader2, UserCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function CashEntryDialog({
  open,
  direction,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  direction: "in" | "out";
  accounts: Account[];
  onClose: () => void;
  onCreated: (txn: AccountTransaction) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateAccountTransaction();

  const [accountId, setAccountId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [mode, setMode] = useState<string>("cash");
  const [partyName, setPartyName] = useState("");
  const [partyMobile, setPartyMobile] = useState("");
  const [partyEntityId, setPartyEntityId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  // dropdown state for name autocomplete
  const [nameOpen, setNameOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const nameRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  const debouncedName = useDebounced(partyName, 250);
  const debouncedMobile = useDebounced(partyMobile, 250);

  // search by name (when not locked to a selected entity)
  const isNameSearchActive = nameOpen && debouncedName.trim().length >= 1 && !partyEntityId;
  const nameParams = { search: debouncedName.trim() };
  const { data: nameMatches = [], isFetching: isNameSearching } = useListEntities(
    nameParams,
    {
      query: {
        queryKey: getListEntitiesQueryKey(nameParams),
        enabled: isNameSearchActive,
      },
    },
  );

  // search by mobile (when not locked to a selected entity)
  const isMobileSearchActive = mobileOpen && debouncedMobile.trim().length >= 2 && !partyEntityId;
  const mobileParams = { mobile: debouncedMobile.trim() };
  const { data: mobileMatches = [], isFetching: isMobileSearching } = useListEntities(
    mobileParams,
    {
      query: {
        queryKey: getListEntitiesQueryKey(mobileParams),
        enabled: isMobileSearchActive,
      },
    },
  );

  useEffect(() => {
    if (open) {
      setAccountId(accounts[0] ? String(accounts[0].id) : "");
      setAmount("");
      setMode("cash");
      setPartyName("");
      setPartyMobile("");
      setPartyEntityId(null);
      setNotes("");
      setNameOpen(false);
      setMobileOpen(false);
    }
  }, [open, direction, accounts]);

  // close dropdowns on outside click
  useEffect(() => {
    if (!nameOpen && !mobileOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (nameRef.current && !nameRef.current.contains(t)) setNameOpen(false);
      if (mobileRef.current && !mobileRef.current.contains(t)) setMobileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [nameOpen, mobileOpen]);

  const pickEntity = (e: Entity) => {
    setPartyEntityId(e.id);
    setPartyName(e.name);
    setPartyMobile(e.mobile);
    setNameOpen(false);
    setMobileOpen(false);
  };

  const clearLinkedEntity = () => {
    setPartyEntityId(null);
  };

  const handleSubmit = () => {
    const amt = Number(amount);
    if (!accountId || !amt || amt <= 0) {
      toast({ title: "Pick an account and enter a positive amount", variant: "destructive" });
      return;
    }
    create.mutate(
      {
        data: {
          accountId: Number(accountId),
          direction,
          amount: amt,
          mode: mode as any,
          partyName: partyName.trim() || undefined,
          partyMobile: partyMobile.trim() || undefined,
          partyEntityId: partyEntityId ?? undefined,
          notes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: (txn) => {
          queryClient.invalidateQueries({ queryKey: getGetCashbookQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListAccountTransactionsQueryKey() });
          toast({
            title: direction === "in" ? "Payment recorded" : "Payment issued",
            description: `Receipt ${txn.receiptNo ?? `#${txn.id}`}`,
          });
          onCreated(txn);
          onClose();
        },
        onError: (err: any) => {
          toast({ title: "Failed", description: err?.message ?? "Server error", variant: "destructive" });
        },
      },
    );
  };

  const isIn = direction === "in";
  const Icon = isIn ? ArrowDownCircle : ArrowUpCircle;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${isIn ? "text-green-600" : "text-rose-600"}`} />
            {isIn ? "Payment In" : "Payment Out"}
          </DialogTitle>
          <DialogDescription>
            {isIn
              ? "Record cash, UPI or bank credit going INTO an account."
              : "Record cash or transfer going OUT of an account."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>{isIn ? "Deposit to Account *" : "Pay from Account *"}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger data-testid="select-entry-account"><SelectValue placeholder="Choose account..." /></SelectTrigger>
              <SelectContent>
                {accounts.length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted-foreground">No active accounts.</div>
                )}
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name} <span className="text-muted-foreground ml-2 text-xs capitalize">({a.type})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Amount (₹) *</Label>
              <Input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-entry-amount"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode *</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger data-testid="select-entry-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Customer / Party section */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {isIn ? "Received From" : "Paid To"}
              </Label>
              {partyEntityId && (
                <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium">
                  <UserCheck className="w-3 h-3" /> Linked
                  <button
                    type="button"
                    className="ml-1 text-muted-foreground hover:text-foreground"
                    onClick={clearLinkedEntity}
                    data-testid="button-unlink-entity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>

            {/* Name with autocomplete */}
            <div className="space-y-1.5 relative" ref={nameRef}>
              <Label>Name</Label>
              <Input
                value={partyName}
                onChange={(e) => {
                  setPartyName(e.target.value);
                  if (partyEntityId) setPartyEntityId(null);
                  setNameOpen(true);
                }}
                onFocus={() => { if (!partyEntityId) setNameOpen(true); }}
                placeholder="Type to search customer master..."
                autoComplete="off"
                data-testid="input-entry-name"
              />
              {isNameSearchActive && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {isNameSearching ? (
                    <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Searching...
                    </div>
                  ) : nameMatches.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">No matching customer. Type to create new (not saved to master).</div>
                  ) : (
                    nameMatches.slice(0, 8).map((e) => (
                      <button
                        type="button"
                        key={e.id}
                        onClick={() => pickEntity(e)}
                        className={cn(
                          "w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2 text-sm",
                        )}
                        data-testid={`option-name-${e.id}`}
                      >
                        <div>
                          <div className="font-medium">{e.name}</div>
                          <div className="text-xs text-muted-foreground capitalize">{e.type} · {e.mobile}</div>
                        </div>
                        {e.type === "customer" && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Cust</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Mobile with autocomplete */}
            <div className="space-y-1.5 relative" ref={mobileRef}>
              <Label>Mobile Number</Label>
              <Input
                type="tel"
                value={partyMobile}
                onChange={(e) => {
                  setPartyMobile(e.target.value);
                  if (partyEntityId) setPartyEntityId(null);
                  setMobileOpen(true);
                }}
                onFocus={() => { if (!partyEntityId) setMobileOpen(true); }}
                placeholder="10-digit mobile..."
                inputMode="numeric"
                autoComplete="off"
                data-testid="input-entry-mobile"
              />
              {isMobileSearchActive && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 max-h-60 overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {isMobileSearching ? (
                    <div className="p-3 text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Searching...
                    </div>
                  ) : mobileMatches.length === 0 ? (
                    <div className="p-3 text-xs text-muted-foreground">No matching mobile.</div>
                  ) : (
                    mobileMatches.slice(0, 8).map((e) => (
                      <button
                        type="button"
                        key={e.id}
                        onClick={() => pickEntity(e)}
                        className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                        data-testid={`option-mobile-${e.id}`}
                      >
                        <div className="font-medium font-mono">{e.mobile}</div>
                        <div className="text-xs text-muted-foreground">{e.name} <span className="capitalize">· {e.type}</span></div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={create.isPending}
            className={isIn ? "bg-green-600 hover:bg-green-700" : "bg-rose-600 hover:bg-rose-700"}
            data-testid="button-confirm-entry"
          >
            {create.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {isIn ? "Record Payment In" : "Record Payment Out"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
