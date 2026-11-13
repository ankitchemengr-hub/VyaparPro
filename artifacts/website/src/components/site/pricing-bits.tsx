// Offers, billing cycles and coupon codes on the website (Plans & Offers in
// the Platform Console). Prices always come from the server: GET
// /portal/plans for the cards, POST /portal/quote for the exact amount the
// payment will charge.
import { useEffect, useState } from "react";
import type { SubscriptionPlan } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlanOffer { price: number; label: string | null; endsAt: string | null }
export interface CycleDiscounts { quarterly: number; half_yearly: number; yearly: number }
// GET /portal/plans also sends these (not in the generated types).
export type PlanWithOffer = SubscriptionPlan & { offer?: PlanOffer | null; cycleDiscounts?: CycleDiscounts };

export type BillingCycle = "monthly" | "quarterly" | "half_yearly" | "yearly";
export const CYCLES: { value: BillingCycle; label: string; months: number }[] = [
  { value: "monthly", label: "Monthly", months: 1 },
  { value: "quarterly", label: "3 Months", months: 3 },
  { value: "half_yearly", label: "6 Months", months: 6 },
  { value: "yearly", label: "Yearly", months: 12 },
];

export interface Quote {
  planName: string; billingCycle: BillingCycle; months: number;
  monthlyPrice: number; effectiveMonthly: number; offer: { label: string | null; endsAt: string | null } | null;
  listAmount: number; offerDiscount: number; cycleDiscountPct: number; cycleDiscount: number;
  referral?: { pct: number; discount: number } | null;
  coupon: { code: string; discount: number } | null; totalDiscount: number; taxable: number; gst: number; total: number;
}

const rs = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export async function fetchQuote(body: { planSlug: string; billingCycle: BillingCycle; couponCode?: string; referralCode?: string }): Promise<Quote> {
  const res = await fetch("/api/portal/quote", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Could not get the price");
  return data as Quote;
}

// Price line on a plan card: the offer price with the normal one struck out.
export function PlanPrice({ plan, dark = false, className }: { plan: PlanWithOffer; dark?: boolean; className?: string }) {
  const offer = plan.offer;
  return (
    <div className={className}>
      {offer && (
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold mb-2",
          dark ? "bg-amber-400/20 text-amber-200" : "bg-amber-100 text-amber-800")}>
          <Tag className="h-3 w-3" /> {offer.label || "Offer"}{offer.endsAt ? ` · till ${shortDate(offer.endsAt)}` : ""}
        </span>
      )}
      <div className="flex items-baseline gap-2 flex-wrap">
        {offer && <span className={cn("text-base line-through", dark ? "text-slate-400" : "text-slate-400")}>{rs(plan.priceMonthly)}</span>}
        <span className="text-3xl font-bold tracking-tight">{rs(offer ? offer.price : plan.priceMonthly)}</span>
        <span className={cn("text-sm font-normal", dark ? "text-slate-300" : "text-slate-500")}>/mo</span>
      </div>
    </div>
  );
}

// "Save up to 20% on yearly" line under the pricing heading.
export function cycleSavingsText(plans: PlanWithOffer[]): string | null {
  const d = plans.find((p) => p.cycleDiscounts)?.cycleDiscounts;
  if (!d) return null;
  const best = CYCLES.slice(1).map((c) => ({ c, pct: d[c.value as keyof CycleDiscounts] ?? 0 })).filter((x) => x.pct > 0);
  if (!best.length) return null;
  const top = best[best.length - 1]!;
  return `Pay for longer and save — up to ${+top.pct.toFixed(2)}% off on ${top.c.label.toLowerCase()} billing.`;
}

// Billing cycle, coupon code and the exact amount to pay. `onChange` gives
// the parent the cycle and the applied coupon (or "") whenever they change.
export function CheckoutBox({ planSlug, cycleDiscounts, cycle, onCycle, coupon, onCoupon, referralCode }: {
  planSlug: string;
  // Signup form: a referral code typed in (a logged-in customer's own
  // referral discount is found by the server from the session).
  referralCode?: string;
  cycleDiscounts?: CycleDiscounts;
  cycle: BillingCycle;
  onCycle: (c: BillingCycle) => void;
  coupon: string;
  onCoupon: (code: string) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState(coupon);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => {
    if (!planSlug) return;
    let live = true;
    setLoading(true);
    fetchQuote({ planSlug, billingCycle: cycle, couponCode: coupon || undefined, referralCode: referralCode || undefined })
      .then((q) => { if (live) { setQuote(q); setCodeError(null); } })
      .catch((e: Error) => {
        if (!live) return;
        if (coupon) {
          // The coupon stopped fitting (other plan / cycle): drop it, keep the price.
          setCodeError(e.message);
          onCoupon("");
        } else {
          setQuote(null);
        }
      })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [planSlug, cycle, coupon, referralCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoading(true);
    try {
      await fetchQuote({ planSlug, billingCycle: cycle, couponCode: c, referralCode: referralCode || undefined });
      setCodeError(null);
      onCoupon(c);
    } catch (e: any) {
      setCodeError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">Billing period</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CYCLES.map((c) => {
            const pct = c.value === "monthly" ? 0 : cycleDiscounts?.[c.value as keyof CycleDiscounts] ?? 0;
            const on = cycle === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => onCycle(c.value)}
                aria-pressed={on}
                className={cn("rounded-lg border px-2 py-2 text-sm font-medium transition-colors",
                  on ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300")}
              >
                {c.label}
                {pct > 0 && <span className={cn("block text-[11px] font-semibold", on ? "text-blue-100" : "text-emerald-600")}>Save {+pct.toFixed(2)}%</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-slate-700 mb-2">Coupon code</div>
        {coupon ? (
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <span className="font-mono font-semibold text-emerald-800">{coupon} applied</span>
            <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => { onCoupon(""); setCode(""); }} aria-label="Remove coupon">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Input
              value={code}
              placeholder="Have a code?"
              aria-label="Coupon code"
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply(); } }}
            />
            <Button type="button" variant="outline" onClick={apply} disabled={!code.trim() || loading}>Apply</Button>
          </div>
        )}
        {codeError && <p className="mt-1.5 text-xs text-red-600">{codeError}</p>}
      </div>

      <div className="border-t border-slate-200 pt-3 text-sm space-y-1.5">
        {loading && !quote ? (
          <div className="py-2 text-center"><Loader2 className="inline h-4 w-4 animate-spin text-blue-600" /></div>
        ) : quote ? (
          <>
            <Row label={`${quote.planName} · ${quote.months} month${quote.months > 1 ? "s" : ""} × ${rs(quote.monthlyPrice)}`} value={rs(quote.listAmount)} />
            {quote.offerDiscount > 0 && <Row label={quote.offer?.label || "Offer"} value={`− ${rs(quote.offerDiscount)}`} green />}
            {quote.cycleDiscount > 0 && <Row label={`${quote.months}-month discount (${+quote.cycleDiscountPct.toFixed(2)}%)`} value={`− ${rs(quote.cycleDiscount)}`} green />}
            {quote.referral && <Row label={`Referral discount (${+quote.referral.pct.toFixed(2)}%)`} value={`− ${rs(quote.referral.discount)}`} green />}
            {quote.coupon && <Row label={`Coupon ${quote.coupon.code}`} value={`− ${rs(quote.coupon.discount)}`} green />}
            <Row label="GST 18%" value={rs(quote.gst)} />
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Total to pay</span><span>{rs(quote.total)}</span>
            </div>
            {quote.totalDiscount > 0 && <p className="text-xs font-medium text-emerald-700">You save {rs(quote.totalDiscount)} (before GST).</p>}
          </>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", green ? "text-emerald-700" : "text-slate-600")}>
      <span className="min-w-0">{label}</span><span className="shrink-0 font-medium">{value}</span>
    </div>
  );
}
