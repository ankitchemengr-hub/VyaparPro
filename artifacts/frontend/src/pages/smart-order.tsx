import React, { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListSmartOrderSuggestions,
  useGetSmartOrderSettings,
  useUpdateSmartOrderSettings,
  getGetSmartOrderSettingsQueryKey,
  getListSmartOrderSuggestionsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Sparkles, Settings2, TrendingUp, Package, ShoppingCart, Loader2 } from "lucide-react";

// Suggested reorder qty for fast-moving products/raw materials, boosted
// by reinvesting `reinvestPct` of the profit margin earned in the lookback
// window. Only items actually running low relative to their sales/consumption
// pace show up here — see the `velocityQty > 0` filter on the backend.
// Selecting one hands the product + qty straight to New Purchase.

const PREFILL_KEY = "smart_order_prefill";

export default function SmartOrder() {
  const [, setLocation] = useLocation();
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const { data: suggestions, isLoading } = useListSmartOrderSuggestions();
  const { data: settings } = useGetSmartOrderSettings();
  const updateSettings = useUpdateSmartOrderSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reinvestPct, setReinvestPct] = useState("50");
  const [coverageDays, setCoverageDays] = useState("30");
  const [lookbackDays, setLookbackDays] = useState("30");

  useEffect(() => {
    if (!settings) return;
    setReinvestPct(String(settings.reinvestPct));
    setCoverageDays(String(settings.coverageDays));
    setLookbackDays(String(settings.lookbackDays));
  }, [settings]);

  const handleSaveSettings = () => {
    updateSettings.mutate(
      {
        data: {
          reinvestPct: Number(reinvestPct) || 0,
          coverageDays: Number(coverageDays) || 0,
          lookbackDays: Number(lookbackDays) || 0,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSmartOrderSettingsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListSmartOrderSuggestionsQueryKey() });
          toast({ title: "Smart Order settings updated" });
          setSettingsOpen(false);
        },
        onError: (err: any) => {
          toast({ title: "Failed to update settings", description: err?.message ?? "Server error", variant: "destructive" });
        },
      },
    );
  };

  const handleCreatePurchase = (productId: number, qty: number) => {
    try {
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ productId, qty }));
    } catch {
      /* ignore storage failures */
    }
    setLocation("/purchases");
  };

  const rows = suggestions ?? [];
  const productRows = rows.filter((r) => r.category === "product");
  const rawMaterialRows = rows.filter((r) => r.category === "raw_material");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-primary" />
            Smart Order
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Items actually running low, ranked by how fast they sell (or get consumed in Manufacturing), with a suggested reorder qty.
          </p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} data-testid="button-smart-order-settings">
            <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Tune
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg">
          <TrendingUp className="mx-auto h-10 w-10 text-muted-foreground opacity-20 mb-3" />
          <p className="text-sm text-muted-foreground">
            Nothing is running low right now — everything is stocked ahead of its sales/consumption pace.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {productRows.length > 0 && (
            <SmartOrderSection
              title="Fast-Moving Products"
              icon={<ShoppingCart className="w-4 h-4 text-primary" />}
              rows={productRows}
              onCreatePurchase={handleCreatePurchase}
            />
          )}
          {rawMaterialRows.length > 0 && (
            <SmartOrderSection
              title="Fast-Moving Raw Materials"
              icon={<Package className="w-4 h-4 text-primary" />}
              rows={rawMaterialRows}
              onCreatePurchase={handleCreatePurchase}
            />
          )}
        </div>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings2 className="w-4 h-4" /> Smart Order Settings</DialogTitle>
            <DialogDescription>Tune how suggestions are calculated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Reinvest % of Margin</Label>
              <Input type="number" min="0" max="100" value={reinvestPct} onChange={(e) => setReinvestPct(e.target.value)} data-testid="input-reinvest-pct" />
              <p className="text-[11px] text-muted-foreground">
                e.g. buy at ₹100, sell at ₹120 → ₹20 margin. At 50%, ₹10 per unit sold becomes extra reorder budget for that item.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Coverage Days</Label>
              <Input type="number" min="1" value={coverageDays} onChange={(e) => setCoverageDays(e.target.value)} data-testid="input-coverage-days" />
              <p className="text-[11px] text-muted-foreground">Target days of stock to keep on hand, based on current sales/consumption pace.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Lookback Days</Label>
              <Input type="number" min="1" value={lookbackDays} onChange={(e) => setLookbackDays(e.target.value)} data-testid="input-lookback-days" />
              <p className="text-[11px] text-muted-foreground">History window used to measure how fast an item is moving.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsOpen(false)} disabled={updateSettings.isPending}>Cancel</Button>
            <Button onClick={handleSaveSettings} disabled={updateSettings.isPending} data-testid="button-save-smart-order-settings">
              {updateSettings.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SmartOrderSection({
  title, icon, rows, onCreatePurchase,
}: {
  title: string;
  icon: React.ReactNode;
  rows: any[];
  onCreatePurchase: (productId: number, qty: number) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">{icon} {title}</h3>
      <div className="rounded-lg border divide-y overflow-hidden">
        {rows.map((r) => (
          <div key={r.productId} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3" data-testid={`smart-order-row-${r.productId}`}>
            <div className="w-10 h-10 rounded-md border bg-muted/30 shrink-0 overflow-hidden flex items-center justify-center">
              {r.imageUrl ? (
                <img src={r.imageUrl} alt={r.productName} className="w-full h-full object-cover" />
              ) : (
                <Package className="w-4 h-4 text-muted-foreground/40" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium line-clamp-1">{r.productName}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                {r.itemCode && <span className="font-mono">{r.itemCode}</span>}
                <span className="mx-1">·</span>
                {r.avgDailyRate.toLocaleString(undefined, { maximumFractionDigits: 2 })} {r.unit}/day
                <span className="mx-1">·</span>
                Stock: {r.currentStock.toLocaleString()} {r.unit}
                {r.reinvestQty > 0 && (
                  <>
                    <span className="mx-1">·</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      +{r.reinvestQty.toLocaleString(undefined, { maximumFractionDigits: 1 })} from ₹{r.totalMargin.toLocaleString()} margin
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <Badge variant="outline" className="font-mono text-sm" data-testid={`text-suggested-qty-${r.productId}`}>
                Order {r.suggestedQty.toLocaleString()} {r.unit}
              </Badge>
              <Button
                size="sm"
                disabled={r.suggestedQty <= 0}
                onClick={() => onCreatePurchase(r.productId, r.suggestedQty)}
                data-testid={`button-create-purchase-${r.productId}`}
              >
                <ShoppingCart className="w-3.5 h-3.5 mr-1.5" /> Create Purchase
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
