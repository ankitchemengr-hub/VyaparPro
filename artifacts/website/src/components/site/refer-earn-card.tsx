// Refer & Earn card on the customer's account page: their code, a share
// link (WhatsApp / copy), where to receive the cash reward (UPI ID) and the
// businesses they brought. Data: GET /api/portal/referrals.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Gift, Copy, MessageCircle, Loader2 } from "lucide-react";

interface MyReferral {
  id: number; businessName: string; status: "signed_up" | "earned" | "paid" | "rejected";
  rewardAmount: number | null; joinedAt: string; payableAfter: string | null; paidAt: string | null;
}
interface Data {
  enabled: boolean; code: string; upiId: string | null;
  rewardKind: "flat" | "percent"; rewardValue: number; newCustomerPct: number; holdDays: number;
  referrals: MyReferral[];
  totals: { joined: number; earned: number; paid: number; due: number };
}

const KEY = ["/api/portal/referrals"];
const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? "Something went wrong");
  return data as T;
}

function statusText(r: MyReferral) {
  if (r.status === "signed_up") return <Badge variant="outline">Joined · not paid yet</Badge>;
  if (r.status === "earned") return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Reward {rs(r.rewardAmount ?? 0)} · coming soon</Badge>;
  if (r.status === "paid") return <Badge className="bg-teal-100 text-teal-700 hover:bg-teal-100">{rs(r.rewardAmount ?? 0)} paid {fmtDate(r.paidAt)}</Badge>;
  return <Badge variant="secondary">No reward</Badge>;
}

export function ReferEarnCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api<Data>("/api/portal/referrals") });
  const [upi, setUpi] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setUpi(data?.upiId ?? ""); }, [data?.upiId]);

  if (isLoading) return <Card><CardContent className="p-6 text-center"><Loader2 className="inline h-5 w-5 animate-spin text-blue-600" /></CardContent></Card>;
  if (!data || !data.enabled) return null;

  const link = `${window.location.origin}/register?ref=${data.code}`;
  const reward = data.rewardKind === "percent" ? `${+data.rewardValue.toFixed(2)}% of their first payment` : rs(data.rewardValue);
  const message = `I use SHRADHA ERP for GST billing, stock and accounts. Sign up with my code ${data.code}`
    + (data.newCustomerPct > 0 ? ` and get ${+data.newCustomerPct.toFixed(2)}% off your first payment` : "")
    + `: ${link}`;

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${what} copied` }); } catch { /* clipboard blocked */ }
  };
  const saveUpi = async () => {
    setSaving(true);
    try {
      await api("/api/portal/referrals/upi", { method: "PUT", body: JSON.stringify({ upiId: upi }) });
      toast({ title: upi.trim() ? "UPI ID saved" : "UPI ID removed" });
      queryClient.invalidateQueries({ queryKey: KEY });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-blue-200" data-testid="card-refer-earn">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Gift className="h-5 w-5 text-blue-600" /> Refer &amp; Earn</CardTitle>
        <p className="text-sm text-slate-600">
          Bring another business to SHRADHA ERP. When they make their first payment you get <b>{reward}</b> cash to your UPI
          {data.newCustomerPct > 0 && <> — and they get <b>{+data.newCustomerPct.toFixed(2)}% off</b> their first payment</>}.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 px-4 py-2 font-mono text-xl font-bold tracking-wider text-blue-700">{data.code}</div>
          <Button variant="outline" size="sm" onClick={() => copy(data.code, "Code")}><Copy className="mr-1.5 h-4 w-4" /> Copy code</Button>
          <Button variant="outline" size="sm" onClick={() => copy(link, "Link")}><Copy className="mr-1.5 h-4 w-4" /> Copy link</Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
            <Button size="sm" className="bg-green-600 hover:bg-green-700"><MessageCircle className="mr-1.5 h-4 w-4" /> Share on WhatsApp</Button>
          </a>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-slate-50 p-2"><div className="text-xs text-slate-500">Joined</div><div className="text-lg font-bold">{data.totals.joined}</div></div>
          <div className="rounded-lg bg-amber-50 p-2"><div className="text-xs text-amber-700">Coming to you</div><div className="text-lg font-bold text-amber-700">{rs(data.totals.due)}</div></div>
          <div className="rounded-lg bg-teal-50 p-2"><div className="text-xs text-teal-700">Paid to you</div><div className="text-lg font-bold text-teal-700">{rs(data.totals.paid)}</div></div>
        </div>

        <div className="space-y-1.5">
          <div className="text-sm font-medium text-slate-700">Your UPI ID (reward is sent here)</div>
          <div className="flex gap-2">
            <Input value={upi} onChange={(e) => setUpi(e.target.value.trim())} placeholder="e.g. 9876543210@ybl" aria-label="UPI ID" />
            <Button variant="outline" onClick={saveUpi} disabled={saving || upi === (data.upiId ?? "")}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
          <p className="text-xs text-slate-500">The reward is sent {data.holdDays > 0 ? `${data.holdDays} days after` : "after"} their first payment.</p>
        </div>

        {data.referrals.length > 0 && (
          <div className="divide-y rounded-lg border">
            {data.referrals.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium break-words">{r.businessName}</div>
                  <div className="text-xs text-slate-500">Joined {fmtDate(r.joinedAt)}</div>
                </div>
                {statusText(r)}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
