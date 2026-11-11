// Platform Console → Plans & Offers: change a plan's price, features and
// trial; run an offer price until a date; give a discount for paying 3 / 6 /
// 12 months at once; and make coupon codes. The website and the payment read
// these live — see api-server lib/plan-pricing.ts and routes/plan-offers.ts.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Pencil, Tag, Percent, TicketPercent, Trash2 } from "lucide-react";

interface Plan {
  id: number; slug: string; name: string; tagline: string; priceMonthly: number; trialDays: number;
  maxUsers: number | null; maxCompanies: number | null; features: string[]; isActive: boolean;
  offerPrice: number | null; offerLabel: string | null; offerEndsAt: string | null;
}
interface Coupon {
  id: number; code: string; kind: "percent" | "flat"; value: number; planSlugs: string[];
  maxUses: number | null; usedCount: number; validUntil: string | null; isActive: boolean; note: string | null;
}
interface CycleDiscounts { quarterly: number; half_yearly: number; yearly: number }
interface Data { plans: Plan[]; coupons: Coupon[]; cycleDiscounts: CycleDiscounts }

const KEY = ["/api/platform-pricing"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
// <input type="date"> value ↔ end of that day, local time.
const toDateInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : "");
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59`).toISOString() : null);

function offerRunning(p: Plan) {
  return p.offerPrice != null && p.offerPrice < p.priceMonthly && (!p.offerEndsAt || new Date(p.offerEndsAt) > new Date());
}

function PlanDialog({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    name: plan.name, tagline: plan.tagline, priceMonthly: String(plan.priceMonthly), trialDays: String(plan.trialDays),
    maxUsers: plan.maxUsers == null ? "" : String(plan.maxUsers), maxCompanies: plan.maxCompanies == null ? "" : String(plan.maxCompanies),
    features: plan.features.join("\n"), isActive: plan.isActive,
    offerOn: plan.offerPrice != null, offerPrice: plan.offerPrice == null ? "" : String(plan.offerPrice),
    offerLabel: plan.offerLabel ?? "", offerEndsAt: toDateInput(plan.offerEndsAt),
  });
  const price = Number(f.priceMonthly);
  const offer = Number(f.offerPrice);
  const offerPct = f.offerOn && price > 0 && offer > 0 && offer < price ? Math.round((1 - offer / price) * 100) : null;

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/platform-pricing/plans/${plan.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: f.name, tagline: f.tagline, priceMonthly: f.priceMonthly, trialDays: f.trialDays || 0,
          maxUsers: f.maxUsers, maxCompanies: f.maxCompanies,
          features: f.features.split("\n"), isActive: f.isActive,
          offerPrice: f.offerOn ? f.offerPrice : null,
          offerLabel: f.offerOn ? f.offerLabel : null,
          offerEndsAt: f.offerOn ? endOfDay(f.offerEndsAt) : null,
        }),
      });
      toast({ title: `${f.name} saved`, description: "The website and payments use the new price straight away." });
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit plan — {plan.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="pl-name">Plan name</Label>
            <Input id="pl-name" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pl-price">Price / month (₹, before GST)</Label>
            <Input id="pl-price" inputMode="decimal" value={f.priceMonthly} onChange={(e) => setF({ ...f, priceMonthly: e.target.value })} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label htmlFor="pl-tagline">Tagline</Label>
            <Input id="pl-tagline" value={f.tagline} maxLength={200} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pl-trial">Free trial (days)</Label>
            <Input id="pl-trial" inputMode="numeric" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pl-users">Max users</Label>
            <Input id="pl-users" inputMode="numeric" placeholder="No limit" value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pl-cos">Max companies</Label>
            <Input id="pl-cos" inputMode="numeric" placeholder="No limit" value={f.maxCompanies} onChange={(e) => setF({ ...f, maxCompanies: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="flex items-end gap-2 pb-2">
            <Switch id="pl-active" checked={f.isActive} onCheckedChange={(v) => setF({ ...f, isActive: v })} />
            <Label htmlFor="pl-active">Show on website</Label>
          </div>
          <div className="space-y-1 col-span-2">
            <Label htmlFor="pl-features">Features (one per line)</Label>
            <Textarea id="pl-features" rows={5} value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} />
          </div>
        </div>

        <div className="rounded-lg border p-3 space-y-3 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium"><Tag className="h-4 w-4 text-amber-600" /> Offer</div>
            <Switch checked={f.offerOn} onCheckedChange={(v) => setF({ ...f, offerOn: v })} aria-label="Run an offer" />
          </div>
          {f.offerOn && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="pl-offer">Offer price / month (₹)</Label>
                <Input id="pl-offer" inputMode="decimal" value={f.offerPrice} onChange={(e) => setF({ ...f, offerPrice: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pl-offer-end">Offer ends on</Label>
                <Input id="pl-offer-end" type="date" value={f.offerEndsAt} min={toDateInput(new Date().toISOString())} onChange={(e) => setF({ ...f, offerEndsAt: e.target.value })} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label htmlFor="pl-offer-name">Offer name (shown on website)</Label>
                <Input id="pl-offer-name" maxLength={60} placeholder="e.g. Diwali Offer" value={f.offerLabel} onChange={(e) => setF({ ...f, offerLabel: e.target.value })} />
              </div>
              <p className="col-span-2 text-xs text-muted-foreground">
                {offerPct != null
                  ? <>Website shows <s>{rs(price)}</s> <b>{rs(offer)}</b> ({offerPct}% off){f.offerEndsAt ? ` until ${fmtDate(endOfDay(f.offerEndsAt))}` : " with no end date"}. It stops by itself after the end date.</>
                  : "Offer price must be less than the monthly price."}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !f.name.trim() || !(price >= 0)}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CycleDiscountsCard({ value, examplePrice }: { value: CycleDiscounts; examplePrice: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ quarterly: String(value.quarterly), half_yearly: String(value.half_yearly), yearly: String(value.yearly) });
  const [saving, setSaving] = useState(false);
  const rows = [
    { key: "quarterly" as const, label: "3 months", months: 3 },
    { key: "half_yearly" as const, label: "6 months", months: 6 },
    { key: "yearly" as const, label: "12 months", months: 12 },
  ];
  const save = async () => {
    setSaving(true);
    try {
      await api("/api/platform-pricing/cycle-discounts", { method: "PUT", body: JSON.stringify(f) });
      toast({ title: "Discounts saved" });
      queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Percent className="h-4 w-4" /> Pay longer, pay less</CardTitle>
        <CardDescription>Discount for paying several months at once, on every plan. 0 = no discount. Tip: 2 months free on yearly ≈ 16.67%.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {rows.map((r) => {
            const pct = Number(f[r.key]) || 0;
            const full = examplePrice * r.months;
            return (
              <div key={r.key} className="space-y-1">
                <Label htmlFor={`cd-${r.key}`}>{r.label} — discount %</Label>
                <Input id={`cd-${r.key}`} inputMode="decimal" value={f[r.key]} onChange={(e) => setF({ ...f, [r.key]: e.target.value })} />
                {examplePrice > 0 && (
                  <p className="text-xs text-muted-foreground">
                    e.g. {rs(examplePrice)}/mo → {pct > 0 ? <><s>{rs(full)}</s> </> : null}{rs(Math.round(full * (1 - pct / 100)))}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save discounts</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CouponsCard({ coupons, plans }: { coupons: Coupon[]; plans: Plan[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const empty = { code: "", kind: "percent" as "percent" | "flat", value: "", planSlugs: [] as string[], maxUses: "", validUntil: "", note: "" };
  const [f, setF] = useState(empty);
  const [saving, setSaving] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  const create = async () => {
    setSaving(true);
    try {
      const c = await api<Coupon>("/api/platform-pricing/coupons", {
        method: "POST",
        body: JSON.stringify({ ...f, validUntil: endOfDay(f.validUntil), maxUses: f.maxUses || null }),
      });
      toast({ title: `Coupon ${c.code} created` });
      setF(empty);
      refresh();
    } catch (e: any) {
      toast({ title: "Could not create coupon", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (c: Coupon, isActive: boolean) => {
    try {
      await api(`/api/platform-pricing/coupons/${c.id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      refresh();
    } catch (e: any) {
      toast({ title: "Could not update", description: e.message, variant: "destructive" });
    }
  };
  const remove = async (c: Coupon) => {
    if (!window.confirm(`Delete coupon ${c.code}?`)) return;
    try {
      await api(`/api/platform-pricing/coupons/${c.id}`, { method: "DELETE" });
      refresh();
    } catch (e: any) {
      toast({ title: "Could not delete", description: e.message, variant: "destructive" });
    }
  };
  const planName = (slug: string) => plans.find((p) => p.slug === slug)?.name ?? slug;
  const status = (c: Coupon) => {
    if (!c.isActive) return <Badge variant="outline">Off</Badge>;
    if (c.validUntil && new Date(c.validUntil) <= new Date()) return <Badge variant="secondary">Expired</Badge>;
    if (c.maxUses != null && c.usedCount >= c.maxUses) return <Badge variant="secondary">Used up</Badge>;
    return <Badge className="bg-green-600 hover:bg-green-600">Active</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><TicketPercent className="h-4 w-4" /> Coupon codes</CardTitle>
        <CardDescription>Customers type the code when they sign up or renew. It applies after the offer and the long-period discount.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="cp-code">Code</Label>
            <Input id="cp-code" placeholder="e.g. NEW20" value={f.code} maxLength={20}
              onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") })} />
          </div>
          <div className="space-y-1">
            <Label>Discount</Label>
            <div className="flex gap-2">
              <Select value={f.kind} onValueChange={(v) => setF({ ...f, kind: v as "percent" | "flat" })}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">%</SelectItem>
                  <SelectItem value="flat">₹ off</SelectItem>
                </SelectContent>
              </Select>
              <Input inputMode="decimal" aria-label="Discount value" placeholder={f.kind === "percent" ? "20" : "500"} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-max">Max uses</Label>
            <Input id="cp-max" inputMode="numeric" placeholder="No limit" value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cp-until">Valid until</Label>
            <Input id="cp-until" type="date" value={f.validUntil} min={toDateInput(new Date().toISOString())} onChange={(e) => setF({ ...f, validUntil: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Plans (none ticked = all plans)</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
              {plans.filter((p) => p.priceMonthly > 0).map((p) => (
                <label key={p.slug} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={f.planSlugs.includes(p.slug)}
                    onCheckedChange={(v) => setF({ ...f, planSlugs: v ? [...f.planSlugs, p.slug] : f.planSlugs.filter((s) => s !== p.slug) })}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="cp-note">Note (only you see it)</Label>
            <Input id="cp-note" placeholder="e.g. For Solapur traders association" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={create} disabled={saving || f.code.length < 3 || !(Number(f.value) > 0)}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create coupon
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Plans</TableHead>
                <TableHead className="text-right">Used</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">On / Off</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coupons.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No coupons yet.</TableCell></TableRow>
              ) : coupons.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-mono font-semibold">{c.code}</div>
                    {c.note && <div className="text-xs text-muted-foreground">{c.note}</div>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{c.kind === "percent" ? `${c.value}% off` : `${rs(c.value)} off`}</TableCell>
                  <TableCell className="text-xs">{c.planSlugs.length ? c.planSlugs.map(planName).join(", ") : "All plans"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(c.validUntil)}</TableCell>
                  <TableCell>{status(c)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Switch checked={c.isActive} onCheckedChange={(v) => toggle(c, v)} aria-label={`Switch ${c.code} on or off`} />
                      {c.usedCount === 0 && (
                        <Button size="icon" variant="ghost" onClick={() => remove(c)} aria-label={`Delete ${c.code}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
  );
}

export function PlansOffersPanel() {
  const { data, isLoading, error } = useQuery({ queryKey: KEY, queryFn: () => api<Data>("/api/platform-pricing") });
  const [editing, setEditing] = useState<Plan | null>(null);

  if (isLoading) return <div className="py-10 text-center"><Loader2 className="inline h-5 w-5 animate-spin" /></div>;
  if (error || !data) return <div className="py-10 text-center text-sm text-destructive">{(error as Error)?.message ?? "Could not load"}</div>;

  const paidPlans = data.plans.filter((p) => p.priceMonthly > 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plans</CardTitle>
          <CardDescription>Prices are per month, before 18% GST. Changes show on the website and apply to new payments straight away.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.plans.map((p) => {
              const running = offerRunning(p);
              return (
                <div key={p.id} className={`rounded-xl border p-4 flex flex-col ${p.isActive ? "" : "opacity-60"}`} data-testid={`plan-card-${p.slug}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{p.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{p.tagline || "—"}</div>
                    </div>
                    {!p.isActive && <Badge variant="outline">Hidden</Badge>}
                  </div>
                  <div className="mt-3">
                    {p.priceMonthly === 0 ? (
                      <div className="text-lg font-bold">Custom pricing</div>
                    ) : running ? (
                      <div>
                        <span className="text-sm text-muted-foreground line-through mr-1.5">{rs(p.priceMonthly)}</span>
                        <span className="text-xl font-bold text-green-600">{rs(p.offerPrice!)}</span>
                        <span className="text-xs text-muted-foreground">/mo</span>
                      </div>
                    ) : (
                      <div><span className="text-xl font-bold">{rs(p.priceMonthly)}</span><span className="text-xs text-muted-foreground">/mo</span></div>
                    )}
                  </div>
                  {running && (
                    <Badge className="mt-2 w-fit bg-amber-500 hover:bg-amber-500">
                      {p.offerLabel || "Offer"}{p.offerEndsAt ? ` · till ${fmtDate(p.offerEndsAt)}` : ""}
                    </Badge>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground">
                    {p.trialDays > 0 ? `${p.trialDays}-day free trial · ` : ""}
                    {p.maxUsers ? `${p.maxUsers} users` : "Unlimited users"} · {p.features.length} features
                  </div>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setEditing(p)} data-testid={`button-edit-plan-${p.slug}`}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit price & offer
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <CycleDiscountsCard value={data.cycleDiscounts} examplePrice={paidPlans[0]?.priceMonthly ?? 0} />
      <CouponsCard coupons={data.coupons} plans={data.plans} />

      {editing && <PlanDialog plan={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
