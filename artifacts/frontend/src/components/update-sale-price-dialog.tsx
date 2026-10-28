// Shown right after saving a Purchase when one or more items were bought at
// a different rate than the product's previously-stored purchase price.
// Distinct from RecalculatePricesDialog (which only cascades a raw
// material's cost into BOM-based manufactured products) — this is for the
// purchased item's OWN sale price, whether or not it's used in any recipe.
//
// Every price is editable before saving: the boxes start at the suggested
// price (from the product's own margin %), each shows the price in use today,
// and a product can be switched back to its old prices or left out entirely.
import { useEffect, useMemo, useState } from "react";
import { useUpdateProduct, useListProducts, getListProductsQueryKey, type PurchasePriceChange } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tag, Loader2, CheckCircle2, ArrowRight, RotateCcw, Sparkles, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Field = "nonGstPrice" | "retailPrice" | "wholesalePrice" | "mrp";
type RowEdit = Record<Field, string> & { include: boolean };

const FIELDS: { key: Field; label: string }[] = [
  { key: "retailPrice", label: "Retail" },
  { key: "wholesalePrice", label: "Wholesale" },
  { key: "nonGstPrice", label: "Non-GST" },
  { key: "mrp", label: "MRP" },
];

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function UpdateSalePriceDialog({
  open, onOpenChange, changes,
}: { open: boolean; onOpenChange: (v: boolean) => void; changes: PurchasePriceChange[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateProduct = useUpdateProduct();
  // Same query key the purchase page already loaded — gives today's MRP.
  const { data: products } = useListProducts({});
  const mrpById = useMemo(() => {
    const m = new Map<number, number>();
    (products ?? []).forEach((p: any) => m.set(p.id, Number(p.mrp ?? 0)));
    return m;
  }, [products]);

  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const current = (c: PurchasePriceChange): Record<Field, number> => ({
    nonGstPrice: c.currentNonGstPrice,
    retailPrice: c.currentRetailPrice,
    wholesalePrice: c.currentWholesalePrice,
    mrp: mrpById.get(c.productId) ?? 0,
  });
  const suggested = (c: PurchasePriceChange): Record<Field, number> => ({
    nonGstPrice: c.suggestedNonGstPrice,
    retailPrice: c.suggestedRetailPrice,
    wholesalePrice: c.suggestedWholesalePrice,
    mrp: mrpById.get(c.productId) ?? 0, // MRP is printed on the pack — not derived
  });
  const toEdit = (v: Record<Field, number>, include = true): RowEdit => ({
    nonGstPrice: String(v.nonGstPrice), retailPrice: String(v.retailPrice),
    wholesalePrice: String(v.wholesalePrice), mrp: String(v.mrp), include,
  });

  // Re-seed with the suggested prices whenever a fresh set of changes
  // arrives (each time the dialog opens after a save).
  useEffect(() => {
    if (!open) return;
    const next: Record<number, RowEdit> = {};
    for (const c of changes) next[c.productId] = toEdit(suggested(c));
    setEdits(next);
    setSavedCount(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, changes]);

  // MRP arrives with the product list — fill it in once known, unless typed.
  useEffect(() => {
    if (!open || mrpById.size === 0) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const c of changes) {
        const row = next[c.productId];
        if (row && (row.mrp === "0" || row.mrp === "")) next[c.productId] = { ...row, mrp: String(mrpById.get(c.productId) ?? 0) };
      }
      return next;
    });
  }, [open, changes, mrpById]);

  const setField = (productId: number, field: Field, value: string) =>
    setEdits((prev) => ({ ...prev, [productId]: { ...prev[productId], [field]: value } }));
  const setRow = (productId: number, row: RowEdit) => setEdits((prev) => ({ ...prev, [productId]: row }));

  const included = changes.filter((c) => edits[c.productId]?.include !== false);

  const handleClose = (v: boolean) => {
    if (!v) setSavedCount(null);
    onOpenChange(v);
  };

  const handleSave = async () => {
    for (const c of included) {
      const e = edits[c.productId];
      if (FIELDS.some(({ key }) => e[key].trim() === "" || Number(e[key]) < 0 || Number.isNaN(Number(e[key])))) {
        toast({ title: "Check the prices", description: `${c.name}: every price must be a number (0 or more).`, variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    try {
      await Promise.all(included.map((c) => {
        const e = edits[c.productId];
        const mrpNow = mrpById.get(c.productId) ?? 0;
        return updateProduct.mutateAsync({
          id: c.productId,
          data: {
            nonGstPrice: Number(e.nonGstPrice),
            retailPrice: Number(e.retailPrice),
            wholesalePrice: Number(e.wholesalePrice),
            ...(Number(e.mrp) !== mrpNow ? { mrp: Number(e.mrp) } : {}),
          },
        });
      }));
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      setSavedCount(included.length);
      toast({ title: `Sale price updated for ${included.length} product${included.length === 1 ? "" : "s"}` });
    } catch (err: any) {
      toast({ title: "Failed to update sale price", description: err?.message ?? "Please try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" /> Update Sale Price?
          </DialogTitle>
          <DialogDescription>
            The purchase rate changed for {changes.length} item{changes.length === 1 ? "" : "s"}. The boxes show a
            suggested new price — <b>type your own rate in any box</b>, go back to the old rates, or leave a product out.
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
          <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-3">
            {changes.map((c) => {
              const e = edits[c.productId];
              if (!e) return null;
              const now = current(c);
              const sug = suggested(c);
              return (
                <div
                  key={c.productId}
                  className={`rounded-lg border p-3 space-y-3 ${e.include ? "" : "opacity-50"}`}
                  data-testid={`row-sale-price-${c.productId}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium break-words">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.itemCode && <span className="font-mono mr-2">{c.itemCode}</span>}
                        Purchase rate{" "}
                        <span className="line-through">{fmt(c.oldPurchasePrice)}</span>
                        <ArrowRight className="w-3 h-3 inline mx-1" />
                        <span className="font-semibold text-foreground">{fmt(c.newPurchasePrice)}</span>
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={e.include}
                        onChange={(ev) => setRow(c.productId, { ...e, include: ev.target.checked })}
                        data-testid={`check-sale-price-${c.productId}`}
                      />
                      Update this product
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {FIELDS.map(({ key, label }) => (
                      <div key={key} className="space-y-1">
                        <Label className="text-xs flex items-center gap-1">
                          <Pencil className="w-3 h-3 text-muted-foreground" /> {label} (₹)
                        </Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          className="h-10 text-right text-base sm:text-sm"
                          value={e[key]}
                          disabled={!e.include}
                          onFocus={(ev) => ev.target.select()}
                          onChange={(ev) => setField(c.productId, key, ev.target.value)}
                          data-testid={`input-sale-price-${key}-${c.productId}`}
                        />
                        <div className="text-[11px] text-muted-foreground">Now {fmt(now[key])}</div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button" variant="outline" size="sm" className="h-8"
                      disabled={!e.include}
                      onClick={() => setRow(c.productId, toEdit(sug, e.include))}
                      data-testid={`button-use-suggested-${c.productId}`}
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-1" /> Use suggested
                    </Button>
                    <Button
                      type="button" variant="outline" size="sm" className="h-8"
                      disabled={!e.include}
                      onClick={() => setRow(c.productId, toEdit(now, e.include))}
                      data-testid={`button-keep-old-${c.productId}`}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Keep old rates
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {savedCount != null ? (
            <Button onClick={() => handleClose(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={saving}>
                Skip
              </Button>
              <Button onClick={handleSave} disabled={saving || included.length === 0} data-testid="button-save-sale-prices">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save {included.length} Sale Price{included.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
