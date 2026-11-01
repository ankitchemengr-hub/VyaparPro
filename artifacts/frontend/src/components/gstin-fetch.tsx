// "Fetch" next to a GSTIN field: looks the GSTIN up (api-server
// lib/gstin-lookup.ts) and hands the registered name, address, state and PIN
// to the form. Without a lookup provider only the state comes back.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

export interface GstinDetails {
  found: boolean; gstin?: string; legalName?: string; tradeName?: string;
  address?: string; city?: string; state?: string; pinCode?: string; status?: string; error?: string;
}

export function GstinFetchButton({ gstin, onFetched, className }: { gstin: string; onFetched: (d: GstinDetails) => void; className?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const val = gstin.trim().toUpperCase();
    if (!val) { toast({ title: "Enter a GSTIN first", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/gstin-lookup?gstin=${encodeURIComponent(val)}`, { credentials: "include" });
      const data: GstinDetails = await res.json();
      if (!data.found) {
        toast({ title: "Not found", description: data.error ?? "GSTIN not found in registry.", variant: "destructive" });
        if (data.state) onFetched(data);
        return;
      }
      onFetched(data);
      toast({
        title: "Details fetched",
        description: `${data.tradeName || data.legalName || data.gstin} — ${data.state ?? ""}${data.status && data.status !== "Active" ? ` (GSTIN ${data.status})` : ""}`,
      });
    } catch {
      toast({ title: "Fetch failed", description: "Could not reach GST registry.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" className={className ?? "h-9 shrink-0"} onClick={run} disabled={busy} title="Fill name and address from the GST registry">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RefreshCw className="h-3.5 w-3.5 mr-1" />Fetch</>}
    </Button>
  );
}
