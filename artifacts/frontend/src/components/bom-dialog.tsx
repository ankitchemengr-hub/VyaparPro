import { useState, useEffect } from "react";
import {
  useCreateBom,
  useUpdateBom,
  getListBomsQueryKey,
  useCreateProduct,
  getListProductsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2, PackagePlus } from "lucide-react";

export interface BomDraftItem {
  materialProductId: string;
  quantity: string;
  unit: string;
}

export interface BomDialogState {
  finishedProductId: number;
  finishedProductName: string;
  existingBom: any | null;
}

export function BomDialog({
  state,
  allProducts,
  allBoms = [],
  onClose,
}: {
  state: BomDialogState | null;
  allProducts: any[];
  allBoms?: any[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createBom = useCreateBom();
  const updateBom = useUpdateBom();

  const [outputQty, setOutputQty] = useState("1");
  const [items, setItems] = useState<BomDraftItem[]>([
    { materialProductId: "", quantity: "", unit: "QTY" },
  ]);
  const [quickAddIdx, setQuickAddIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.existingBom) {
      setOutputQty(String(state.existingBom.outputQuantity ?? "1"));
      setItems(
        (state.existingBom.items ?? []).map((it: any) => ({
          materialProductId: String(it.materialProductId),
          quantity: String(it.quantity),
          unit: it.unit ?? "QTY",
        })),
      );
    } else {
      setOutputQty("1");
      setItems([{ materialProductId: "", quantity: "", unit: "QTY" }]);
    }
  }, [state]);

  if (!state) return null;

  const candidates = allProducts.filter((p: any) => p.id !== state.finishedProductId);
  const submitting = createBom.isPending || updateBom.isPending;

  const addRow = () => setItems((rows) => [...rows, { materialProductId: "", quantity: "", unit: "QTY" }]);
  const removeRow = (idx: number) => setItems((rows) => rows.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<BomDraftItem>) =>
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const validItems = items.filter(
    (i) => i.materialProductId && Number(i.quantity) > 0,
  );

  const dupSet = new Set<string>();
  const hasDuplicate = validItems.some((i) => {
    if (dupSet.has(i.materialProductId)) return true;
    dupSet.add(i.materialProductId);
    return false;
  });
  const outputQtyNum = Number(outputQty);

  const productById = new Map<number, any>(allProducts.map((p: any) => [p.id, p]));
  const bomByProductId = new Map<number, any>(
    (allBoms ?? []).map((b: any) => [b.finishedProductId, b]),
  );

  // Effective unit cost (rate) of a product. If the product is itself
  // manufactured by us (has its own recipe), roll up the cost of that recipe
  // instead of relying on a manually-entered purchase price; otherwise fall
  // back to its purchase price. Guards against cyclic recipes.
  const unitCost = (productId: number, visiting: Set<number> = new Set()): number => {
    if (!productId || visiting.has(productId)) return 0;
    const subBom = bomByProductId.get(productId);
    if (subBom && Array.isArray(subBom.items) && subBom.items.length > 0) {
      visiting.add(productId);
      const output = Number(subBom.outputQuantity) || 1;
      const batch = subBom.items.reduce(
        (s: number, it: any) =>
          s + Number(it.quantity || 0) * unitCost(Number(it.materialProductId), visiting),
        0,
      );
      visiting.delete(productId);
      return output > 0 ? batch / output : 0;
    }
    const p = productById.get(productId);
    return Number(p?.purchasePrice ?? 0);
  };

  const rowRate = (row: BomDraftItem) => unitCost(Number(row.materialProductId));
  const rowIsManufactured = (row: BomDraftItem) =>
    bomByProductId.has(Number(row.materialProductId));
  const rowCost = (row: BomDraftItem) => {
    const qty = Number(row.quantity);
    const rate = rowRate(row);
    if (!qty || !rate) return 0;
    return qty * rate;
  };
  const totalBatchCost = items.reduce((s, r) => s + rowCost(r), 0);
  const perUnitCost = outputQtyNum > 0 ? totalBatchCost / outputQtyNum : 0;
  const fmt = (n: number) =>
    `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const canSave =
    !submitting &&
    outputQtyNum > 0 &&
    validItems.length > 0 &&
    !hasDuplicate;

  async function handleSave() {
    if (!state) return;
    const payload = {
      outputQuantity: outputQtyNum,
      items: validItems.map((i) => ({
        materialProductId: Number(i.materialProductId),
        quantity: Number(i.quantity),
        unit: i.unit || "QTY",
      })),
    };
    try {
      if (state.existingBom) {
        await updateBom.mutateAsync({ id: state.existingBom.id, data: payload });
        toast({ title: "BOM updated", description: `Recipe for ${state.finishedProductName} saved.` });
      } else {
        await createBom.mutateAsync({
          data: { finishedProductId: state.finishedProductId, ...payload },
        });
        toast({ title: "BOM created", description: `Recipe for ${state.finishedProductName} saved.` });
      }
      await queryClient.invalidateQueries({ queryKey: getListBomsQueryKey() });
      onClose();
    } catch (err: any) {
      toast({
        title: "Could not save BOM",
        description: err?.response?.data?.error ?? err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state.existingBom ? "Edit BOM" : "Add BOM"} — {state.finishedProductName}
          </DialogTitle>
          <DialogDescription>
            Define how many units this recipe produces and the raw materials consumed per batch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px] sm:items-end">
            <div>
              <Label>Finished Product</Label>
              <Input value={state.finishedProductName} disabled className="mt-1.5" />
            </div>
            <div>
              <Label>Output Qty / batch</Label>
              <Input
                type="number"
                min="0"
                step="0.001"
                value={outputQty}
                onChange={(e) => setOutputQty(e.target.value)}
                className="mt-1.5"
                data-testid="input-bom-output-qty"
              />
            </div>
          </div>

          <div className="border rounded-md">
            <div className="hidden gap-2 px-3 py-2 text-xs uppercase text-muted-foreground font-medium border-b bg-muted/50 sm:grid sm:grid-cols-[minmax(0,1fr)_100px_72px_100px_36px]">
              <div>Material</div>
              <div className="text-right">Qty / batch</div>
              <div>Unit</div>
              <div className="text-right">Line Cost</div>
              <div></div>
            </div>
            <div className="divide-y">
              {items.map((row, idx) => (
                <div key={idx} className="flex flex-col gap-2 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_100px_72px_100px_36px] sm:gap-2 sm:py-2 sm:items-center">
                  <div className="flex gap-1 min-w-0">
                    <Select
                      value={row.materialProductId}
                      onValueChange={(v) => {
                        const prod = candidates.find((p: any) => String(p.id) === v);
                        updateRow(idx, {
                          materialProductId: v,
                          unit: row.unit || prod?.unit || "QTY",
                        });
                      }}
                    >
                      <SelectTrigger className="min-w-0" data-testid={`select-material-${idx}`}>
                        <SelectValue placeholder="Select material…" />
                      </SelectTrigger>
                      <SelectContent>
                        {candidates.map((p: any) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}{p.itemCode ? ` · ${p.itemCode}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={() => setQuickAddIdx(idx)}
                      title="Add new raw material"
                      data-testid={`button-quick-add-material-${idx}`}
                    >
                      <PackagePlus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:contents">
                    <div className="sm:contents">
                      <Label className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Qty / batch</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={row.quantity}
                        onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                        className="text-right"
                        data-testid={`input-material-qty-${idx}`}
                      />
                    </div>
                    <div className="sm:contents">
                      <Label className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Unit</Label>
                      <Input
                        value={row.unit}
                        onChange={(e) => updateRow(idx, { unit: e.target.value })}
                        placeholder="QTY"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-2 sm:contents sm:border-t-0 sm:pt-0">
                    <div className="text-sm font-medium tabular-nums sm:text-right" data-testid={`text-line-cost-${idx}`}>
                      <span className="mr-1 text-[11px] text-muted-foreground sm:hidden">Line Cost:</span>
                      {rowCost(row) > 0 ? fmt(rowCost(row)) : <span className="text-muted-foreground">—</span>}
                      {rowRate(row) > 0 && (
                        <div className="text-[10px] font-normal text-muted-foreground">
                          @ {fmt(rowRate(row))}
                          {rowIsManufactured(row) && (
                            <span className="ml-1 text-primary">recipe</span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeRow(idx)}
                      disabled={items.length === 1}
                      title="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 p-2 border-t bg-muted/30">
              <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-material">
                <Plus className="h-3.5 w-3.5 mr-1" />Add material
              </Button>
              <div className="text-right text-sm">
                <div>
                  <span className="text-muted-foreground">Batch Cost: </span>
                  <span className="font-semibold tabular-nums" data-testid="text-total-batch-cost">
                    {fmt(totalBatchCost)}
                  </span>
                </div>
                {outputQtyNum > 0 && totalBatchCost > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Per Unit: <span className="font-medium text-foreground tabular-nums" data-testid="text-per-unit-cost">{fmt(perUnitCost)}</span>
                    {" "}/ {outputQtyNum} unit{outputQtyNum > 1 ? "s" : ""}
                  </div>
                )}
              </div>
            </div>
          </div>

          {hasDuplicate && (
            <p className="text-xs text-destructive">Each material can appear only once.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave} data-testid="button-save-bom">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {state.existingBom ? "Update BOM" : "Create BOM"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <QuickAddMaterialDialog
        open={quickAddIdx !== null}
        onOpenChange={(o) => { if (!o) setQuickAddIdx(null); }}
        onCreated={(p) => {
          if (quickAddIdx !== null) {
            updateRow(quickAddIdx, {
              materialProductId: String(p.id),
              unit: items[quickAddIdx]?.unit || p.unit || "QTY",
            });
          }
          setQuickAddIdx(null);
        }}
      />
    </Dialog>
  );
}

function QuickAddMaterialDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (p: any) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProduct = useCreateProduct();
  const [name, setName] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [unit, setUnit] = useState("QTY");
  const [brand, setBrand] = useState("Raw Material");
  const [group, setGroup] = useState("Raw Materials");
  const [openingStock, setOpeningStock] = useState("0");
  const [purchasePrice, setPurchasePrice] = useState("0");

  useEffect(() => {
    if (open) {
      setName(""); setItemCode(""); setUnit("QTY");
      setBrand("Raw Material"); setGroup("Raw Materials");
      setOpeningStock("0"); setPurchasePrice("0");
    }
  }, [open]);

  const submitting = createProduct.isPending;
  const canSave = !submitting && name.trim().length > 0;

  async function handleCreate() {
    const code = itemCode.trim() || `RAW-${Date.now().toString(36).toUpperCase()}`;
    try {
      const created = await createProduct.mutateAsync({
        data: {
          name: name.trim(),
          itemCode: code,
          group: group.trim() || "Raw Materials",
          brand: brand.trim() || "Raw Material",
          unit: unit.trim() || "QTY",
          purchasePrice: Number(purchasePrice) || 0,
          mrp: 0,
          wholesalePrice: 0,
          retailPrice: 0,
          notForSale: true,
          addForManufacturing: true,
          openingStock: Number(openingStock) || 0,
        } as any,
      });
      await queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title: "Raw material added", description: `${created.name} saved to Inventory (Not for Sale).` });
      onCreated(created);
    } catch (err: any) {
      toast({
        title: "Could not add material",
        description: err?.response?.data?.error ?? err?.message ?? "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Raw Material</DialogTitle>
          <DialogDescription>
            Saved to Inventory as <strong>Not for Sale</strong> &amp; available for Manufacturing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Material Name <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Base Oil SN150"
              className="mt-1.5"
              autoFocus
              data-testid="input-quick-material-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Item Code</Label>
              <Input
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                placeholder="Auto"
                className="mt-1.5"
                data-testid="input-quick-material-code"
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="QTY / LTR / KG"
                className="mt-1.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Group</Label>
              <Input
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Brand</Label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Opening Stock</Label>
              <Input
                type="number"
                min="0"
                step="0.001"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Purchase Price</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="mt-1.5"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!canSave} data-testid="button-create-quick-material">
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add Material
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
