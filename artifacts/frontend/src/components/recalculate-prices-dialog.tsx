// Lets an admin cascade a raw material's rate change (e.g. Refine Oil's
// purchase price edited in Inventory) through every recipe that uses it —
// including recipes-of-recipes — into the finished products' own cost and,
// for Cost + Margin % priced products, their Wholesale/Retail price. A
// preview step is shown first since this can touch 100+ products at once.
import { useState } from "react";
import {
  useGetRecalculatePricePreview,
  useApplyPriceRecalculation,
  getGetRecalculatePricePreviewQueryKey,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function PriceCell({ oldVal, newVal }: { oldVal: number; newVal: number }) {
  const changed = Math.abs(newVal - oldVal) > 0.004;
  if (!changed) return <span className="text-muted-foreground">₹{newVal.toFixed(2)}</span>;
  const up = newVal > oldVal;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-muted-foreground line-through">₹{oldVal.toFixed(2)}</span>
      <ArrowRight className="w-3 h-3 text-muted-foreground" />
      <span className={up ? "text-destructive font-semibold" : "text-green-600 font-semibold"}>₹{newVal.toFixed(2)}</span>
    </span>
  );
}

export function RecalculatePricesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [applied, setApplied] = useState<number | null>(null);

  const { data: changes, isLoading } = useGetRecalculatePricePreview({
    query: { enabled: open, queryKey: getGetRecalculatePricePreviewQueryKey() },
  });
  const apply = useApplyPriceRecalculation();

  const handleClose = (v: boolean) => {
    if (!v) setApplied(null);
    onOpenChange(v);
  };

  const handleApply = () => {
    apply.mutate(undefined, {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecalculatePricePreviewQueryKey() });
        setApplied(res.updated);
        toast({ title: `${res.updated} product price${res.updated === 1 ? "" : "s"} updated` });
      },
      onError: (err: any) => {
        toast({ title: "Recalculation failed", description: err?.message ?? "Please try again", variant: "destructive" });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-primary" /> Recalculate Prices
          </DialogTitle>
          <DialogDescription>
            Rolls up every recipe's current material cost (including recipes-of-recipes) and updates that product's
            own cost, plus its Wholesale/Retail price if it's set to Cost + Margin % pricing.
          </DialogDescription>
        </DialogHeader>

        {applied != null ? (
          <div className="py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <p className="font-semibold text-lg">
              {applied === 0 ? "Nothing to update" : `${applied} product${applied === 1 ? "" : "s"} updated`}
            </p>
          </div>
        ) : isLoading ? (
          <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : !changes || changes.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            All manufactured products' prices already match their current recipe cost.
          </div>
        ) : (
          <div className="flex-1 overflow-auto -mx-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Wholesale</TableHead>
                  <TableHead>Retail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((c) => (
                  <TableRow key={c.id} data-testid={`row-price-recalc-${c.id}`}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.itemCode}</div>
                    </TableCell>
                    <TableCell><PriceCell oldVal={c.oldCost} newVal={c.newCost} /></TableCell>
                    <TableCell><PriceCell oldVal={c.oldWholesalePrice} newVal={c.newWholesalePrice} /></TableCell>
                    <TableCell><PriceCell oldVal={c.oldRetailPrice} newVal={c.newRetailPrice} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          {applied != null ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={apply.isPending}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={apply.isPending || isLoading || !changes || changes.length === 0}
                data-testid="button-apply-price-recalc"
              >
                {apply.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Apply {changes?.length ?? 0} Change{(changes?.length ?? 0) === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
