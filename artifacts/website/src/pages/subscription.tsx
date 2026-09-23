import { useEffect, useState } from "react";
import { Link, Redirect } from "wouter";
import {
  useGetMySubscription, getGetMySubscriptionQueryKey, useListPortalPlans,
  useCreatePortalPaymentOrder, useVerifyPortalPayment,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Building2 } from "lucide-react";

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
      </main>
    </div>
  );
}
