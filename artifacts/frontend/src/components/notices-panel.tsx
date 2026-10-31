// Platform Console → Notices: schedule a maintenance window once and every
// customer is emailed automatically (now, an hour before, and when it's
// over), with a banner in the ERP meanwhile. See api-server
// lib/platform-notices.ts.
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Megaphone } from "lucide-react";

interface Notice {
  id: number; title: string; message: string; startsAt: string; endsAt: string; status: "scheduled" | "cancelled";
  announcedAt: string | null; remindedAt: string | null; backSentAt: string | null; lastSendCount: number | null;
}

const KEY = ["/api/subscriptions/notices"];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "numeric", minute: "2-digit", hour12: true }) : "—";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", headers: init?.body ? { "Content-Type": "application/json" } : undefined, ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function statusOf(n: Notice): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (n.status === "cancelled") return { label: "Cancelled", variant: "outline" };
  const now = Date.now();
  if (new Date(n.endsAt).getTime() <= now) return { label: "Over", variant: "secondary" };
  if (new Date(n.startsAt).getTime() <= now) return { label: "In progress", variant: "destructive" };
  return { label: "Upcoming", variant: "default" };
}

export function NoticesPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: "Scheduled maintenance", message: "", startsAt: "", endsAt: "", emailNow: true });
  const [saving, setSaving] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => api<{ notices: Notice[]; recipients: number }>("/api/subscriptions/notices"),
  });

  const save = async () => {
    setSaving(true);
    try {
      const { emailed } = await api<{ emailed: number | null }>("/api/subscriptions/notices", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          // datetime-local is the viewer's local time; send an exact instant.
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        }),
      });
      toast({ title: "Notice saved", description: emailed !== null ? `Emailed to ${emailed} customer(s).` : "Reminder and back-online emails will go out automatically." });
      setForm((f) => ({ ...f, message: "", startsAt: "", endsAt: "" }));
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/system/notice-banner"] });
    } catch (e: any) {
      toast({ title: "Could not save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: number) => {
    try {
      await api(`/api/subscriptions/notices/${id}/cancel`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/system/notice-banner"] });
    } catch (e: any) {
      toast({ title: "Could not cancel", description: e.message, variant: "destructive" });
    }
  };

  const valid = form.title.trim() && form.startsAt && form.endsAt && form.endsAt > form.startsAt;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5" /> Tell all customers about maintenance</CardTitle>
          <CardDescription>
            Enter the time once. Every customer ({data?.recipients ?? "…"} email addresses) is emailed now (if switched on), again an hour before it
            starts, and once it is over. The ERP shows a banner from 24 hours before until the end.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="notice-title">Title</Label>
              <Input id="notice-title" value={form.title} maxLength={200} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notice-start">Starts</Label>
              <Input id="notice-start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="notice-end">Ends</Label>
              <Input id="notice-end" type="datetime-local" value={form.endsAt} min={form.startsAt || undefined} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="notice-message">Extra note (optional)</Label>
              <Textarea id="notice-message" rows={3} maxLength={2000} value={form.message}
                placeholder="e.g. Our server provider is upgrading its systems."
                onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch id="notice-email-now" checked={form.emailNow} onCheckedChange={(v) => setForm({ ...form, emailNow: v })} />
              <Label htmlFor="notice-email-now">Email all customers now</Label>
            </div>
            <Button onClick={save} disabled={!valid || saving} data-testid="button-save-notice">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save notice
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Notices</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="py-6 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Window</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Emails sent</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.notices ?? []).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No notices yet</TableCell></TableRow>
                  ) : data!.notices.map((n) => {
                    const s = statusOf(n);
                    return (
                      <TableRow key={n.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmt(n.startsAt)} – {fmt(n.endsAt)}</TableCell>
                        <TableCell>{n.title}</TableCell>
                        <TableCell><Badge variant={s.variant}>{s.label}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          Now: {fmt(n.announcedAt)} · 1 h before: {fmt(n.remindedAt)} · Back: {fmt(n.backSentAt)}
                          {n.lastSendCount !== null && <> · last {n.lastSendCount}</>}
                        </TableCell>
                        <TableCell className="text-right">
                          {n.status === "scheduled" && new Date(n.endsAt).getTime() > Date.now() && (
                            <Button size="sm" variant="ghost" onClick={() => cancel(n.id)}>Cancel</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
