import { useState } from "react";
import { useLocation } from "wouter";
import { useListProducts } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Package,
  ArrowUp,
  ArrowDown,
  Minus,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

interface AdjustmentPreview {
  productId: number;
  productName: string;
  itemCode: string;
  systemStock: number;
  physicalCount: number;
  difference: number;
  reason: string;
}

function DiffBadge({ diff }: { diff: number }) {
  if (diff === 0)
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Minus className="w-3 h-3" />
        No change
      </Badge>
    );
  if (diff > 0)
    return (
      <Badge className="gap-1 bg-green-600 text-white border-transparent">
        <ArrowUp className="w-3 h-3" />+{diff} added
      </Badge>
    );
  return (
    <Badge variant="destructive" className="gap-1">
      <ArrowDown className="w-3 h-3" />
      {diff} reduced
    </Badge>
  );
}

export default function StockAdjustment() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [physicalCount, setPhysicalCount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [preview, setPreview] = useState<AdjustmentPreview | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: products, isLoading } = useListProducts({});

  if (user?.role !== "admin") {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <AlertTriangle className="w-10 h-10" />
        <p className="font-medium">Admin access required.</p>
        <Button variant="outline" onClick={() => setLocation("/")}>Go to Dashboard</Button>
      </div>
    );
  }

  const filtered = (products ?? []).filter((p: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.name?.toLowerCase().includes(q) ||
      p.itemCode?.toLowerCase().includes(q) ||
      p.brand?.toLowerCase().includes(q) ||
      p.group?.toLowerCase().includes(q)
    );
  });

  const systemStock = Number(selectedProduct?.currentStock ?? 0);
  const countVal = physicalCount === "" ? null : Number(physicalCount);
  const difference = countVal !== null ? countVal - systemStock : null;
  const canPreview =
    selectedProduct &&
    countVal !== null &&
    Number.isFinite(countVal) &&
    countVal >= 0 &&
    reason.trim().length > 0;

  const handlePreview = () => {
    if (!canPreview || countVal === null) return;
    setPreview({
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      itemCode: selectedProduct.itemCode ?? "",
      systemStock,
      physicalCount: countVal,
      difference: countVal - systemStock,
      reason: reason.trim(),
    });
    setShowConfirm(true);
  };

  function handleConfirm() {
    if (!preview) return;
    setIsSubmitting(true);
    fetch("/api/products/stock-reconciliation", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{
          productId: preview.productId,
          countedStock: preview.physicalCount,
          reason: preview.reason,
        }],
      }),
    })
      .then(function(res) {
        if (!res.ok) throw new Error("Server error");
        toast({
          title: "Stock updated",
          description: preview.productName + " adjusted from " + preview.systemStock + " → " + preview.physicalCount + ".",
        });
        queryClient.invalidateQueries({ queryKey: ["products"] });
        setShowConfirm(false);
        setSelectedProduct(null);
        setPhysicalCount("");
        setReason("");
        setSearch("");
      })
      .catch(function(err) {
        toast({
          title: "Adjustment failed",
          description: err?.message ?? "Please try again.",
          variant: "destructive",
        });
      })
      .finally(function() {
        setIsSubmitting(false);
      });
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ClipboardCheck className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Adjustment</h1>
          <p className="text-sm text-muted-foreground">
            Enter the physical count — the system calculates and applies the difference.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        {/* Product Picker */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, item code, brand…"
              className="pl-9"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedProduct(null);
                setPhysicalCount("");
                setReason("");
              }}
            />
          </div>
          <div className="border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-sm text-muted-foreground">No products found</div>
            ) : (
              <div className="divide-y max-h-[420px] overflow-y-auto">
                {filtered.map((p: any) => {
                  const isSelected = selectedProduct?.id === p.id;
                  const stock = Number(p.currentStock ?? 0);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setSelectedProduct(p);
                        setPhysicalCount("");
                        setReason("");
                      }}
                      className={
                        "w-full text-left px-4 py-3 flex items-center gap-3 transition-colors border-l-2 " +
                        (isSelected ? "bg-primary/5 border-primary" : "hover:bg-muted/40 border-transparent")
                      }
                    >
                      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} className="object-contain w-full h-full" />
                        ) : (
                          <Package className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{p.itemCode}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold tabular-nums">{stock}</div>
                        <div className="text-[10px] text-muted-foreground">in system</div>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Adjustment Form */}
        <div>
          {!selectedProduct ? (
            <div className="border border-dashed rounded-lg flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2 h-full">
              <ClipboardCheck className="w-8 h-8 opacity-20" />
              <p>Select a product to adjust</p>
            </div>
          ) : (
            <div className="border rounded-lg p-5 space-y-5 sticky top-4">
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Selected Product</div>
                <div className="font-bold text-base leading-tight">{selectedProduct.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{selectedProduct.itemCode}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/40 px-3 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">System Stock</div>
                  <div className="text-2xl font-black tabular-nums">{systemStock}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{selectedProduct.unit ?? "units"}</div>
                </div>
                <div className={
                  "rounded-lg px-3 py-3 text-center border-2 transition-colors " +
                  (difference === null || difference === 0
                    ? "bg-muted/20 border-border"
                    : difference > 0
                    ? "bg-green-50 border-green-300"
                    : "bg-red-50 border-red-300")
                }>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Physical Count</div>
                  <div className={
                    "text-2xl font-black tabular-nums " +
                    (difference === null ? "text-muted-foreground"
                      : difference > 0 ? "text-green-700"
                      : difference < 0 ? "text-red-700" : "")
                  }>
                    {countVal !== null ? countVal : "—"}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{selectedProduct.unit ?? "units"}</div>
                </div>
              </div>

              {difference !== null && (
                <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
                  <span className="text-xs text-muted-foreground">Difference</span>
                  <DiffBadge diff={difference} />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="physical-count">Physical Count *</Label>
                <Input
                  id="physical-count"
                  type="number"
                  min="0"
                  step="1"
                  placeholder={"Current: " + systemStock}
                  value={physicalCount}
                  onChange={(e) => setPhysicalCount(e.target.value)}
                  className="text-lg font-semibold tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Reason *</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a reason…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Physical count correction">Physical count correction</SelectItem>
                    <SelectItem value="Damaged goods">Damaged goods</SelectItem>
                    <SelectItem value="Theft / shrinkage">Theft / shrinkage</SelectItem>
                    <SelectItem value="Supplier short delivery">Supplier short delivery</SelectItem>
                    <SelectItem value="Data entry error correction">Data entry error correction</SelectItem>
                    <SelectItem value="Expired / disposed stock">Expired / disposed stock</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button className="w-full" disabled={!canPreview} onClick={handlePreview}>
                <ClipboardCheck className="w-4 h-4 mr-2" />
                Review Adjustment
              </Button>

              {difference === 0 && countVal !== null && (
                <p className="text-xs text-center text-muted-foreground">
                  Physical count matches system — no adjustment needed.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={function(o) { if (!isSubmitting) setShowConfirm(o); }}>
        <DialogContent className="max-w-sm mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {!preview ? null : preview.difference === 0
                ? <CheckCircle2 className="w-5 h-5 text-muted-foreground" />
                : preview.difference > 0
                ? <ArrowUp className="w-5 h-5 text-green-600" />
                : <ArrowDown className="w-5 h-5 text-destructive" />}
              Confirm Adjustment
            </DialogTitle>
          </DialogHeader>

          {preview && (
            <div className="space-y-4 pt-1">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3 text-sm">
                <div className="font-semibold leading-tight">{preview.productName}</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">System</div>
                    <div className="text-xl font-black tabular-nums">{preview.systemStock}</div>
                  </div>
                  <div className="flex items-center justify-center text-muted-foreground">→</div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Physical</div>
                    <div className={
                      "text-xl font-black tabular-nums " +
                      (preview.difference > 0 ? "text-green-600"
                        : preview.difference < 0 ? "text-destructive" : "")
                    }>{preview.physicalCount}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-muted-foreground">Change</span>
                  <DiffBadge diff={preview.difference} />
                </div>
                <div className="flex items-start justify-between border-t pt-2 gap-2">
                  <span className="text-muted-foreground shrink-0">Reason</span>
                  <span className="text-right font-medium">{preview.reason}</span>
                </div>
              </div>

              {preview.difference !== 0 && (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  This will permanently update stock. This action cannot be undone.
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowConfirm(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleConfirm}
                  disabled={isSubmitting || preview.difference === 0}
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
