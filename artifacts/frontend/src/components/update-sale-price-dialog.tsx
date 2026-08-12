// Shown right after saving a Purchase when one or more items were bought at
// a different rate than the product's previously-stored purchase price.
// Distinct from RecalculatePricesDialog (which only cascades a raw
// material's cost into BOM-based manufactured products) — this is for the
// purchased item's OWN sale price, whether or not it's used in any recipe.
import { useEffect, useState } from "react";
import { useUpdateProduct, type PurchasePriceChange } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListProductsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tag, Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type RowEdit = { nonGstPrice: string; retailPrice: string; wholesalePrice: string };

export function UpdateSalePriceDialog({
  open, onOpenChange, changes,
}: { open: boolean; onOpenChange: (v: boolean) => void; changes: PurchasePriceChange[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateProduct = useUpdateProduct();
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // Re-seed editable fields with the suggested prices whenever a fresh set
  // of changes arrives (i.e. each time the dialog is opened for a new save).
  useEffect(() => {
    if (!open) return;
    const next: Record<number, RowEdit> = {};
    for (const c of changes) {
      next[c.productId] = {
        nonGstPrice: String(c.suggestedNonGstPrice),
        retailPrice: String(c.suggestedRetailPrice),
        wholesalePrice: String(c.suggestedWholesalePrice),
      };
    }
    setEdits(next);
    setSavedCount(null);
  }, [open, changes]);

  const setField = (productId: number, field: keyof RowEdit, value: string) => {
    setEdits((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  };

  const handleClose = (v: boolean) => {
    if (!v) setSavedCount(null);
    onOpenChange(v);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(changes.map((c) => {
        const edit = edits[c.productId];
        if (!edit) return Promise.resolve();
        return updateProduct.mutateAsync({
          id: c.productId,
          data: {
            nonGstPrice: Number(edit.nonGstPrice),
            retailPrice: Number(edit.retailPrice),
            wholesalePrice: Number(edit.wholesalePrice),
          },
        });
      }));
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      setSavedCount(changes.length);
      toast({ title: `Sale price updated for ${changes.length} product${changes.length === 1 ? "" : "s"}` });
    } catch (err: any) {
      toast({ title: "Failed to update sale price", description: err?.message ?? "Please try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Update Sale Price?
          </DialogTitle>
          <DialogDescription>
            The purchase rate changed for {changes.length} item{changes.length === 1 ? "" : "s"} on this bill.
            Suggested new sale prices below use each product's own margin % — edit any value before saving, or skip.
          </DialogDescription>
        </DialogHeader>

        {savedCount != null ? (
          <div className="py-10 flex flex-col items-center gap-3 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
            <p className="font-semibold text-lg">
              Sale price updated for {savedCount} product{savedCount === 1 ? "" : "s"}
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto -mx-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Purchase Rate</TableHead>
                  <TableHead className="w-24">Non-GST</TableHead>
                  <TableHead className="w-24">Retail</TableHead>
                  <TableHead className="w-24">Wholesale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changes.map((c) => {
                  const edit = edits[c.productId];
                  return (
                    <TableRow key={c.productId} data-testid={`row-sale-price-${c.productId}`}>
                      <TableCell>
                        <div className="font-medium">{c.name}</div>
                        {c.itemCode && <div className="text-xs text-muted-foreground font-mono">{c.itemCode}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        <span className="text-muted-foreground line-through">₹{c.oldPurchasePrice.toFixed(2)}</span>
                        <ArrowRight className="w-3 h-3 inline mx-1 text-muted-foreground" />
                        <span className="font-semibold">₹{c.newPurchasePrice.toFixed(2)}</span>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min={0} className="h-8 w-20 text-right"
                          value={edit?.nonGstPrice ?? ""}
                          onChange={(e) => setField(c.productId, "nonGstPrice", e.target.value)}
                          data-testid={`input-sale-price-nongst-${c.productId}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min={0} className="h-8 w-20 text-right"
                          value={edit?.retailPrice ?? ""}
                          onChange={(e) => setField(c.productId, "retailPrice", e.target.value)}
                          data-testid={`input-sale-price-retail-${c.productId}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number" min={0} className="h-8 w-20 text-right"
                          value={edit?.wholesalePrice ?? ""}
                          onChange={(e) => setField(c.productId, "wholesalePrice", e.target.value)}
                          data-testid={`input-sale-price-wholesale-${c.productId}`}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DialogFooter>
          {savedCount != null ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
                Skip
              </Button>
              <Button onClick={handleSave} disabled={saving} data-testid="button-save-sale-prices">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Sale Price{changes.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
