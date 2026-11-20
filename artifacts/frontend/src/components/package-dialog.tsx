// Platform Console → Subscriptions: a company's package (Silver / Gold /
// Diamond / Platinum) and moving it to another one by hand. The company's
// menu and the server's checks follow straight away (api-server
// lib/plan-features.ts).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

export const PACKAGES = [
  { value: "silver", label: "Silver", what: "Billing, purchases, stock, khatabook, accounts, reports" },
  { value: "gold", label: "Gold", what: "Silver + salesman & commission, rewards, books & audit, workers, supplier settle" },
  { value: "diamond", label: "Diamond", what: "Silver + manufacturing (BOM, assembly, auto manufacturing)" },
  { value: "platinum", label: "Platinum", what: "Everything" },
] as const;

const TONE: Record<string, string> = {
  silver: "bg-slate-200 text-slate-800 hover:bg-slate-200",
  gold: "bg-amber-200 text-amber-900 hover:bg-amber-200",
  diamond: "bg-sky-200 text-sky-900 hover:bg-sky-200",
  platinum: "bg-violet-200 text-violet-900 hover:bg-violet-200",
};

// An old plan (starter / business …) works as Platinum.
export function PackageBadge({ tier }: { tier: string | null | undefined }) {
  const p = PACKAGES.find((x) => x.value === tier);
  return <Badge className={TONE[p?.value ?? "platinum"]}>{p ? p.label : "Platinum (old plan)"}</Badge>;
}

export function PackageDialog({ target, onClose }: {
  target: { id: number; companyName: string; planTier: string | null } | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tier, setTier] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = target?.planTier && PACKAGES.some((p) => p.value === target.planTier) ? target.planTier : "platinum";
  const chosen = tier ?? current;

  const save = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/platform-pricing/subscriptions/${target.id}/package`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tier: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not change the package");
      toast({ title: `${target.companyName} is now on ${PACKAGES.find((p) => p.value === chosen)?.label}` });
      queryClient.invalidateQueries();
      setTier(null);
      onClose();
    } catch (e: any) {
      toast({ title: "Could not change the package", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) { setTier(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change package — {target?.companyName}</DialogTitle>
          <DialogDescription>What this company can see and use. It changes straight away; the end date and amount stay as they are.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {PACKAGES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setTier(p.value)}
              aria-pressed={chosen === p.value}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${chosen === p.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-muted/50"}`}
              data-testid={`package-${p.value}`}
            >
              <div className="font-semibold">{p.label}{p.value === current ? " · current" : ""}</div>
              <div className="text-xs text-muted-foreground">{p.what}</div>
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setTier(null); onClose(); }}>Cancel</Button>
          <Button onClick={save} disabled={saving || chosen === current}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
