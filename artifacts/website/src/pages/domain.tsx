import { useState } from "react";
import { Link, Redirect } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Building2, Globe, Loader2, Copy, Check, CheckCircle2, XCircle, Clock, ExternalLink, RefreshCw, Trash2,
} from "lucide-react";

// Shapes returned by /api/portal/domain (artifacts/api-server/src/lib/custom-domains.ts).
interface DnsRecord { type: string; name: string; value: string; current: string | null; ok: boolean | null }
interface DomainInfo {
  domain: string;
  status: "pending" | "active";
  url: string;
  isRootDomain: boolean;
  dnsRecords: DnsRecord[];
  certificateStatus: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  dnsVerifiedAt: string | null;
  activatedAt: string | null;
}
interface DomainState { active: DomainInfo | null; pending: DomainInfo | null; automatic: boolean; targetHost: string | null }

const QUERY_KEY = ["portal-domain"];

const api = {
  get: () => customFetch<DomainState>("/api/portal/domain"),
  add: (domain: string) => customFetch<DomainState>("/api/portal/domain", { method: "POST", body: JSON.stringify({ domain }) }),
  verify: () => customFetch<DomainState>("/api/portal/domain/verify", { method: "POST" }),
  remove: (which: "pending" | "active") => customFetch<DomainState>(`/api/portal/domain/${which}`, { method: "DELETE" }),
};

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const data = err.data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  return "Something went wrong — please try again.";
}

const REGISTRARS = [
  {
    name: "GoDaddy", buy: "https://www.godaddy.com/en-in/domains",
    steps: ["Sign in → My Products → next to your domain click DNS.", "Click Add New Record, pick the Type shown below.", "Fill Name and Value exactly as shown, leave TTL as default, Save."],
  },
  {
    name: "Hostinger", buy: "https://www.hostinger.in/domain-name-search",
    steps: ["hPanel → Domains → your domain → DNS / Nameservers.", "Under Manage DNS records choose the Type, enter Name and the Target/Value.", "Click Add Record."],
  },
  {
    name: "BigRock", buy: "https://www.bigrock.in/domain-registration",
    steps: ["Sign in → Manage Orders → List/Search Orders → open your domain.", "Click DNS Management → Manage DNS → the record type's tab (e.g. CNAME Records).", "Add Record with the Name and Value shown, then Save."],
  },
  {
    name: "Namecheap", buy: "https://www.namecheap.com/domains/",
    steps: ["Domain List → Manage next to your domain → Advanced DNS.", "Add New Record, pick the Type, enter Host and Value/Target.", "Click the green tick to save."],
  },
  {
    name: "Cloudflare", buy: "https://www.cloudflare.com/products/registrar/",
    steps: ["Select your domain → DNS → Records → Add record.", "Pick the Type, enter Name and Target as shown.", "Set Proxy status to DNS only (grey cloud) so the HTTPS certificate can be issued, then Save."],
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ml-2 inline-flex items-center text-slate-400 hover:text-blue-600 shrink-0"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
    </button>
  );
}

function RecordStatus({ ok }: { ok: boolean | null }) {
  if (ok === true) return <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="w-4 h-4" /> Found</span>;
  if (ok === false) return <span className="inline-flex items-center gap-1 text-amber-700"><XCircle className="w-4 h-4" /> Not found yet</span>;
  return <span className="inline-flex items-center gap-1 text-slate-400"><Clock className="w-4 h-4" /> Not checked</span>;
}

function DnsTable({ records }: { records: DnsRecord[] }) {
  if (records.length === 0) {
    return (
      <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
        The DNS records for this domain aren't ready yet. Click <strong>Check DNS now</strong> in a minute, or contact support.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Name / Host</th>
            <th className="px-3 py-2 font-medium">Value / Points to</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i} className="border-t align-top">
              <td className="px-3 py-2 font-mono">{r.type}</td>
              <td className="px-3 py-2"><span className="inline-flex items-center font-mono break-all">{r.name}<CopyButton text={r.name} /></span></td>
              <td className="px-3 py-2">
                <span className="inline-flex items-center font-mono break-all">{r.value}<CopyButton text={r.value} /></span>
                {r.ok === false && r.current && <div className="text-xs text-slate-500 mt-1">Currently: <span className="font-mono">{r.current}</span></div>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap"><RecordStatus ok={r.ok} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PortalDomain() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<"pending" | "active" | null>(null);

  const { data, isLoading, isError } = useQuery({ queryKey: QUERY_KEY, queryFn: api.get, enabled: isAuthenticated });

  const onState = (s: DomainState) => queryClient.setQueryData(QUERY_KEY, s);
  const onError = (err: unknown) => toast({ title: errorText(err), variant: "destructive" });

  const add = useMutation({
    mutationFn: api.add,
    onSuccess: (s) => { onState(s); setInput(""); toast({ title: "Domain saved", description: "Now add the DNS records shown below." }); },
    onError,
  });
  const verify = useMutation({
    mutationFn: api.verify,
    onSuccess: (s) => {
      onState(s);
      const wasPending = data?.pending?.domain;
      if (wasPending && s.active?.domain === wasPending) toast({ title: "Your domain is live!", description: s.active.url });
      else if (s.pending?.dnsVerifiedAt) toast({ title: "DNS is correct", description: s.automatic ? "Finishing setup…" : "Our team will switch it on shortly." });
      else toast({ title: "DNS not ready yet", description: "Check the records below and try again in a few minutes.", variant: "destructive" });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: api.remove,
    onSuccess: (s) => { onState(s); setConfirmRemove(null); toast({ title: "Domain removed" }); },
    onError,
  });

  if (authLoading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;

  const active = data?.active ?? null;
  const pending = data?.pending ?? null;

  const RemoveControl = ({ which, label }: { which: "pending" | "active"; label: string }) =>
    confirmRemove === which ? (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-red-700">
          {which === "active" ? "Your shop will stop opening on this domain. Remove it?" : "Cancel this domain change?"}
        </span>
        <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(which)}>
          {remove.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Yes, remove
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Keep it</Button>
      </div>
    ) : (
      <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setConfirmRemove(which)}>
        <Trash2 className="w-4 h-4 mr-1.5" /> {label}
      </Button>
    );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-900"><ArrowLeft className="w-5 h-5" /></Link>
          <span className="font-bold text-slate-900 flex items-center gap-2"><Building2 className="w-5 h-5 text-blue-600" /> My Domain</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Open your ERP on your own domain</h1>
          <p className="text-slate-500 text-sm mt-1">
            Connect a domain like <span className="font-mono">erp.myshop.com</span> — your staff open it and see your shop's own login page.
          </p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : isError || !data ? (
          <Card><CardContent className="p-8 text-center text-slate-500">Couldn't load your domain settings. Please refresh the page.</CardContent></Card>
        ) : (
          <>
            {/* Live domain */}
            {active && (
              <Card className="border-green-200">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Globe className="w-5 h-5 text-green-600" /> Your live domain
                    <Badge className="bg-green-600 hover:bg-green-600 ml-1">Live</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <a href={active.url} target="_blank" rel="noopener noreferrer" className="text-lg font-semibold text-blue-700 hover:underline inline-flex items-center gap-1.5 break-all">
                    {active.url} <ExternalLink className="w-4 h-4 shrink-0" />
                  </a>
                  {active.certificateStatus && !/VALID|ISSUED/i.test(active.certificateStatus) && (
                    <p className="text-sm text-amber-700">Your HTTPS certificate is still being issued — if the browser shows a warning, wait a few minutes.</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button size="sm" variant="outline" disabled={verify.isPending || !!pending} onClick={() => verify.mutate()}>
                      <RefreshCw className="w-4 h-4 mr-1.5" /> Re-check
                    </Button>
                    <RemoveControl which="active" label="Remove domain" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Domain being set up / changed */}
            {pending && (
              <Card className="border-blue-200">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base flex-wrap">
                    <Globe className="w-5 h-5 text-blue-600" /> {active ? "Changing to" : "Setting up"} <span className="font-mono">{pending.domain}</span>
                    <Badge variant="outline" className="ml-1">{pending.dnsVerifiedAt ? "DNS verified" : "Waiting for DNS"}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {active && (
                    <p className="text-sm text-slate-600">
                      <span className="font-mono">{active.domain}</span> keeps working until this new domain is verified, then it's switched over automatically.
                    </p>
                  )}

                  <ol className="space-y-4 text-sm">
                    <li>
                      <div className="font-medium text-slate-900">1. Sign in where you bought the domain</div>
                      <div className="text-slate-500">GoDaddy, Hostinger, BigRock, Namecheap, Cloudflare… open its <strong>DNS settings</strong>. Step-by-step help is below.</div>
                    </li>
                    <li className="space-y-2">
                      <div className="font-medium text-slate-900">2. Add {pending.dnsRecords.length > 1 ? "these records" : "this record"}</div>
                      <DnsTable records={pending.dnsRecords} />
                      {pending.isRootDomain && (
                        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-800">
                          <strong>{pending.domain}</strong> is a main (root) domain. Many registrars don't allow a CNAME on the root —
                          if yours refuses, use a sub-domain instead such as <span className="font-mono">erp.{pending.domain}</span> or{" "}
                          <span className="font-mono">www.{pending.domain}</span>, or use Cloudflare (which supports it).
                        </div>
                      )}
                      <p className="text-slate-500">Remove any other A / CNAME record that has the same Name, otherwise they conflict.</p>
                    </li>
                    <li className="space-y-2">
                      <div className="font-medium text-slate-900">3. Check</div>
                      <div className="text-slate-500">DNS usually updates within 15–30 minutes, occasionally up to 24 hours.</div>
                      <Button onClick={() => verify.mutate()} disabled={verify.isPending} className="bg-blue-600 hover:bg-blue-700">
                        {verify.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />} Check DNS now
                      </Button>
                    </li>
                  </ol>

                  {pending.lastError && <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">{pending.lastError}</div>}
                  {pending.dnsVerifiedAt && !data.automatic && (
                    <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                      Your DNS is set up correctly. Our team is switching your domain on — usually within a few hours. We'll email you when it's live.
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                    <span>{pending.lastCheckedAt ? `Last checked ${new Date(pending.lastCheckedAt).toLocaleString("en-IN")}` : "Not checked yet"}</span>
                    <RemoveControl which="pending" label={active ? "Cancel change" : "Cancel"} />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Add / change */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{active || pending ? "Use a different domain" : "Connect your domain"}</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="space-y-2"
                  onSubmit={(e) => { e.preventDefault(); if (input.trim()) add.mutate(input.trim()); }}
                >
                  <Label htmlFor="domain">Domain name</Label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input id="domain" placeholder="erp.myshop.com" value={input} onChange={(e) => setInput(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                    <Button type="submit" disabled={add.isPending || !input.trim()} className="bg-blue-600 hover:bg-blue-700 shrink-0">
                      {add.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      {active || pending ? "Change domain" : "Connect domain"}
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Tip: a sub-domain like <span className="font-mono">erp.myshop.com</span> works with every registrar and keeps your main website free.
                    {active && " Your current domain stays live until the new one is verified."}
                  </p>
                </form>
              </CardContent>
            </Card>

            {/* Registrar help */}
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-base">How to add DNS records</CardTitle></CardHeader>
              <CardContent>
                <Accordion type="single" collapsible>
                  {REGISTRARS.map((r) => (
                    <AccordionItem key={r.name} value={r.name}>
                      <AccordionTrigger className="text-sm">{r.name}</AccordionTrigger>
                      <AccordionContent>
                        <ol className="list-decimal pl-5 space-y-1 text-sm text-slate-600">
                          {r.steps.map((s) => <li key={s}>{s}</li>)}
                        </ol>
                        <a href={r.buy} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          Don't have a domain yet? Buy one at {r.name} <ExternalLink className="w-3 h-3" />
                        </a>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
