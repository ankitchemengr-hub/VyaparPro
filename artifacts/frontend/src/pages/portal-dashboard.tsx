import { Link, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMySubscription, useGetSystemConfig, useLogout, getGetMySubscriptionQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink, RefreshCw, PlayCircle, Receipt, MessageCircle, Building2, LogOut } from "lucide-react";

const STATUS_TONE: Record<string, string> = {
  active: "bg-teal-100 text-teal-700 hover:bg-teal-100",
  expired: "bg-red-100 text-red-700 hover:bg-red-100",
  suspended: "bg-amber-100 text-amber-700 hover:bg-amber-100",
};

export default function PortalDashboard() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: sub, isLoading } = useGetMySubscription({
    query: { enabled: isAuthenticated, queryKey: getGetMySubscriptionQueryKey() },
  });
  const { data: systemConfig } = useGetSystemConfig();
  const logout = useLogout();
  const queryClient = useQueryClient();

  if (authLoading) return null;
  if (!isAuthenticated) return <Redirect to="/portal/login" />;

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        window.location.href = "/portal/login";
      },
    });
  };

  const erpUrl = systemConfig?.erpApplicationUrl || "/";

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-slate-900">
            <Building2 className="w-6 h-6 text-blue-600" /> SHRADHA ERP
          </Link>
          <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-1.5">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user?.name ?? "there"}</h1>
          <p className="text-slate-500 text-sm mt-1">Here's what's happening with your account.</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : !sub ? (
          <Card><CardContent className="p-8 text-center text-slate-500">No subscription found for your account.</CardContent></Card>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Current Plan</CardTitle></CardHeader>
                <CardContent><div className="text-xl font-bold capitalize">{sub.planTier ?? "—"}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Status</CardTitle></CardHeader>
                <CardContent>
                  <Badge className={STATUS_TONE[sub.subscriptionStatus] ?? ""}>{sub.subscriptionStatus}</Badge>
                  {sub.paymentStatus === "pending" && <Badge variant="outline" className="ml-1.5 text-amber-700 border-amber-300">Payment Pending</Badge>}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Expiry</CardTitle></CardHeader>
                <CardContent><div className="text-lg font-semibold">{new Date(sub.subscriptionEndDate).toLocaleDateString("en-IN")}</div></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-slate-500">Days Remaining</CardTitle></CardHeader>
                <CardContent>
                  <div className={`text-xl font-bold ${sub.daysRemaining <= 3 ? "text-red-600" : "text-slate-900"}`}>
                    {sub.daysRemaining > 0 ? sub.daysRemaining : 0}
                  </div>
                </CardContent>
              </Card>
            </div>

            {sub.paymentStatus === "pending" && (
              <Card className="border-amber-300 bg-amber-50">
                <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                  <span className="text-sm text-amber-800">Your payment is pending — complete it to activate your account.</span>
                  <Link href="/portal/subscription"><Button size="sm" className="bg-amber-600 hover:bg-amber-700">Complete Payment</Button></Link>
                </CardContent>
              </Card>
            )}
            {sub.subscriptionStatus === "expired" && (
              <Card className="border-red-300 bg-red-50">
                <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
                  <span className="text-sm text-red-800">Your SHRADHA ERP subscription has expired.</span>
                  <Link href="/portal/subscription"><Button size="sm" className="bg-red-600 hover:bg-red-700">Renew Subscription</Button></Link>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <a href={erpUrl} target="_blank" rel="noopener noreferrer">
                <Card className="hover:border-blue-400 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5 flex items-center gap-3">
                    <ExternalLink className="w-5 h-5 text-blue-600" />
                    <div><div className="font-medium">Open ERP</div><div className="text-xs text-slate-500">Go to your business application</div></div>
                  </CardContent>
                </Card>
              </a>
              <Link href="/portal/subscription">
                <Card className="hover:border-blue-400 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5 flex items-center gap-3">
                    <RefreshCw className="w-5 h-5 text-teal-600" />
                    <div><div className="font-medium">Manage Subscription</div><div className="text-xs text-slate-500">Renew or view your plan</div></div>
                  </CardContent>
                </Card>
              </Link>
              <Link href="/portal/payments">
                <Card className="hover:border-blue-400 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5 flex items-center gap-3">
                    <Receipt className="w-5 h-5 text-slate-600" />
                    <div><div className="font-medium">Payment History</div><div className="text-xs text-slate-500">View past payments</div></div>
                  </CardContent>
                </Card>
              </Link>
              <a href="/#" onClick={(e) => e.preventDefault()}>
                <Card className="hover:border-blue-400 transition-colors cursor-pointer h-full opacity-60">
                  <CardContent className="p-5 flex items-center gap-3">
                    <PlayCircle className="w-5 h-5 text-orange-500" />
                    <div><div className="font-medium">Watch Tutorials</div><div className="text-xs text-slate-500">Coming soon</div></div>
                  </CardContent>
                </Card>
              </a>
              <Link href="/contact">
                <Card className="hover:border-blue-400 transition-colors cursor-pointer h-full">
                  <CardContent className="p-5 flex items-center gap-3">
                    <MessageCircle className="w-5 h-5 text-green-600" />
                    <div><div className="font-medium">Contact Support</div><div className="text-xs text-slate-500">We're here to help</div></div>
                  </CardContent>
                </Card>
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
