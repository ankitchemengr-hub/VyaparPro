import { Link, Redirect } from "wouter";
import { useListMyPayments, getListMyPaymentsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Building2 } from "lucide-react";

const STATUS_TONE: Record<string, string> = {
  success: "bg-teal-100 text-teal-700 hover:bg-teal-100",
  pending: "bg-amber-100 text-amber-700 hover:bg-amber-100",
  failed: "bg-red-100 text-red-700 hover:bg-red-100",
  refunded: "bg-slate-100 text-slate-700 hover:bg-slate-100",
};

export default function PortalPayments() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data: payments = [], isLoading } = useListMyPayments({
    query: { enabled: isAuthenticated, queryKey: getListMyPaymentsQueryKey() },
  });

  if (authLoading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-900"><ArrowLeft className="w-5 h-5" /></Link>
          <span className="font-bold text-slate-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> Payment History</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : payments.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-slate-500">No payments yet.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {payments.map((p) => (
              <Card key={p.id}>
                <CardContent className="p-4 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-medium capitalize">{p.planTier} — {p.billingCycle.replace("_", "-")}</div>
                    <div className="text-xs text-slate-500">{new Date(p.createdAt).toLocaleString("en-IN")}</div>
                    {p.razorpayPaymentId && <div className="text-[11px] text-slate-400 font-mono mt-0.5">{p.razorpayPaymentId}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-bold">₹{p.amount.toLocaleString("en-IN")}</div>
                    <Badge className={STATUS_TONE[p.status] ?? ""}>{p.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
