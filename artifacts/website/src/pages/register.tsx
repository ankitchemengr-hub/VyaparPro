import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useListPortalPlans, useRegisterPortalCustomer, useCreatePortalPaymentOrder, useVerifyPortalPayment,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, Building2 } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

declare global {
  interface Window {
    Razorpay: any;
  }
}

// Loads Razorpay's Checkout.js only on this page — not every page in the app.
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

export default function PortalRegister() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const razorpayReady = useRazorpayScript();

  const preselectedPlan = new URLSearchParams(search).get("plan") ?? "";
  const { data: plans = [] } = useListPortalPlans();
  const register = useRegisterPortalCustomer();
  const createOrder = useCreatePortalPaymentOrder();
  const verifyPayment = useVerifyPortalPayment();

  const [step, setStep] = useState<"form" | "paying" | "done">("form");
  const [form, setForm] = useState({
    businessName: "", ownerName: "", mobile: "", email: "", password: "", confirmPassword: "",
    businessType: "", city: "", state: "", gstin: "", referralCode: "", planSlug: preselectedPlan, agree: false,
  });

  useEffect(() => {
    if (!form.planSlug && plans.length > 0) {
      setForm((f) => ({ ...f, planSlug: preselectedPlan || plans[0].slug }));
    }
  }, [plans, preselectedPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedPlan = plans.find((p) => p.slug === form.planSlug);

  const runPayment = (subscriptionId: number, planSlug: string) => {
    if (!razorpayReady) {
      toast({ title: "Payment is still loading", description: "Please try again in a moment.", variant: "destructive" });
      return;
    }
    createOrder.mutate(
      { data: { subscriptionId, planSlug, billingCycle: "monthly" } },
      {
        onSuccess: (order) => {
          const rzp = new window.Razorpay({
            key: order.keyId,
            order_id: order.orderId,
            amount: Math.round(order.amount * 100),
            currency: order.currency,
            name: "SHRADHA ERP",
            description: `${selectedPlan?.name ?? "Subscription"} — Monthly`,
            prefill: { name: form.ownerName, email: form.email, contact: form.mobile },
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
                  onSuccess: () => setStep("done"),
                  onError: () => toast({ title: "Payment verification failed", description: "Please contact support with your payment ID.", variant: "destructive" }),
                },
              );
            },
            modal: { ondismiss: () => setStep("form") },
          });
          rzp.open();
        },
        onError: () => {
          toast({ title: "Could not start payment", variant: "destructive" });
          setStep("form");
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (!form.mobile.match(/^\d{10}$/)) {
      toast({ title: "Enter a valid 10-digit mobile number", variant: "destructive" });
      return;
    }
    if (form.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(form.gstin.toUpperCase())) {
      toast({ title: "GSTIN format looks invalid", description: "Leave it blank if you're not sure — you can add it later.", variant: "destructive" });
      return;
    }
    if (!form.planSlug) {
      toast({ title: "Please select a plan", variant: "destructive" });
      return;
    }
    if (!form.agree) {
      toast({ title: "Please accept the Terms & Conditions and Privacy Policy", variant: "destructive" });
      return;
    }

    register.mutate(
      {
        data: {
          businessName: form.businessName.trim(),
          ownerName: form.ownerName.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim() || undefined,
          password: form.password,
          businessType: form.businessType.trim() || undefined,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          gstin: form.gstin.trim() || undefined,
          referralCode: form.referralCode.trim() || undefined,
          planSlug: form.planSlug,
          billingCycle: "monthly",
        },
      },
      {
        onSuccess: (result) => {
          if (result.requiresPayment) {
            setStep("paying");
            runPayment(result.subscriptionId, form.planSlug);
          } else {
            setStep("done");
          }
        },
        onError: async (err: any) => {
          let desc = "Please check your details and try again.";
          try { const j = await err?.response?.json?.(); if (j?.error) desc = j.error; } catch { /* ignore */ }
          toast({ title: "Registration failed", description: desc, variant: "destructive" });
        },
      },
    );
  };

  if (step === "done") {
    return (
      <div className="min-h-screen bg-white text-slate-900">
        <SiteHeader />
        <div className="max-w-md mx-auto px-4 py-24 text-center">
          <CheckCircle2 className="w-16 h-16 text-teal-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold">Account created successfully!</h1>
          <p className="mt-2 text-slate-500">Log in to your customer portal to get started.</p>
          <Link href="/login">
            <Button className="mt-6 bg-blue-600 hover:bg-blue-700">Go to Login</Button>
          </Link>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <section className="max-w-xl mx-auto px-4 py-14">
        <div className="text-center mb-8">
          <Building2 className="w-10 h-10 text-blue-600 mx-auto" />
          <h1 className="text-2xl font-bold mt-2">Create Your Account</h1>
          <p className="text-slate-500 text-sm mt-1">Start your SHRADHA ERP journey in minutes.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Business Name *</Label>
                  <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} required />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Owner Name *</Label>
                  <Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} required />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Mobile Number *</Label>
                  <Input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} required />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Password *</Label>
                  <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Confirm Password *</Label>
                  <Input type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} required />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Business Type</Label>
                  <Input value={form.businessType} onChange={(e) => setForm({ ...form, businessType: e.target.value })} placeholder="e.g. Retail" />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>City</Label>
                  <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>State</Label>
                  <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>GSTIN (Optional)</Label>
                  <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label>Referral Code (Optional)</Label>
                  <Input value={form.referralCode} onChange={(e) => setForm({ ...form, referralCode: e.target.value })} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>Plan *</Label>
                  <Select value={form.planSlug} onValueChange={(v) => setForm({ ...form, planSlug: v })}>
                    <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.slug} value={p.slug}>
                          {p.name} — {p.priceMonthly > 0 ? `₹${p.priceMonthly.toLocaleString("en-IN")}/mo` : "Custom pricing"}
                          {p.trialDays > 0 ? ` (${p.trialDays}-day free trial)` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-start gap-2 pt-2">
                <Checkbox id="agree" checked={form.agree} onCheckedChange={(v) => setForm({ ...form, agree: !!v })} />
                <Label htmlFor="agree" className="text-xs font-normal text-slate-500 leading-snug">
                  I agree to the Terms &amp; Conditions and Privacy Policy.
                </Label>
              </div>

              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={register.isPending || step === "paying"}>
                {(register.isPending || step === "paying") && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {step === "paying" ? "Waiting for payment…" : "Create Account"}
              </Button>
              <p className="text-center text-xs text-slate-500">
                Already have an account? <Link href="/login" className="text-blue-600 hover:underline">Log in</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </section>
      <SiteFooter />
    </div>
  );
}
