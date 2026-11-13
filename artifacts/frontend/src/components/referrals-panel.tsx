// Platform Console → Refer & Earn: the reward rules (cash reward for the
// referrer, discount for the new customer, waiting days) and every referral,
// with the referrer's UPI ID so the owner can send the reward and mark it
// paid. See api-server lib/referrals.ts and routes/plan-offers.ts.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Gift, Loader2, Copy } from "lucide-react";

interface Settings { isEnabled: boolean; rewardKind: "flat" | "percent"; rewardValue: number; newCustomerPct: number; holdDays: number }
interface Referral {
  id: number; status: "signed_up" | "earned" | "paid" | "rejected"; code: string; note: string | null;
  firstPaymentAmount: number | null; rewardAmount: number | null; joinedAt: string; earnedAt: string | null;
  payableAfter: string | null; paidAt: string | null; payoutRef: string | null;
  referrer: { companyId: number; name: string; mobile: string | null; upiId: string | null };
  referred: { companyId: number; name: string; mobile: string | null };
}
interface Data { settings: Settings; referrals: Referral[]; totals: { joined: number; paidCustomers: number; due: number; paid: number } }

const KEY = ["/api/platform-pricing/referrals"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function SettingsCard({ value }: { value: Settings }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ ...value, rewardValue: String(value.rewardValue), newCustomerPct: String(value.newCustomerPct), holdDays: String(value.holdDays) });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setF({ ...value, rewardValue: String(value.rewardValue), newCustomerPct: String(value.newCustomerPct), holdDays: String(value.holdDays) });
  }, [value]);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/platform-pricing/referral-settings", { method: "PUT", body: JSON.stringify(f) });
      toast({ title: "Referral rules saved" });
      queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const example = f.rewardKind === "percent"
    ? `If a referred business pays ₹1,000 (before GST), the referrer earns ${rs(1000 * (Number(f.rewardValue) || 0) / 100)}.`
    : `The referrer earns ${rs(Number(f.rewardValue) || 0)} for every business that pays.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Gift className="h-4 w-4" /> Refer &amp; Earn rules</CardTitle>
        <CardDescription>
          Every customer gets a code in their account. A new business that joins with it gets a discount on its first payment.
          When that first payment comes in, the referrer earns a cash reward — you send it by UPI and mark it paid below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={f.isEnabled} onCheckedChange={(v) => setF({ ...f, isEnabled: v })} />
          {f.isEnabled ? "Refer & Earn is ON" : "Refer & Earn is OFF (no new referrals are linked)"}
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label>Cash reward for the referrer</Label>
            <div className="flex gap-2">
              <Select value={f.rewardKind} onValueChange={(v) => setF({ ...f, rewardKind: v as "flat" | "percent" })}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">₹ fixed</SelectItem>
                  <SelectItem value="percent">% of payment</SelectItem>
                </SelectContent>
              </Select>
              <Input inputMode="decimal" aria-label="Reward value" value={f.rewardValue} onChange={(e) => setF({ ...f, rewardValue: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rf-new">New customer discount (first payment, %)</Label>
            <Input id="rf-new" inputMode="decimal" value={f.newCustomerPct} onChange={(e) => setF({ ...f, newCustomerPct: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rf-hold">Wait before paying the reward (days)</Label>
            <Input id="rf-hold" inputMode="numeric" value={f.holdDays} onChange={(e) => setF({ ...f, holdDays: e.target.value.replace(/\D/g, "") })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {example} The wait lets you catch a refunded or fake payment before you pay. Put 0% discount to give the new customer nothing.
        </p>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save rules</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function statusBadge(r: Referral) {
  if (r.status === "signed_up") return <Badge variant="outline">Joined · not paid yet</Badge>;
  if (r.status === "paid") return <Badge className="bg-green-600 hover:bg-green-600">Reward paid</Badge>;
  if (r.status === "rejected") return <Badge variant="secondary">Rejected</Badge>;
  const ready = !r.payableAfter || new Date(r.payableAfter) <= new Date();
  return ready
    ? <Badge className="bg-amber-500 hover:bg-amber-500">Pay reward now</Badge>
    : <Badge variant="outline" className="border-amber-400 text-amber-700">Pay after {fmtDate(r.payableAfter)}</Badge>;
}

function PayDialog({ r, onClose }: { r: Referral; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ref, setRef] = useState("");
  const [saving, setSaving] = useState(false);
  const early = !!r.payableAfter && new Date(r.payableAfter) > new Date();

  const save = async () => {
    // Warn, never block: paying before the wait is over is the owner's call.
    if (early && !window.confirm(`The waiting period ends on ${fmtDate(r.payableAfter)}. If ${r.referred.name} asks for a refund you can't take the reward back. Mark it paid anyway?`)) return;
    setSaving(true);
    try {
      await api(`/api/platform-pricing/referrals/${r.id}/paid`, { method: "POST", body: JSON.stringify({ payoutRef: ref }) });
      toast({ title: "Reward marked paid" });
      queryClient.invalidateQueries({ queryKey: KEY });
      onClose();
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay {rs(r.rewardAmount ?? 0)} to {r.referrer.name}</DialogTitle>
          <DialogDescription>For bringing {r.referred.name}. Send the money by UPI, then enter the UPI reference / UTR here.</DialogDescription>
        </DialogHeader>
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          {r.referrer.upiId ? (
            <div className="flex items-center justify-between gap-2">
              <span>UPI ID: <span className="font-mono font-semibold">{r.referrer.upiId}</span></span>
              <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(r.referrer.upiId!); toast({ title: "UPI ID copied" }); }}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <span className="text-amber-700">No UPI ID added yet{r.referrer.mobile ? ` — call ${r.referrer.mobile}` : ""}.</span>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="rf-ref">UPI reference / UTR</Label>
          <Input id="rf-ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 431245678901" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !ref.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Mark paid</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferralsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => api<Data>("/api/platform-pricing/referrals") });
  const [paying, setPaying] = useState<Referral | null>(null);

  if (isLoading) return <div className="py-10 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div>;
  if (error || !data) return <div className="py-10 text-center text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</div>;

  const reject = async (r: Referral) => {
    const note = window.prompt(`Why is there no reward for ${r.referred.name}? (e.g. refund, fake signup)`);
    if (!note?.trim()) return;
    try {
      await api(`/api/platform-pricing/referrals/${r.id}/reject`, { method: "POST", body: JSON.stringify({ note }) });
      queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e: any) {
      toast({ title: "Could not reject", description: e.message, variant: "destructive" });
    }
  };

  const stats = [
    { label: "Businesses referred", value: String(data.totals.joined) },
    { label: "Of them paid", value: String(data.totals.paidCustomers) },
    { label: "Rewards to pay", value: rs(data.totals.due), tone: data.totals.due > 0 ? "text-amber-600" : "" },
    { label: "Rewards paid", value: rs(data.totals.paid), tone: "text-green-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}><CardContent className="p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`text-xl font-bold ${s.tone ?? ""}`}>{s.value}</div>
          </CardContent></Card>
        ))}
      </div>

      <SettingsCard value={data.settings} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Referrals</CardTitle>
          <CardDescription>Who brought whom. "Pay reward now" rows are waiting for your UPI payment.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead>New business</TableHead>
                  <TableHead className="text-right">First payment</TableHead>
                  <TableHead className="text-right">Reward</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.referrals.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No referrals yet.</TableCell></TableRow>
                ) : data.referrals.map((r) => (
                  <TableRow key={r.id} data-testid={`referral-row-${r.id}`}>
                    <TableCell>
                      <div className="font-medium">{r.referrer.name}</div>
                      <div className="text-xs text-muted-foreground">{r.referrer.upiId ?? r.referrer.mobile ?? ""}</div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{r.referred.name}</div>
                      <div className="text-xs text-muted-foreground">Joined {fmtDate(r.joinedAt)}</div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">{r.firstPaymentAmount != null ? rs(r.firstPaymentAmount) : "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap font-semibold">{r.rewardAmount != null ? rs(r.rewardAmount) : "—"}</TableCell>
                    <TableCell>
                      {statusBadge(r)}
                      {r.status === "paid" && <div className="mt-1 text-xs text-muted-foreground">{fmtDate(r.paidAt)} · {r.payoutRef}</div>}
                      {r.status === "rejected" && r.note && <div className="mt-1 text-xs text-muted-foreground">{r.note}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {r.status === "earned" && <Button size="sm" onClick={() => setPaying(r)}>Mark paid</Button>}
                        {(r.status === "earned" || r.status === "signed_up") && (
                          <Button size="sm" variant="ghost" onClick={() => reject(r)}>Reject</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {paying && <PayDialog r={paying} onClose={() => setPaying(null)} />}
    </div>
  );
}
