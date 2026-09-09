// Re-derives the cost snapshot on every saved invoice line in a date range
// from the purchase-bill / BOM cost that was in effect on that invoice's own
// date. Needed when a purchase bill is entered late or back-dated (or a
// recipe's material rates moved after the sale) — the line's original
// snapshot is then stale and its margin wrong. A preview is shown first
// since a wide range can touch many invoices.
import { useState } from "react";
import {
  useGetCogsRecomputePreview,
  useApplyCogsRecompute,
  getGetCogsRecomputePreviewQueryKey,
  getGetBillWiseProfitReportQueryKey,
  getGetProfitLossReportQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Calculator, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const fmt = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function RecomputeCogsDialog({
  open, onOpenChange, from, to,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  from?: string;
  to?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [done, setDone] = useState<{ items: number; invoices: number } | null>(null);

  const params = { from: from || undefined, to: to || undefined };
  const { data: preview, isLoading } = useGetCogsRecomputePreview(params, {
    query: { enabled: open, queryKey: getGetCogsRecomputePreviewQueryKey(params) },
  });
  const apply = useApplyCogsRecompute();

  const handleClose = (v: boolean) => {
    if (!v) setDone(null);
    onOpenChange(v);
  };

  const handleApply = () => {
    apply.mutate({ params }, {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getGetBillWiseProfitReportQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetProfitLossReportQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCogsRecomputePreviewQueryKey() });
        setDone({ items: res.itemsChanged, invoices: res.invoicesTouched });
        toast({
          title: res.itemsChanged === 0
            ? "COGS already up to date"
            : `${res.itemsChanged} line${res.itemsChanged === 1 ? "" : "s"} across ${res.invoicesTouched} invoice${res.invoicesTouched === 1 ? "" : "s"} updated`,
        });
      },
      onError: (err: any) => {
        toast({ title: "Recompute failed", description: err?.message ?? "Please try again", variant: "destructive" });
      },
    });
  };

  const delta = preview ? preview.newCogs - preview.oldCogs : 0;
  const rangeLabel = from || to
    ? `${from || "start"} → ${to || "today"}`
    : "all invoices";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" /> Recompute COGS
          </DialogTitle>
          <DialogDescription>
            Re-derives each saved invoice line's cost from the purchase bill / recipe cost that
            was in effect on that invoice's date ({rangeLabel}). Fixes margins skewed by
            purchase bills entered late or back-dated.
          </DialogDescription>
        </DialogHeader>

        {done != null ? (
          <div className="py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <p className="font-semibold text-lg">
              {done.items === 0
                ? "Nothing to update"
                : `${done.items} line${done.items === 1 ? "" : "s"} across ${done.invoices} invoice${done.invoices === 1 ? "" : "s"} updated`}
            </p>
          </div>
        ) : isLoading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : !preview || preview.itemsChanged === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            Every invoice line in this range already carries the correct cost.
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="text-sm">
              <span className="font-semibold">{preview.itemsChanged}</span> line
              {preview.itemsChanged === 1 ? "" : "s"} across{" "}
              <span className="font-semibold">{preview.invoicesTouched}</span> invoice
              {preview.invoicesTouched === 1 ? "" : "s"} have a stale cost.
            </div>
            <div className="flex items-center justify-center gap-3 rounded-md border p-4">
              <div className="text-center">
                <div className="text-xs uppercase text-muted-foreground">COGS now</div>
                <div className="text-lg font-bold tabular-nums line-through text-muted-foreground">{fmt(preview.oldCogs)}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <div className="text-center">
                <div className="text-xs uppercase text-muted-foreground">COGS after</div>
                <div className="text-lg font-bold tabular-nums">{fmt(preview.newCogs)}</div>
              </div>
            </div>
            <div className={`text-center text-sm font-medium ${delta > 0 ? "text-rose-600" : delta < 0 ? "text-emerald-600" : "text-muted-foreground"}`}>
              {delta === 0 ? "No net change" : `${delta > 0 ? "+" : ""}${fmt(delta)} to COGS (profit ${delta > 0 ? "down" : "up"} by ${fmt(Math.abs(delta))})`}
            </div>
          </div>
        )}

        <DialogFooter>
          {done != null ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={apply.isPending}>Cancel</Button>
              <Button
                onClick={handleApply}
                disabled={apply.isPending || isLoading || !preview || preview.itemsChanged === 0}
                data-testid="button-apply-cogs-recompute"
              >
                {apply.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Recompute {preview?.itemsChanged ?? 0} Line{(preview?.itemsChanged ?? 0) === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
