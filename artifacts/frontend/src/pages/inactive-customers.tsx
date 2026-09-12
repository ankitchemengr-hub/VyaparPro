import React, { useEffect, useState } from "react";
import {
  useListInactiveCustomers,
  useGetCustomerFollowUpSettings,
  useUpdateCustomerFollowUpSettings,
  useListCustomerFollowUps,
  useCreateCustomerFollowUp,
  getGetCustomerFollowUpSettingsQueryKey,
  getListInactiveCustomersQueryKey,
  getListCustomerFollowUpsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { PhoneCall, MessageCircle, Loader2, Settings2, UserX, Save } from "lucide-react";

// Customers with no (non-cancelled) invoice within the configured threshold —
// see /customer-follow-ups/settings. Never-ordered customers sort first, then
// oldest last order, so the coldest relationships surface at the top.

function waLink(mobile: string, name: string) {
  const digits = mobile.replace(/\D/g, "").slice(-10);
  const message = `Hi ${name}, we haven't seen an order from you in a while. Is everything okay? Let us know if you'd like to place one.`;
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
}

export default function InactiveCustomers() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: customers, isLoading } = useListInactiveCustomers();
  const { data: settings } = useGetCustomerFollowUpSettings();
  const updateSettings = useUpdateCustomerFollowUpSettings();

  const [days, setDays] = useState("10");
  useEffect(() => {
    if (settings) setDays(String(settings.days));
  }, [settings]);

  const handleSaveDays = () => {
    const value = Number(days);
    if (!Number.isFinite(value) || value < 1) {
      toast({ title: "Enter a valid number of days", variant: "destructive" });
      return;
    }
    updateSettings.mutate(
      { data: { days: value } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCustomerFollowUpSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListInactiveCustomersQueryKey() });
          toast({ title: "Settings updated" });
        },
        onError: (err: any) => {
          toast({ title: "Failed to update", description: err?.message ?? "Server error", variant: "destructive" });
        },
      },
    );
  };

  const [remarkFor, setRemarkFor] = useState<{ id: number; name: string } | null>(null);

  const rows = customers ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
          <UserX className="w-7 h-7 text-primary" />
          Inactive Customers
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Customers with no invoice recently — reach out and log what happened.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <Settings2 className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground shrink-0">Show customers with no order in the last</span>
          {isAdmin ? (
            <>
              <Input
                type="number"
                min="1"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="w-24"
                data-testid="input-inactive-days-threshold"
              />
              <span className="text-sm text-muted-foreground">days</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveDays}
                disabled={updateSettings.isPending}
                className="sm:ml-auto"
                data-testid="button-save-inactive-days-threshold"
              >
                {updateSettings.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                Save
              </Button>
            </>
          ) : (
            <span className="text-sm font-medium">{settings?.days ?? days} days</span>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg">
          <UserX className="mx-auto h-10 w-10 text-muted-foreground opacity-20 mb-3" />
          <p className="text-sm text-muted-foreground">Every customer has ordered recently — nothing to follow up on.</p>
        </div>
      ) : (
        <div className="rounded-lg border divide-y overflow-hidden">
          {rows.map((c) => (
            <div key={c.customerId} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3" data-testid={`inactive-customer-row-${c.customerId}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                  <span>{c.mobile}</span>
                  <span className="mx-1">·</span>
                  {c.daysSinceLastInvoice == null ? (
                    <Badge variant="outline" className="text-[11px]">Never ordered</Badge>
                  ) : (
                    <span>Last order {c.daysSinceLastInvoice} days ago</span>
                  )}
                </div>
                {c.lastRemark && (
                  <div className="text-xs text-muted-foreground mt-1 italic line-clamp-1">
                    "{c.lastRemark.remark}" — {c.lastRemark.createdByName ?? "someone"}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a href={`tel:${c.mobile}`} data-testid={`link-call-${c.customerId}`}>
                  <Button variant="outline" size="sm">
                    <PhoneCall className="w-3.5 h-3.5 mr-1.5" /> Call
                  </Button>
                </a>
                <a href={waLink(c.mobile, c.name)} target="_blank" rel="noopener noreferrer" data-testid={`link-whatsapp-${c.customerId}`}>
                  <Button variant="outline" size="sm">
                    <MessageCircle className="w-3.5 h-3.5 mr-1.5 text-green-600" /> WhatsApp
                  </Button>
                </a>
                <Button size="sm" onClick={() => setRemarkFor({ id: c.customerId, name: c.name })} data-testid={`button-remark-${c.customerId}`}>
                  Remark
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <RemarkDialog target={remarkFor} onClose={() => setRemarkFor(null)} />
    </div>
  );
}

function RemarkDialog({ target, onClose }: { target: { id: number; name: string } | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [remark, setRemark] = useState("");

  const { data: history, isLoading } = useListCustomerFollowUps(target?.id ?? 0, {
    query: { enabled: !!target, queryKey: getListCustomerFollowUpsQueryKey(target?.id ?? 0) },
  });
  const createFollowUp = useCreateCustomerFollowUp();

  useEffect(() => {
    setRemark("");
  }, [target?.id]);

  const handleSave = () => {
    if (!target || !remark.trim()) return;
    createFollowUp.mutate(
      { id: target.id, data: { remark: remark.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListCustomerFollowUpsQueryKey(target.id) });
          queryClient.invalidateQueries({ queryKey: getListInactiveCustomersQueryKey() });
          toast({ title: "Remark saved" });
          setRemark("");
        },
        onError: (err: any) => {
          toast({ title: "Failed to save", description: err?.message ?? "Server error", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Follow-up — {target?.name}</DialogTitle>
          <DialogDescription>Log what happened when you contacted this customer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <Textarea
              placeholder="e.g. Called, said they'll order next week"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              rows={2}
              data-testid="textarea-followup-remark"
            />
          </div>
          <Button onClick={handleSave} disabled={createFollowUp.isPending || !remark.trim()} className="w-full" data-testid="button-save-followup-remark">
            {createFollowUp.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Remark
          </Button>

          <div className="border-t pt-3 space-y-2 max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="text-center py-4"><Loader2 className="w-4 h-4 animate-spin mx-auto text-muted-foreground" /></div>
            ) : (history ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">No previous remarks.</p>
            ) : (
              (history ?? []).map((h) => (
                <div key={h.id} className="text-sm border rounded-md p-2">
                  <div>{h.remark}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {h.createdByName ?? "someone"} · {new Date(h.createdAt).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
