// "Fetch" next to a GSTIN field: looks the GSTIN up (api-server
// routes/gstin.ts — our own registry cache first, then the paid provider) and
// hands the registered name, address, state and PIN to the form. Without a
// lookup provider only the state comes back.
//
// With `auto`, a complete, valid GSTIN is looked up as soon as it is typed
// (once per GSTIN); pressing Fetch always asks the registry afresh.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw } from "lucide-react";

export interface GstinDetails {
  found: boolean; gstin?: string; legalName?: string; tradeName?: string;
  address?: string; city?: string; state?: string; pinCode?: string; status?: string; error?: string;
}

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// The name to bill under: the shop's trade name, else the registered (legal) name.
export const gstinPartyName = (d: GstinDetails) => (d.tradeName || d.legalName || "").trim();

type Toast = ReturnType<typeof useToast>["toast"];

// Runs one lookup and reports the result in a toast. Returns null when the
// request itself failed.
export async function lookupGstinWithToast(gstin: string, toast: Toast, refresh = false): Promise<GstinDetails | null> {
  const val = gstin.trim().toUpperCase();
  if (!val) { toast({ title: "Enter a GSTIN first", variant: "destructive" }); return null; }
  try {
    const res = await fetch(`/api/gstin-lookup?gstin=${encodeURIComponent(val)}${refresh ? "&refresh=1" : ""}`, { credentials: "include" });
    const data: GstinDetails = await res.json();
    if (!data.found) {
      toast({ title: "Not found", description: data.error ?? "GSTIN not found in registry.", variant: "destructive" });
      return data;
    }
    // The registry's status confirms the GSTIN is live — a cancelled or
    // suspended one should not be billed against.
    const active = !data.status || /^active$/i.test(data.status);
    const name = gstinPartyName(data);
    toast({
      title: active ? "GSTIN verified — Active" : `GSTIN is ${data.status}`,
      description: `${name}${data.legalName && data.legalName !== name ? ` (Legal name: ${data.legalName})` : ""} — ${data.state ?? ""}${active ? "" : ". Check with the party before billing."}`,
      variant: active ? undefined : "destructive",
    });
    return data;
  } catch {
    toast({ title: "Fetch failed", description: "Could not reach GST registry.", variant: "destructive" });
    return null;
  }
}

export function GstinFetchButton({ gstin, onFetched, className, auto = false }: {
  gstin: string; onFetched: (d: GstinDetails) => void; className?: string; auto?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const lastAuto = useRef("");
  const onFetchedRef = useRef(onFetched);
  onFetchedRef.current = onFetched;

  const run = async (val: string, refresh: boolean) => {
    setBusy(true);
    try {
      const data = await lookupGstinWithToast(val, toast, refresh);
      if (data && (data.found || data.state)) onFetchedRef.current(data);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const val = gstin.trim().toUpperCase();
    if (!auto || !GSTIN_RE.test(val) || val === lastAuto.current) return;
    lastAuto.current = val;
    void run(val, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, gstin]);

  return (
    <Button type="button" variant="outline" size="sm" className={className ?? "h-9 shrink-0"} onClick={() => run(gstin, true)} disabled={busy} title="Fill name and address from the GST registry">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RefreshCw className="h-3.5 w-3.5 mr-1" />Fetch</>}
    </Button>
  );
}
