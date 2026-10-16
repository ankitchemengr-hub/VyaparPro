import { useEffect, useState } from "react";
import { Link, Redirect } from "wouter";
import {
  useGetMySubscription, getGetMySubscriptionQueryKey, useListPortalPlans,
  useCreatePortalPaymentOrder, useVerifyPortalPayment,
  useGetMyDomain, getGetMyDomainQueryKey, useSetMyDomain,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Building2, Globe, ExternalLink } from "lucide-react";

declare global {
  interface Window { Razorpay: any; }
}

function useRazorpayScript() {
  const [ready, setReady] = useState(!!window.Razorpay);
  useEffect(() => {
    if (window.Razorpay) { setReady(true); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => setReady(true);
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);
  return ready;
}

const REGISTRARS = [
  { name: "GoDaddy", price: "₹99 – ₹999/yr (.com renews higher)", url: "https://www.godaddy.com/en-in/domains" },
  { name: "Namecheap", price: "₹700 – ₹1,000/yr for .com", url: "https://www.namecheap.com/domains/" },
  { name: "BigRock", price: "₹99 first year, India-based support", url: "https://www.bigrock.in/domain-registration" },
  { name: "Hostinger", price: "Often bundled free with hosting plans", url: "https://www.hostinger.in/domain-name-search" },
];

function DomainCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetMyDomain({ query: { queryKey: getGetMyDomainQueryKey() } });
  const setDomain = useSetMyDomain();
  const [mode, setMode] = useState<"have" | "need">("have");
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (data?.customDomain) setValue(data.customDomain);
  }, [data?.customDomain]);

  const handleSave = () => {
    setDomain.mutate(
      { data: { domain: value.trim() || null } },
      {
        onSuccess: (res) => {
          queryClient.setQueryData(getGetMyDomainQueryKey(), res);
          setEditing(false);
          toast({ title: res.customDomain ? "Domain saved" : "Domain cleared" });
        },
        onError: (err: any) => {
          toast({ title: "Could not save domain", description: err?.body?.error ?? "Check the format and try again.", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Globe className="w-5 h-5 text-blue-600" /> Custom Domain</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        ) : data?.customDomain && !editing ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div>
                <span className="text-sm text-slate-500">Your domain</span>
                <div className="font-medium">{data.customDomain}</div>
              </div>
              <Badge variant={data.status === "active" ? "default" : "outline"} className={data.status === "active" ? "bg-green-600 hover:bg-green-600" : ""}>
                {data.status === "active" ? "Active" : "Pending setup"}
              </Badge>
            </div>
            {data.status === "active" ? (
              <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                Your domain is live and pointing to your SHRADHA ERP account.
              </div>
            ) : (
              <div className="rounded-md bg-slate-50 border p-3 text-sm text-slate-600">
                We've received your request. Our team sets up domains manually — this is usually done within <strong>24 hours</strong>, and we'll email you once it's live.
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Change Domain</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button size="sm" variant={mode === "have" ? "default" : "outline"} onClick={() => setMode("have")}>I already have a domain</Button>
              <Button size="sm" variant={mode === "need" ? "default" : "outline"} onClick={() => setMode("need")}>I need to buy one</Button>
            </div>

            {mode === "have" ? (
              <div className="space-y-2">
                <Label htmlFor="domain">Your domain</Label>
                <div className="flex gap-2">
                  <Input id="domain" placeholder="myshop.com" value={value} onChange={(e) => setValue(e.target.value)} />
                  <Button onClick={handleSave} disabled={setDomain.isPending || !value.trim()}>
                    {setDomain.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Save
                  </Button>
                  {editing && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
                </div>
                <p className="text-xs text-slate-500">Our team will manually set this up — usually within 24 hours — and email you once it's live.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">Pick a registrar, buy your domain, then come back and enter it above under "I already have a domain".</p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {REGISTRARS.map((r) => (
                    <a key={r.name} href={r.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-md border p-3 text-sm hover:border-blue-400 hover:bg-blue-50 transition-colors">
                      <div>
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="text-slate-500">{r.price}</div>
                      </div>
                      <ExternalLink className="w-4 h-4 text-slate-400 shrink-0" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PortalSubscription() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const razorpayReady = useRazorpayScript();

  const { data: sub, isLoading } = useGetMySubscription({
    query: { enabled: isAuthenticated, queryKey: getGetMySubscriptionQueryKey() },
  });
  const { data: plans = [] } = useListPortalPlans();
  const createOrder = useCreatePortalPaymentOrder();
  const verifyPayment = useVerifyPortalPayment();
  const [paying, setPaying] = useState(false);

  if (authLoading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;

  const currentPlan = plans.find((p) => p.slug === sub?.planTier);

  const handleRenew = () => {
    if (!sub || !user) return;
    if (!razorpayReady) {
      toast({ title: "Payment is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    setPaying(true);
    createOrder.mutate(
      { data: { subscriptionId: sub.id, planSlug: sub.planTier ?? "", billingCycle: (sub.billingCycle as any) ?? "monthly" } },
      {
        onSuccess: (order) => {
          const rzp = new window.Razorpay({
            key: order.keyId,
            order_id: order.orderId,
            amount: Math.round(order.amount * 100),
            currency: order.currency,
            name: "SHRADHA ERP",
            description: `${currentPlan?.name ?? "Subscription"} — Renewal`,
            theme: { color: "#2563eb" },
            handler: (response: any) => {
              verifyPayment.mutate(
                {
                  data: {
                    razorpayOrderId: response.razorpay_order_id,
                    razorpayPaymentId: response.razorpay_payment_id,
                    razorpaySignature: response.razorpay_signature,
                  },
                },
                {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
                    toast({ title: "Payment successful", description: "Your subscription has been renewed." });
                    setPaying(false);
                  },
                  onError: () => {
                    toast({ title: "Payment verification failed", description: "Please contact support.", variant: "destructive" });
                    setPaying(false);
                  },
                },
              );
            },
            modal: { ondismiss: () => setPaying(false) },
          });
          rzp.open();
        },
        onError: () => {
          toast({ title: "Could not start payment", variant: "destructive" });
          setPaying(false);
        },
      },
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-900"><ArrowLeft className="w-5 h-5" /></Link>
          <span className="font-bold text-slate-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> Manage Subscription</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {isLoading || !sub ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : (
          <Card>
            <CardHeader><CardTitle>{currentPlan?.name ?? sub.planTier ?? "Your Plan"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div><span className="text-slate-500">Billing Cycle</span><div className="font-medium capitalize">{sub.billingCycle?.replace("_", "-") ?? "—"}</div></div>
                <div><span className="text-slate-500">Amount</span><div className="font-medium">₹{sub.subscriptionAmount.toLocaleString("en-IN")}</div></div>
                <div><span className="text-slate-500">Start Date</span><div className="font-medium">{sub.subscriptionStartDate ? new Date(sub.subscriptionStartDate).toLocaleDateString("en-IN") : "—"}</div></div>
                <div><span className="text-slate-500">Expiry Date</span><div className="font-medium">{new Date(sub.subscriptionEndDate).toLocaleDateString("en-IN")}</div></div>
                <div><span className="text-slate-500">Payment Status</span><div><Badge variant="outline" className="capitalize">{sub.paymentStatus}</Badge></div></div>
                <div><span className="text-slate-500">Status</span><div><Badge variant="outline" className="capitalize">{sub.subscriptionStatus}</Badge></div></div>
              </div>
              <Separator />
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleRenew} disabled={paying} className="bg-blue-600 hover:bg-blue-700">
                  {paying && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Renew Now
                </Button>
                <Link href="/pricing"><Button variant="outline">Upgrade Plan</Button></Link>
                <Link href="/contact"><Button variant="ghost">Contact Sales</Button></Link>
              </div>
              {sub.subscriptionStatus === "expired" && (
                <p className="text-sm text-red-600">Your SHRADHA ERP subscription has expired. Renew now to restore access — your data is safe and has not been deleted.</p>
              )}
            </CardContent>
          </Card>
        )}

        {!isLoading && sub && (
          <div className="mt-6">
            <DomainCard />
          </div>
        )}
      </main>
    </div>
  );
}
