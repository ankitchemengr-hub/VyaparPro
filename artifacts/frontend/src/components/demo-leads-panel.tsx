import { useMemo, useState } from "react";
import {
  useListDemoLeads,
  useUpdateDemoLead,
  getListDemoLeadsQueryKey,
  type DemoLead,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Phone, MessageCircle, Mail, Search } from "lucide-react";

type LeadStatus = DemoLead["status"];

const STATUS: Record<LeadStatus, { label: string; tone: string }> = {
  new: { label: "New", tone: "bg-blue-600 text-white hover:bg-blue-600" },
  contacted: { label: "Contacted", tone: "bg-amber-500 text-white hover:bg-amber-500" },
  converted: { label: "Converted", tone: "bg-green-600 text-white hover:bg-green-600" },
  not_interested: { label: "Not interested", tone: "bg-slate-400 text-white hover:bg-slate-400" },
};

// wa.me needs the number with country code and digits only; Indian 10-digit
// mobiles get +91.
function whatsappUrl(mobile: string): string | null {
  const digits = mobile.replace(/\D/g, "");
  if (digits.length === 10) return `https://wa.me/91${digits}`;
  if (digits.length >= 11) return `https://wa.me/${digits.replace(/^0+/, "")}`;
  return null;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });

// Notes cell: edits locally, saves when the field loses focus (only if changed).
function NotesCell({ lead, onSave }: { lead: DemoLead; onSave: (notes: string) => void }) {
  const [value, setValue] = useState(lead.notes ?? "");
  return (
    <Input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { if (value.trim() !== (lead.notes ?? "")) onSave(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      placeholder="Add follow-up note…"
      className="h-8 text-xs min-w-[160px]"
      data-testid={`input-lead-notes-${lead.id}`}
    />
  );
}

// Super-admin console tab: every "Book a Demo" request from the website, with
// one-tap Call / WhatsApp and a simple New → Contacted → Converted pipeline.
export function DemoLeadsPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const leads = useListDemoLeads();
  const update = useUpdateDemoLead();
  const [filter, setFilter] = useState<"all" | LeadStatus>("all");
  const [search, setSearch] = useState("");

  const save = (lead: DemoLead, data: { status?: LeadStatus; notes?: string | null }) =>
    update.mutate(
      { id: lead.id, data },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData<DemoLead[]>(getListDemoLeadsQueryKey(), (old) =>
            old?.map((l) => (l.id === updated.id ? updated : l)),
          );
          if (data.status) toast({ title: `${lead.name}: ${STATUS[data.status].label}` });
        },
        onError: () => toast({ title: "Could not update lead", variant: "destructive" }),
      },
    );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, new: 0, contacted: 0, converted: 0, not_interested: 0 };
    for (const l of leads.data ?? []) { c.all++; c[l.status]++; }
    return c;
  }, [leads.data]);

  const q = search.trim().toLowerCase();
  const rows = (leads.data ?? []).filter((l) =>
    (filter === "all" || l.status === filter) &&
    (!q || [l.name, l.businessName, l.mobile, l.email, l.businessType, l.message].some((v) => v?.toLowerCase().includes(q))),
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "new", "contacted", "converted", "not_interested"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === s ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}
            data-testid={`filter-leads-${s}`}
          >
            {s === "all" ? "All" : STATUS[s].label} ({counts[s]})
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, mobile, business…" className="pl-8 h-9" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Message</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    {(leads.data ?? []).length === 0 ? "No demo requests yet." : "No leads match this filter."}
                  </TableCell>
                </TableRow>
              ) : rows.map((l) => {
                const wa = whatsappUrl(l.mobile);
                return (
                  <TableRow key={l.id} className={l.status === "new" ? "bg-blue-50/60 dark:bg-blue-950/20" : undefined} data-testid={`row-lead-${l.id}`}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground align-top">{fmtDate(l.createdAt)}</TableCell>
                    <TableCell className="align-top">
                      <div className="font-medium">{l.name}</div>
                      {l.businessName && <div className="text-xs text-muted-foreground">{l.businessName}</div>}
                      {(l.businessType || l.numUsers) && (
                        <div className="text-[11px] text-muted-foreground">
                          {[l.businessType, l.numUsers ? `${l.numUsers} users` : null].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="font-mono text-sm whitespace-nowrap">{l.mobile}</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <a href={`tel:${l.mobile}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted" title="Call">
                          <Phone className="h-3 w-3" /> Call
                        </a>
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-green-600/40 px-1.5 py-0.5 text-[11px] text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950/30" title="WhatsApp">
                            <MessageCircle className="h-3 w-3" /> WhatsApp
                          </a>
                        )}
                      </div>
                      {l.email && (
                        <a href={`mailto:${l.email}`} className="mt-1 flex items-center gap-1 text-xs text-primary hover:underline break-all">
                          <Mail className="h-3 w-3 shrink-0" /> {l.email}
                        </a>
                      )}
                    </TableCell>
                    <TableCell className="align-top max-w-[280px]">
                      {l.message
                        ? <p className="text-xs whitespace-pre-wrap break-words line-clamp-4" title={l.message}>{l.message}</p>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="align-top">
                      <Select value={l.status} onValueChange={(v) => save(l, { status: v as LeadStatus })}>
                        <SelectTrigger className="h-8 w-[140px] text-xs" data-testid={`select-lead-status-${l.id}`}>
                          <SelectValue>
                            <Badge className={`${STATUS[l.status].tone} text-[10px] px-1.5 py-0`}>{STATUS[l.status].label}</Badge>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(STATUS) as LeadStatus[]).map((s) => (
                            <SelectItem key={s} value={s}>{STATUS[s].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="align-top">
                      <NotesCell lead={l} onSave={(notes) => save(l, { notes: notes.trim() || null })} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
