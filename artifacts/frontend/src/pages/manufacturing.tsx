import React, { useState, useMemo, useEffect } from "react";
import {
  useListBoms,
  useListWorkloadCards,
  useAssembleItem,
  useListProducts,
  useGetLowStockAlerts,
  useCreateWorkloadCard,
  useUpdateWorkloadCard,
  useCreateBom,
  useUpdateBom,
  useListCustomerOrders,
  useUpdateCustomerOrderStatus,
  useListMaterialTransfers,
  useCreateMaterialTransfer,
  useDeleteMaterialTransfer,
  getListWorkloadCardsQueryKey,
  getListProductsQueryKey,
  getGetLowStockAlertsQueryKey,
  getListBomsQueryKey,
  getListCustomerOrdersQueryKey,
  getListMaterialTransfersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Factory,
  Loader2,
  PackageCheck,
  AlertCircle,
  CheckCircle2,
  Package,
  Search,
  X,
  ListChecks,
  AlertTriangle,
  Plus,
  Trash2,
  Pencil,
  Truck,
  Inbox,
  ArrowLeftRight,
  Printer,
} from "lucide-react";
import { BomDialog } from "@/components/bom-dialog";

export default function Manufacturing() {
  // Lifted state so the Workload tab can deep-link into Assemble Item with a
  // specific BOM pre-selected.
  const [tab, setTab] = useState("workload");
  const [pendingAssembleBomId, setPendingAssembleBomId] = useState<string>("");

  const startAssemble = (bomId: number) => {
    setPendingAssembleBomId(String(bomId));
    setTab("assemble");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Manufacturing</h1>
        <p className="text-muted-foreground mt-2">
          Check what needs to be produced and assemble finished products from
          raw materials.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          <TabsTrigger value="workload" data-testid="tab-workload">
            Workload
          </TabsTrigger>
          <TabsTrigger value="assemble" data-testid="tab-assemble">
            Assemble Item
          </TabsTrigger>
          <TabsTrigger value="dispatch" data-testid="tab-dispatch">
            Ready For Dispatch
          </TabsTrigger>
          <TabsTrigger value="transfer" data-testid="tab-transfer">
            Material Transfer
          </TabsTrigger>
          <TabsTrigger value="report" data-testid="tab-report">
            Report
          </TabsTrigger>
        </TabsList>

        <TabsContent value="workload" className="mt-6">
          <WorkloadTab onStartAssemble={startAssemble} />
        </TabsContent>

        <TabsContent value="assemble" className="mt-6">
          <AssembleTab
            initialBomId={pendingAssembleBomId}
            onConsumeInitialBomId={() => setPendingAssembleBomId("")}
          />
        </TabsContent>

        <TabsContent value="dispatch" className="mt-6">
          <DispatchTab />
        </TabsContent>

        <TabsContent value="transfer" className="mt-6">
          <MaterialTransferTab />
        </TabsContent>

        <TabsContent value="report" className="mt-6">
          <ReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// --------------------------- WORKLOAD TAB ---------------------------
// Each low-stock product gets a status: Pending → Processing → Done.
//  • Pending  : no active card OR a card exists in 'pending' state
//  • Processing: card exists in 'processing' state (work has started)
//  • Done     : worker confirms produced qty; server runs the BOM recipe in a
//                SERIALIZABLE txn (consume raw, produce finished) so the
//                item drops off this list automatically once stock is restored.

function WorkloadTab({
  onStartAssemble,
}: {
  onStartAssemble: (bomId: number) => void;
}) {
  const { data: alerts, isLoading } = useGetLowStockAlerts();
  const { data: boms } = useListBoms();
  const { data: products } = useListProducts();
  const { data: workloadCards } = useListWorkloadCards();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const createCard = useCreateWorkloadCard();
  const updateCard = useUpdateWorkloadCard();

  // BOM dialog state (admin only)
  const [bomDialog, setBomDialog] = useState<{
    finishedProductId: number;
    finishedProductName: string;
    existingBom: any | null;
  } | null>(null);

  // Dialog state for Mark Done qty prompt
  const [doneDialog, setDoneDialog] = useState<{
    productId: number;
    productName: string;
    unit: string;
    suggestedQty: number;
    cardId: number | null; // null means we need to create the card first
  } | null>(null);
  // Per-product production popup (enter qty, then start or complete)
  const [produceDialog, setProduceDialog] = useState<{
    productId: number;
    productName: string;
    unit: string;
    suggestedQty: number;
    cardId: number | null;
    status: "pending" | "processing";
  } | null>(null);
  const [busyProductId, setBusyProductId] = useState<number | null>(null);

  const bomByFinishedProduct = useMemo(() => {
    const m = new Map<number, any>();
    (boms ?? []).forEach((b: any) => m.set(b.finishedProductId, b));
    return m;
  }, [boms]);

  const productById = useMemo(() => {
    const m = new Map<number, any>();
    (products ?? []).forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

  // Only surface products explicitly flagged "Add for Manufacturing" in
  // Inventory — other low-stock items are restocked via Purchases, not
  // produced here.
  const manufacturingAlerts = useMemo(() => {
    return (alerts ?? []).filter((a: any) => productById.get(a.id)?.addForManufacturing);
  }, [alerts, productById]);

  // Most recent active (pending/processing) card per product. If a worker
  // accidentally created multiple, we honour the latest one.
  const activeCardByProduct = useMemo(() => {
    const m = new Map<number, any>();
    (workloadCards ?? [])
      .filter((c: any) => c.status === "pending" || c.status === "processing")
      .forEach((c: any) => {
        const prev = m.get(c.productId);
        if (!prev || new Date(c.createdAt) > new Date(prev.createdAt)) {
          m.set(c.productId, c);
        }
      });
    return m;
  }, [workloadCards]);

  const refreshLists = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getListWorkloadCardsQueryKey(),
      }),
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getGetLowStockAlertsQueryKey(),
      }),
    ]);
  };

  // Ensure a workload card exists for the product and is in the desired
  // status. Used by both "Start Processing" and "Mark Done" flows.
  const ensureCard = async (
    productId: number,
    suggestedQty: number,
  ): Promise<number> => {
    const existing = activeCardByProduct.get(productId);
    if (existing) return existing.id;
    const created = await createCard.mutateAsync({
      data: {
        productId,
        targetQty: suggestedQty,
        orderType: "low_stock_alert",
      },
    });
    return (created as any).id;
  };

  const handleSetStatus = async (
    productId: number,
    newStatus: "pending" | "processing",
    suggestedQty: number,
  ) => {
    setBusyProductId(productId);
    try {
      const cardId = await ensureCard(productId, suggestedQty);
      await updateCard.mutateAsync({ id: cardId, data: { status: newStatus } });
      await refreshLists();
      toast({ title: `Marked as ${newStatus}` });
    } catch (err: any) {
      toast({
        title: "Failed to update",
        description: err?.message ?? "Server error",
        variant: "destructive",
      });
    } finally {
      setBusyProductId(null);
    }
  };

  const handleOpenDone = (
    productId: number,
    productName: string,
    unit: string,
    suggestedQty: number,
  ) => {
    const card = activeCardByProduct.get(productId);
    setDoneDialog({
      productId,
      productName,
      unit,
      suggestedQty: card ? Number(card.targetQty) : suggestedQty,
      cardId: card?.id ?? null,
    });
  };

  const handleConfirmDone = async (finalQty: number) => {
    if (!doneDialog) return;
    setBusyProductId(doneDialog.productId);
    try {
      // Ensure a card exists with the entered qty as its baseline target —
      // this also covers the "skip processing, go straight to done" path.
      const cardId =
        doneDialog.cardId ?? (await ensureCard(doneDialog.productId, finalQty));
      await updateCard.mutateAsync({
        id: cardId,
        data: { status: "done", targetQty: finalQty },
      });
      await refreshLists();
      toast({
        title: "Production complete",
        description: `Added ${finalQty} ${doneDialog.unit} of ${doneDialog.productName}. Raw materials debited.`,
      });
      setDoneDialog(null);
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({
        title: "Failed to complete",
        description: desc,
        variant: "destructive",
      });
    } finally {
      setBusyProductId(null);
    }
  };

  const handleOpenProduce = (
    productId: number,
    productName: string,
    unit: string,
    suggestedQty: number,
  ) => {
    const card = activeCardByProduct.get(productId);
    setProduceDialog({
      productId,
      productName,
      unit,
      suggestedQty: card ? Number(card.targetQty) : suggestedQty,
      cardId: card?.id ?? null,
      status: card?.status === "processing" ? "processing" : "pending",
    });
  };

  const handleProduceStart = async (qty: number) => {
    if (!produceDialog) return;
    setBusyProductId(produceDialog.productId);
    try {
      const cardId =
        produceDialog.cardId ??
        (await ensureCard(produceDialog.productId, qty));
      await updateCard.mutateAsync({
        id: cardId,
        data: { status: "processing", targetQty: qty },
      });
      await refreshLists();
      toast({
        title: "Production started",
        description: `${produceDialog.productName} moved to processing.`,
      });
      setProduceDialog(null);
    } catch (err: any) {
      toast({
        title: "Failed to start",
        description: err?.message ?? "Server error",
        variant: "destructive",
      });
    } finally {
      setBusyProductId(null);
    }
  };

  const handleProduceComplete = async (finalQty: number) => {
    if (!produceDialog) return;
    setBusyProductId(produceDialog.productId);
    try {
      const cardId =
        produceDialog.cardId ??
        (await ensureCard(produceDialog.productId, finalQty));
      await updateCard.mutateAsync({
        id: cardId,
        data: { status: "done", targetQty: finalQty },
      });
      await refreshLists();
      toast({
        title: "Production complete",
        description: `Added ${finalQty} ${produceDialog.unit} of ${produceDialog.productName}. Raw materials debited.`,
      });
      setProduceDialog(null);
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({
        title: "Failed to complete",
        description: desc,
        variant: "destructive",
      });
    } finally {
      setBusyProductId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (manufacturingAlerts.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg">
        <CheckCircle2 className="mx-auto h-12 w-12 text-green-600 opacity-40 mb-4" />
        <h3 className="text-lg font-medium">Nothing to produce</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          No manufacturing items are below their minimum stock threshold right
          now. Items appear here when a product with "Add for Manufacturing"
          enabled in Inventory dips below its stock threshold.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" />
            Production Workload
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manufacturing items below minimum stock. Move each item Pending →
            Processing → Done; on Done, confirm produced qty and stock
            auto-adjusts.
          </p>
        </div>
        <Badge variant="destructive" data-testid="badge-workload-count">
          {manufacturingAlerts.length} item{manufacturingAlerts.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="rounded-lg border overflow-hidden">
        {/* Desktop / tablet: dense table layout */}
        <div className="hidden md:block">
        <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase text-muted-foreground font-medium bg-muted/50">
          <div className="col-span-4">Product</div>
          <div className="col-span-1 text-right">Required</div>
          <div className="col-span-1 text-right">Available</div>
          <div className="col-span-2 text-right">Shortage</div>
          <div className="col-span-4 text-center">Status</div>
        </div>
        <div className="divide-y">
          {manufacturingAlerts.map((a: any) => {
            const bom = bomByFinishedProduct.get(a.id);
            const product = productById.get(a.id);
            const imageUrl = product?.imageUrl;
            const itemCode = product?.itemCode;
            const unit = a.unit ?? "";
            const available = Number(a.currentStock);
            const card = activeCardByProduct.get(a.id);
            // Required = the active card's target qty if a worker has set one,
            // otherwise the qty needed to climb back above the min threshold.
            const required = card
              ? Number(card.targetQty)
              : Math.max(0, Number(a.minStockThreshold) - available);
            const shortage = Math.max(0, required - available);
            const critical = available <= 0;
            const status: "pending" | "processing" =
              card?.status === "processing" ? "processing" : "pending";
            const isBusy = busyProductId === a.id;
            const hasBom = !!bom;

            return (
              <div
                key={a.id}
                className="grid grid-cols-12 gap-3 px-4 py-3 items-center"
                data-testid={`workload-row-${a.id}`}
              >
                <div className="col-span-4 min-w-0 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-md border bg-muted/30 shrink-0 overflow-hidden flex items-center justify-center">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={a.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <Package className="w-5 h-5 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium line-clamp-1 flex items-center gap-2">
                      {critical && (
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                      )}
                      {a.name}
                    </div>
                    {itemCode && (
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {itemCode}
                      </div>
                    )}
                    {hasBom ? (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Recipe ready · {bom.outputQuantity} per batch ·{" "}
                        {bom.items.length} materials
                      </div>
                    ) : (
                      <div className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                        No BOM defined — set up a recipe before producing
                      </div>
                    )}
                  </div>
                </div>
                <div className="col-span-1 text-right tabular-nums font-medium">
                  {required.toLocaleString()} {unit}
                </div>
                <div
                  className={`col-span-1 text-right tabular-nums ${critical ? "text-destructive font-medium" : "text-muted-foreground"}`}
                >
                  {available.toLocaleString()} {unit}
                </div>
                <div className="col-span-2 text-right tabular-nums">
                  <Badge
                    variant={shortage > 0 ? "destructive" : "secondary"}
                    className={shortage > 0 ? "text-white" : ""}
                    data-testid={`shortage-${a.id}`}
                  >
                    {shortage.toLocaleString()} {unit}
                  </Badge>
                </div>
                <div
                  className="col-span-4 flex justify-center items-center gap-2"
                  data-testid={`status-${a.id}`}
                >
                  {hasBom && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={isBusy}
                      onClick={() =>
                        handleOpenProduce(
                          a.id,
                          a.name,
                          unit,
                          shortage || required || 1,
                        )
                      }
                      data-testid={`button-produce-${a.id}`}
                    >
                      <Factory className="h-4 w-4 mr-1.5" />
                      Produce
                    </Button>
                  )}
                  {hasBom ? (
                    <Select
                      value={status}
                      disabled={isBusy}
                      onValueChange={(next) => {
                        if (next === status) return;
                        if (next === "done") {
                          handleOpenDone(a.id, a.name, unit, shortage || 1);
                        } else if (
                          next === "pending" ||
                          next === "processing"
                        ) {
                          handleSetStatus(a.id, next, shortage || 1);
                        }
                      }}
                    >
                      <SelectTrigger
                        className={`w-44 ${
                          status === "processing"
                            ? "border-blue-500 text-blue-700 dark:text-blue-300"
                            : "border-border"
                        }`}
                        data-testid={`select-status-${a.id}`}
                      >
                        {isBusy ? (
                          <span className="flex items-center gap-2 text-xs">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                            Updating…
                          </span>
                        ) : (
                          <SelectValue />
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                            Pending
                          </span>
                        </SelectItem>
                        <SelectItem value="processing">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            Processing
                          </span>
                        </SelectItem>
                        <SelectItem value="done">
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-green-600" />
                            Done (enter qty…)
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline">No Recipe</Badge>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title={hasBom ? "Edit BOM" : "Add BOM"}
                      onClick={() =>
                        setBomDialog({
                          finishedProductId: a.id,
                          finishedProductName: a.name,
                          existingBom: bom ?? null,
                        })
                      }
                      data-testid={`button-${hasBom ? "edit" : "add"}-bom-${a.id}`}
                    >
                      {hasBom ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </div>

        {/* Mobile: stacked cards — the status controls (Produce / status select /
            BOM button) need their own full-width rows since a fixed-width select
            plus buttons never fit inside a narrow grid column on a phone. */}
        <div className="md:hidden divide-y">
          {manufacturingAlerts.map((a: any) => {
            const bom = bomByFinishedProduct.get(a.id);
            const product = productById.get(a.id);
            const imageUrl = product?.imageUrl;
            const itemCode = product?.itemCode;
            const unit = a.unit ?? "";
            const available = Number(a.currentStock);
            const card = activeCardByProduct.get(a.id);
            const required = card
              ? Number(card.targetQty)
              : Math.max(0, Number(a.minStockThreshold) - available);
            const shortage = Math.max(0, required - available);
            const critical = available <= 0;
            const status: "pending" | "processing" =
              card?.status === "processing" ? "processing" : "pending";
            const isBusy = busyProductId === a.id;
            const hasBom = !!bom;

            return (
              <div
                key={a.id}
                className="p-4 space-y-3"
                data-testid={`workload-row-mobile-${a.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-md border bg-muted/30 shrink-0 overflow-hidden flex items-center justify-center">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={a.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <Package className="w-5 h-5 text-muted-foreground/40" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium line-clamp-1 flex items-center gap-2">
                      {critical && (
                        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                      )}
                      {a.name}
                    </div>
                    {itemCode && (
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {itemCode}
                      </div>
                    )}
                    {hasBom ? (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Recipe ready · {bom.outputQuantity} per batch ·{" "}
                        {bom.items.length} materials
                      </div>
                    ) : (
                      <div className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
                        No BOM defined — set up a recipe before producing
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Required</div>
                    <div className="tabular-nums font-medium">{required.toLocaleString()} {unit}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Available</div>
                    <div className={`tabular-nums font-medium ${critical ? "text-destructive" : ""}`}>
                      {available.toLocaleString()} {unit}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground uppercase tracking-wide text-[10px]">Shortage</div>
                    <Badge
                      variant={shortage > 0 ? "destructive" : "secondary"}
                      className={shortage > 0 ? "text-white" : ""}
                      data-testid={`shortage-mobile-${a.id}`}
                    >
                      {shortage.toLocaleString()} {unit}
                    </Badge>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t" data-testid={`status-mobile-${a.id}`}>
                  {hasBom && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      disabled={isBusy}
                      onClick={() =>
                        handleOpenProduce(
                          a.id,
                          a.name,
                          unit,
                          shortage || required || 1,
                        )
                      }
                      data-testid={`button-produce-mobile-${a.id}`}
                    >
                      <Factory className="h-4 w-4 mr-1.5" />
                      Produce
                    </Button>
                  )}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title={hasBom ? "Edit BOM" : "Add BOM"}
                      onClick={() =>
                        setBomDialog({
                          finishedProductId: a.id,
                          finishedProductName: a.name,
                          existingBom: bom ?? null,
                        })
                      }
                      data-testid={`button-${hasBom ? "edit" : "add"}-bom-mobile-${a.id}`}
                    >
                      {hasBom ? (
                        <Pencil className="h-4 w-4" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>

                {hasBom ? (
                  <Select
                    value={status}
                    disabled={isBusy}
                    onValueChange={(next) => {
                      if (next === status) return;
                      if (next === "done") {
                        handleOpenDone(a.id, a.name, unit, shortage || 1);
                      } else if (
                        next === "pending" ||
                        next === "processing"
                      ) {
                        handleSetStatus(a.id, next, shortage || 1);
                      }
                    }}
                  >
                    <SelectTrigger
                      className={`w-full ${
                        status === "processing"
                          ? "border-blue-500 text-blue-700 dark:text-blue-300"
                          : "border-border"
                      }`}
                      data-testid={`select-status-mobile-${a.id}`}
                    >
                      {isBusy ? (
                        <span className="flex items-center gap-2 text-xs">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />{" "}
                          Updating…
                        </span>
                      ) : (
                        <SelectValue />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                          Pending
                        </span>
                      </SelectItem>
                      <SelectItem value="processing">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500" />
                          Processing
                        </span>
                      </SelectItem>
                      <SelectItem value="done">
                        <span className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-600" />
                          Done (enter qty…)
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="w-full justify-center py-1.5">No Recipe</Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <MarkDoneDialog
        state={doneDialog}
        submitting={busyProductId != null && doneDialog != null}
        onCancel={() => setDoneDialog(null)}
        onConfirm={handleConfirmDone}
      />

      <ProduceDialog
        state={produceDialog}
        submitting={busyProductId != null && produceDialog != null}
        onCancel={() => setProduceDialog(null)}
        onStart={handleProduceStart}
        onComplete={handleProduceComplete}
      />

      <BomDialog
        state={bomDialog}
        allProducts={products ?? []}
        onClose={() => setBomDialog(null)}
      />
    </div>
  );
}

// --------------------------- MARK DONE DIALOG ---------------------------

function MarkDoneDialog({
  state,
  submitting,
  onCancel,
  onConfirm,
}: {
  state: {
    productId: number;
    productName: string;
    unit: string;
    suggestedQty: number;
    cardId: number | null;
  } | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: (qty: number) => void;
}) {
  const [qty, setQty] = useState("");
  const [touched, setTouched] = useState(false);

  React.useEffect(() => {
    if (state) {
      setQty(String(state.suggestedQty || ""));
      setTouched(false);
    }
  }, [state]);

  const numQty = Number(qty);
  const valid = isFinite(numQty) && numQty > 0;

  return (
    <Dialog
      open={state != null}
      onOpenChange={(v) => {
        if (!v && !submitting) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark Done — How much produced?</DialogTitle>
          <DialogDescription>
            {state && (
              <>
                Enter the actual quantity of{" "}
                <span className="font-medium text-foreground">
                  {state.productName}
                </span>{" "}
                that came off the line. The system will debit raw materials per
                the recipe and credit this finished stock.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="done-qty">Produced Qty *</Label>
          <div className="relative">
            <Input
              id="done-qty"
              type="number"
              min="0"
              step="0.001"
              autoFocus
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setTouched(true);
              }}
              data-testid="input-done-qty"
              className="pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground uppercase">
              {state?.unit}
            </span>
          </div>
          {touched && !valid && (
            <p className="text-xs text-destructive">
              Enter a quantity greater than zero.
            </p>
          )}
          {state && (
            <p className="text-xs text-muted-foreground">
              Suggested: {state.suggestedQty} {state.unit} (current shortage)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            data-testid="button-done-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => valid && onConfirm(numQty)}
            disabled={!valid || submitting}
            data-testid="button-done-confirm"
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <PackageCheck className="w-4 h-4 mr-2" />
            Confirm & Produce
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------- PRODUCE DIALOG ---------------------------
// Per-product production popup: enter qty, then either start (processing) or
// complete (done) production. Reuses the existing workload-card handlers.

function ProduceDialog({
  state,
  submitting,
  onCancel,
  onStart,
  onComplete,
}: {
  state: {
    productId: number;
    productName: string;
    unit: string;
    suggestedQty: number;
    cardId: number | null;
    status: "pending" | "processing";
  } | null;
  submitting: boolean;
  onCancel: () => void;
  onStart: (qty: number) => void;
  onComplete: (qty: number) => void;
}) {
  const [qty, setQty] = useState("");
  const [touched, setTouched] = useState(false);

  React.useEffect(() => {
    if (state) {
      setQty(String(state.suggestedQty || ""));
      setTouched(false);
    }
  }, [state]);

  const numQty = Number(qty);
  const valid = isFinite(numQty) && numQty > 0;

  return (
    <Dialog
      open={state != null}
      onOpenChange={(v) => {
        if (!v && !submitting) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory className="w-5 h-5 text-primary" />
            Produce {state?.productName}
          </DialogTitle>
          <DialogDescription>
            Enter the quantity to produce. Start production to move it to
            processing, or complete production to debit raw materials and credit
            finished stock.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="produce-qty">Quantity to produce *</Label>
          <div className="relative">
            <Input
              id="produce-qty"
              type="number"
              min="0"
              step="0.001"
              autoFocus
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setTouched(true);
              }}
              data-testid="input-produce-qty"
              className="pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground uppercase">
              {state?.unit}
            </span>
          </div>
          {touched && !valid && (
            <p className="text-xs text-destructive">
              Enter a quantity greater than zero.
            </p>
          )}
          {state && (
            <p className="text-xs text-muted-foreground">
              Suggested: {state.suggestedQty} {state.unit}
              {state.status === "processing" ? " · already processing" : ""}
            </p>
          )}
        </div>
        <DialogFooter className="flex-col sm:flex-row sm:justify-end gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={submitting}
            data-testid="button-produce-cancel"
          >
            Cancel
          </Button>
          {state?.status !== "processing" && (
            <Button
              variant="secondary"
              onClick={() => valid && onStart(numQty)}
              disabled={!valid || submitting}
              data-testid="button-produce-start"
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Factory className="w-4 h-4 mr-2" />
              Start Production
            </Button>
          )}
          <Button
            onClick={() => valid && onComplete(numQty)}
            disabled={!valid || submitting}
            data-testid="button-produce-complete"
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <PackageCheck className="w-4 h-4 mr-2" />
            Complete Production
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------- ASSEMBLE TAB ---------------------------

function AssembleTab({
  initialBomId,
  onConsumeInitialBomId,
}: {
  initialBomId?: string;
  onConsumeInitialBomId?: () => void;
}) {
  const { data: boms, isLoading: bomsLoading } = useListBoms();
  const { data: products } = useListProducts({});
  const { data: workloads } = useListWorkloadCards();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const assembleItem = useAssembleItem();

  const [bomId, setBomId] = useState<string>("");
  const [batches, setBatches] = useState<string>("1");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [showAssembleDialog, setShowAssembleDialog] = useState(false);

  // When the Workload tab requests an assembly, accept the pre-selection
  // exactly once and immediately clear it so subsequent navigation back to
  // this tab doesn't snap the selection again.
  React.useEffect(() => {
    if (initialBomId) {
      setBomId(initialBomId);
      setBatches("1");
      setSearch("");
      setShowAssembleDialog(true);
      onConsumeInitialBomId?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialBomId]);

  const selectedBom = useMemo(
    () => boms?.find((b: any) => String(b.id) === bomId),
    [boms, bomId],
  );

  const productById = useMemo(() => {
    const m = new Map<number, any>();
    products?.forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

  const filteredBoms = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boms ?? [];
    return (boms ?? []).filter((b: any) => {
      const prod = productById.get(b.finishedProductId);
      const haystack = [
        b.finishedProductName,
        prod?.itemCode,
        prod?.brand,
        prod?.group,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [boms, search, productById]);

  const batchCount = Math.max(0, Number(batches) || 0);
  const outputUnits = selectedBom
    ? batchCount * Number(selectedBom.outputQuantity)
    : 0;

  type Requirement = {
    materialProductId: number;
    materialProductName: string;
    unit: string;
    required: number;
    available: number;
    sufficient: boolean;
  };

  const requirements: Requirement[] = useMemo(() => {
    if (!selectedBom) return [];
    return selectedBom.items.map((it: any) => {
      const required = Number(it.quantity) * batchCount;
      const prod = productById.get(it.materialProductId);
      const available = Number(prod?.currentStock ?? 0);
      return {
        materialProductId: it.materialProductId,
        materialProductName: it.materialProductName,
        unit: it.unit,
        required,
        available,
        sufficient: available >= required,
      };
    });
  }, [selectedBom, batchCount, productById]);

  const anyShortage = requirements.some((r) => !r.sufficient);
  const canAssemble =
    !!selectedBom && batchCount > 0 && !anyShortage && !submitting;


  const handleAssemble = async () => {
    if (!selectedBom || batchCount <= 0) return;
    setSubmitting(true);
    try {
      // Single atomic call — server runs the entire recipe (debit raw,
      // credit finished, write movements, create the done workload card) in
      // one SERIALIZABLE transaction. No orphan state possible on failure.
      await assembleItem.mutateAsync({
        data: { bomId: selectedBom.id, batches: batchCount },
      });

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListWorkloadCardsQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }),
      ]);

      toast({
        title: "Assembly complete",
        description: `Produced ${outputUnits} of ${selectedBom.finishedProductName}. Raw materials were debited.`,
      });
      setBatches("1");
      setShowAssembleDialog(false);
    } catch (err: any) {
      let title = "Assembly failed";
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
        if (Array.isArray(body?.shortages) && body.shortages.length > 0) {
          title = "Insufficient raw material";
          desc = body.shortages
            .map(
              (s: any) =>
                `${s.materialProductName}: need ${s.required} ${s.unit}, have ${s.available}`,
            )
            .join("; ");
        }
      } catch {}
      toast({ title, description: desc, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (bomsLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (!boms || boms.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg">
        <Factory className="mx-auto h-12 w-12 text-muted-foreground opacity-20 mb-4" />
        <h3 className="text-lg font-medium">No BOMs available</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          To assemble items, first define a Bill of Material in the BOM tab so
          the system knows which raw materials are consumed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* BOM picker — visual catalog of recipes, now full width */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Pick a Recipe to Assemble</h2>
          <span className="text-xs text-muted-foreground">
            {filteredBoms.length} of {boms.length} recipe
            {boms.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name, item code, brand or group…"
            className="pl-9 pr-9"
            data-testid="input-assemble-search"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              data-testid="button-clear-search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {filteredBoms.length === 0 ? (
          <div className="text-center py-10 border border-dashed rounded-lg text-sm text-muted-foreground">
            No recipes match "{search}".
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {filteredBoms.map((b: any) => {
              const prod = productById.get(b.finishedProductId);
              const finishedStock = Number(prod?.currentStock ?? 0);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setBomId(String(b.id));
                    setBatches("1");
                    setShowAssembleDialog(true);
                  }}
                  data-testid={`card-bom-${b.id}`}
                  className="group relative text-left rounded-lg border border-border/50 overflow-hidden flex flex-col transition-all hover:shadow-md hover:border-primary active:scale-[0.98]"
                >
                  <div className="aspect-square bg-muted flex items-center justify-center relative p-4">
                    {prod?.imageUrl ? (
                      <img
                        src={prod.imageUrl}
                        alt={b.finishedProductName}
                        className="object-contain h-full w-full"
                      />
                    ) : (
                      <Package className="w-14 h-14 opacity-10" />
                    )}
                    <Badge
                      variant="secondary"
                      className="absolute bottom-2 left-2 text-[10px] px-1.5"
                    >
                      Stock: {finishedStock}
                    </Badge>
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    {prod?.itemCode && (
                      <div className="text-[10px] text-muted-foreground font-mono mb-0.5 truncate">
                        {prod.itemCode}
                      </div>
                    )}
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2 mb-2">
                      {b.finishedProductName}
                    </h3>
                    <div className="mt-auto flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Per batch</span>
                      <span className="font-medium tabular-nums">
                        {b.outputQuantity}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs mt-0.5">
                      <span className="text-muted-foreground">Materials</span>
                      <span className="font-medium tabular-nums">
                        {b.items.length}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Assembly Dialog — opens when a recipe card is tapped */}
      <Dialog
        open={showAssembleDialog && !!selectedBom}
        onOpenChange={(open) => {
          if (!open && !submitting) {
            setShowAssembleDialog(false);
          }
        }}
      >
        <DialogContent className="w-full max-w-lg mx-auto max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base pr-6">
              <PackageCheck className="w-5 h-5 text-primary shrink-0" />
              <span className="line-clamp-2">
                {selectedBom?.finishedProductName}
              </span>
            </DialogTitle>
          </DialogHeader>

          {selectedBom &&
            (() => {
              const prod = productById.get(selectedBom.finishedProductId);
              return (
                <div className="space-y-5 pt-1">
                  {/* Product image + name */}
                  {prod?.imageUrl && (
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-16 rounded-lg border bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        <img
                          src={prod.imageUrl}
                          alt={selectedBom.finishedProductName ?? ""}
                          className="object-contain w-full h-full"
                        />
                      </div>
                      <div>
                        <div className="font-semibold leading-tight">
                          {selectedBom.finishedProductName}
                        </div>
                        {prod?.itemCode && (
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">
                            {prod.itemCode}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Current stock:{" "}
                          <span className="font-medium text-foreground">
                            {Number(prod?.currentStock ?? 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Batch qty input */}
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1.5">
                      <Label>Batches *</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={batches}
                        onChange={(e) => setBatches(e.target.value)}
                        data-testid="input-assemble-batches"
                        className="w-28"
                      />
                    </div>
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 flex items-center gap-2 text-sm flex-1 min-w-[160px]">
                      <span className="text-muted-foreground">
                        Will produce
                      </span>
                      <span
                        className="font-semibold tabular-nums"
                        data-testid="text-output-units"
                      >
                        {outputUnits}
                      </span>
                      <Badge variant="outline" className="ml-auto text-xs">
                        {batchCount} × {selectedBom.outputQuantity}
                      </Badge>
                    </div>
                  </div>

                  {/* Material consumption check */}
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">
                      Material Consumption Check
                    </Label>
                    <div className="rounded-lg border divide-y overflow-hidden">
                      <div className="grid grid-cols-12 gap-1 px-3 py-2 text-[11px] uppercase text-muted-foreground font-medium bg-muted/50">
                        <div className="col-span-5">Material</div>
                        <div className="col-span-3 text-right">Required</div>
                        <div className="col-span-3 text-right">In Stock</div>
                        <div className="col-span-1" />
                      </div>
                      {requirements.map((r) => (
                        <div
                          key={r.materialProductId}
                          className="grid grid-cols-12 gap-1 px-3 py-2.5 text-sm items-center"
                          data-testid={`req-row-${r.materialProductId}`}
                        >
                          <div className="col-span-5 line-clamp-2 leading-tight text-xs">
                            {r.materialProductName}
                          </div>
                          <div className="col-span-3 text-right tabular-nums text-xs">
                            {r.required.toLocaleString()} {r.unit}
                          </div>
                          <div
                            className={`col-span-3 text-right tabular-nums text-xs ${r.sufficient ? "" : "text-destructive font-semibold"}`}
                          >
                            {r.available.toLocaleString()} {r.unit}
                          </div>
                          <div className="col-span-1 flex justify-end">
                            {r.sufficient ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-destructive" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    {anyShortage && batchCount > 0 && (
                      <p className="text-xs text-destructive flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Insufficient raw material for one or more inputs. Reduce
                        batch count or restock.
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowAssembleDialog(false)}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAssemble}
                      disabled={!canAssemble}
                      data-testid="button-assemble"
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    >
                      {submitting && (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      )}
                      <PackageCheck className="w-4 h-4 mr-2" />
                      Assemble Now
                    </Button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --------------------------- DISPATCH TAB ---------------------------
// Two-stage view:
//   Stage 1 — "In Production" (status=production or processing): shows orders
//             coming out of manufacturing so the user can mark them
//             ready_for_dispatch.
//   Stage 2 — "Ready For Dispatch": vehicle/driver form + Mark Dispatched.

function DispatchTab() {
  const { data: productionOrders, isLoading: loadingProd } =
    useListCustomerOrders({ status: "production" as any });
  const { data: processingOrders, isLoading: loadingProc } =
    useListCustomerOrders({ status: "processing" as any });
  const { data: readyOrders, isLoading: loadingReady } = useListCustomerOrders(
    { status: "ready_for_dispatch" as any },
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateStatus = useUpdateCustomerOrderStatus();

  const [forms, setForms] = useState<
    Record<
      number,
      { vehicleNumber: string; driverName: string; dispatchDate: string }
    >
  >({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const isLoading = loadingProd || loadingProc || loadingReady;

  // Combine production + processing into one "in production" list
  const inProductionOrders = [
    ...(productionOrders ?? []),
    ...(processingOrders ?? []),
  ];

  const getForm = (id: number) =>
    forms[id] ?? { vehicleNumber: "", driverName: "", dispatchDate: "" };

  const setField = (
    id: number,
    field: "vehicleNumber" | "driverName" | "dispatchDate",
    value: string,
  ) => {
    setForms((prev) => ({
      ...prev,
      [id]: { ...getForm(id), [field]: value },
    }));
  };

  const invalidateOrders = () =>
    queryClient.invalidateQueries({
      queryKey: getListCustomerOrdersQueryKey(),
    });

  const handleMarkReady = async (id: number) => {
    setBusyId(id);
    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: "ready_for_dispatch" },
      });
      await invalidateOrders();
      toast({
        title: "Marked ready for dispatch",
        description: "Order moved to the dispatch queue.",
      });
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({ title: "Failed", description: desc, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDispatch = async (id: number) => {
    const form = getForm(id);
    setBusyId(id);
    try {
      await updateStatus.mutateAsync({
        id,
        data: {
          status: "dispatched",
          vehicleNumber: form.vehicleNumber || undefined,
          driverName: form.driverName || undefined,
          dispatchDate: form.dispatchDate || undefined,
        },
      });
      await invalidateOrders();
      toast({ title: "Order dispatched", description: "Marked as dispatched." });
    } catch (err: any) {
      toast({
        title: "Dispatch failed",
        description: err?.message ?? "Server error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  const totalOrders =
    inProductionOrders.length + (readyOrders?.length ?? 0);

  if (totalOrders === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg">
        <Inbox className="mx-auto h-12 w-12 text-muted-foreground opacity-20 mb-4" />
        <h3 className="text-lg font-medium">No orders in the dispatch pipeline</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Orders in Processing or Production will appear here so you can mark
          them Ready for Dispatch, then enter vehicle details and dispatch them.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Stage 1: In Production ── */}
      {inProductionOrders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Factory className="w-4 h-4 text-blue-600" />
                In Production
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Production is done? Click "Mark Ready" to move the order to
                the dispatch queue.
              </p>
            </div>
            <Badge variant="secondary">
              {inProductionOrders.length} order
              {inProductionOrders.length === 1 ? "" : "s"}
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inProductionOrders.map((o: any) => {
              const isBusy = busyId === o.id;
              return (
                <Card
                  key={o.id}
                  className="border-blue-200 dark:border-blue-900"
                  data-testid={`production-row-${o.id}`}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between gap-2">
                      <span className="line-clamp-1">{o.customerName}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {o.orderNo ?? `#${o.id}`}
                      </span>
                    </CardTitle>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {o.totalItems} item{o.totalItems === 1 ? "" : "s"}
                      </span>
                      <span className="font-medium text-foreground">
                        ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Button
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                      disabled={isBusy}
                      onClick={() => handleMarkReady(o.id)}
                      data-testid={`button-mark-ready-${o.id}`}
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <PackageCheck className="w-4 h-4 mr-2" />
                      )}
                      Mark Ready for Dispatch
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Stage 2: Ready for Dispatch ── */}
      {(readyOrders?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                Ready For Dispatch
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Enter vehicle and driver details, then mark each order
                dispatched.
              </p>
            </div>
            <Badge variant="secondary" data-testid="badge-dispatch-count">
              {readyOrders!.length} order{readyOrders!.length === 1 ? "" : "s"}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {readyOrders!.map((o: any) => {
              const form = getForm(o.id);
              const isBusy = busyId === o.id;
              return (
                <Card key={o.id} data-testid={`dispatch-row-${o.id}`}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span className="line-clamp-1">{o.customerName}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {o.orderNo ?? `#${o.id}`}
                      </span>
                    </CardTitle>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>
                        {o.totalItems} item{o.totalItems === 1 ? "" : "s"}
                      </span>
                      <span className="font-medium text-foreground">
                        ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`vehicle-${o.id}`}>Vehicle Number</Label>
                      <Input
                        id={`vehicle-${o.id}`}
                        value={form.vehicleNumber}
                        onChange={(e) =>
                          setField(o.id, "vehicleNumber", e.target.value)
                        }
                        placeholder="MH-12-AB-1234"
                        data-testid={`input-vehicle-${o.id}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`driver-${o.id}`}>Driver Name</Label>
                      <Input
                        id={`driver-${o.id}`}
                        value={form.driverName}
                        onChange={(e) =>
                          setField(o.id, "driverName", e.target.value)
                        }
                        placeholder="Driver name"
                        data-testid={`input-driver-${o.id}`}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`date-${o.id}`}>Dispatch Date</Label>
                      <Input
                        id={`date-${o.id}`}
                        type="date"
                        value={form.dispatchDate}
                        onChange={(e) =>
                          setField(o.id, "dispatchDate", e.target.value)
                        }
                        data-testid={`input-dispatch-date-${o.id}`}
                      />
                    </div>
                    <Button
                      className="w-full"
                      disabled={isBusy}
                      onClick={() => handleDispatch(o.id)}
                      data-testid={`button-dispatch-${o.id}`}
                    >
                      {isBusy ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Truck className="w-4 h-4 mr-2" />
                      )}
                      Mark Dispatched
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// --------------------------- MATERIAL TRANSFER TAB ---------------------------
// Printable log of raw material sent between Store and Manufacturing. Does
// NOT touch product.currentStock — this app tracks one stock number per
// product, not separate location-wise stock, so this is a paper trail only.

interface TransferDraftItem {
  productId: string;
  qty: string;
  unit: string;
}

function MaterialTransferTab() {
  const { data: transfers, isLoading } = useListMaterialTransfers();
  const { data: products } = useListProducts();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createTransfer = useCreateMaterialTransfer();
  const deleteTransfer = useDeleteMaterialTransfer();

  const [showAdd, setShowAdd] = useState(false);
  const [sentBy, setSentBy] = useState("");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<TransferDraftItem[]>([{ productId: "", qty: "", unit: "QTY" }]);
  const [printingId, setPrintingId] = useState<number | null>(null);

  const productById = useMemo(() => {
    const m = new Map<number, any>();
    (products ?? []).forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

  const resetForm = () => {
    setSentBy("");
    setTransferDate(new Date().toISOString().slice(0, 10));
    setNotes("");
    setItems([{ productId: "", qty: "", unit: "QTY" }]);
  };

  const addRow = () => setItems((rows) => [...rows, { productId: "", qty: "", unit: "QTY" }]);
  const removeRow = (idx: number) => setItems((rows) => rows.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<TransferDraftItem>) =>
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const validItems = items.filter((i) => i.productId && Number(i.qty) > 0);
  const canSave = validItems.length > 0 && !createTransfer.isPending;

  const handleSave = () => {
    createTransfer.mutate(
      {
        data: {
          transferDate: transferDate ? new Date(transferDate).toISOString() : undefined,
          sentBy: sentBy.trim() || undefined,
          notes: notes.trim() || undefined,
          items: validItems.map((i) => ({
            productId: Number(i.productId),
            qty: Number(i.qty),
            unit: i.unit || "QTY",
          })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMaterialTransfersQueryKey() });
          toast({ title: "Material transfer logged" });
          resetForm();
          setShowAdd(false);
        },
        onError: (e: any) =>
          toast({
            title: "Could not save transfer",
            description: e?.response?.data?.error ?? e?.message ?? "Unknown error",
            variant: "destructive",
          }),
      },
    );
  };

  const handleDelete = (id: number) => {
    if (!confirm("Delete this material transfer? This cannot be undone.")) return;
    deleteTransfer.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMaterialTransfersQueryKey() });
          toast({ title: "Material transfer deleted" });
        },
        onError: (e: any) =>
          toast({
            title: "Could not delete",
            description: e?.response?.data?.error ?? e?.message ?? "Unknown error",
            variant: "destructive",
          }),
      },
    );
  };

  const handlePrint = async (id: number) => {
    setPrintingId(id);
    try {
      const res = await fetch(`/api/material-transfers/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load transfer");
      const t = await res.json();
      const printHTML = `
        <html><head><title>Material Transfer ${t.transferNo}</title>
        <style>
          body { font-family: sans-serif; font-size: 13px; padding: 24px; }
          h2 { margin: 0 0 4px 0; }
          .meta { color: #444; font-size: 12px; margin-bottom: 4px; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
          th { background: #f3f4f6; font-weight: 600; }
          td.num { text-align: right; }
          .sign { margin-top: 60px; display: flex; justify-content: space-between; }
          .sign div { border-top: 1px solid #333; width: 200px; padding-top: 4px; font-size: 11px; text-align: center; }
        </style></head><body>
        <h2>Material Transfer Slip</h2>
        <div class="meta"><strong>${t.transferNo}</strong> &middot; ${new Date(t.transferDate).toLocaleDateString("en-IN")}</div>
        ${t.sentBy ? `<div class="meta">Sent By: ${t.sentBy}</div>` : ""}
        ${t.notes ? `<div class="meta">Notes: ${t.notes}</div>` : ""}
        <table>
          <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit</th></tr></thead>
          <tbody>
            ${t.items.map((it: any, idx: number) => `<tr>
              <td>${idx + 1}</td><td>${it.productName}</td>
              <td class="num">${Number(it.qty).toLocaleString()}</td><td>${it.unit}</td>
            </tr>`).join("")}
          </tbody>
        </table>
        <div class="sign">
          <div>Sent By</div>
          <div>Received By</div>
        </div>
        </body></html>
      `;
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(printHTML);
      w.document.close();
      w.focus();
      w.print();
    } catch {
      toast({ title: "Could not print", variant: "destructive" });
    } finally {
      setPrintingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ArrowLeftRight className="w-5 h-5 text-primary" />
            Material Transfer
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Log raw material sent to/from Store. A printable slip only — stock
            quantities are not affected.
          </p>
        </div>
        <Button
          className="w-full sm:w-auto"
          onClick={() => { resetForm(); setShowAdd(true); }}
          data-testid="button-add-transfer"
        >
          <Plus className="h-4 w-4 mr-2" />
          New Transfer
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : !transfers || transfers.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg">
          <ArrowLeftRight className="mx-auto h-10 w-10 text-muted-foreground opacity-20 mb-3" />
          <p className="text-sm text-muted-foreground">No material transfers logged yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase text-muted-foreground font-medium bg-muted/50">
              <div className="col-span-2">Transfer #</div>
              <div className="col-span-2">Date</div>
              <div className="col-span-3">Sent By</div>
              <div className="col-span-2 text-right">Items</div>
              <div className="col-span-3 text-right">Actions</div>
            </div>
            <div className="divide-y">
              {transfers.map((t) => (
                <div
                  key={t.id}
                  className="grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm"
                  data-testid={`transfer-row-${t.id}`}
                >
                  <div className="col-span-2 font-medium font-mono">{t.transferNo}</div>
                  <div className="col-span-2 text-muted-foreground">
                    {new Date(t.transferDate).toLocaleDateString("en-IN")}
                  </div>
                  <div className="col-span-3 text-muted-foreground line-clamp-1">{t.sentBy || "—"}</div>
                  <div className="col-span-2 text-right tabular-nums">{t.itemCount}</div>
                  <div className="col-span-3 flex items-center justify-end gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handlePrint(t.id)}
                      disabled={printingId === t.id}
                      data-testid={`button-print-transfer-${t.id}`}
                    >
                      {printingId === t.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Printer className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(t.id)}
                        title="Delete"
                        data-testid={`button-delete-transfer-${t.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y">
            {transfers.map((t) => (
              <div key={t.id} className="p-4 space-y-2" data-testid={`transfer-row-mobile-${t.id}`}>
                <div className="flex items-center justify-between">
                  <div className="font-medium font-mono">{t.transferNo}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.transferDate).toLocaleDateString("en-IN")}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {t.sentBy ? `Sent by ${t.sentBy}` : "—"} · {t.itemCount} item{t.itemCount === 1 ? "" : "s"}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handlePrint(t.id)}
                    disabled={printingId === t.id}
                    data-testid={`button-print-transfer-mobile-${t.id}`}
                  >
                    {printingId === t.id ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Printer className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Print
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(t.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Transfer Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Material Transfer</DialogTitle>
            <DialogDescription>
              Log items sent between Store and Manufacturing. This is a
              printable record only — it does not change stock quantities.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  data-testid="input-transfer-date"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Sent By</Label>
                <Input
                  value={sentBy}
                  onChange={(e) => setSentBy(e.target.value)}
                  placeholder="Worker / store person name"
                  data-testid="input-transfer-sent-by"
                />
              </div>
            </div>

            <div className="border rounded-md">
              <div className="hidden gap-2 px-3 py-2 text-xs uppercase text-muted-foreground font-medium border-b bg-muted/50 sm:grid sm:grid-cols-[minmax(0,1fr)_100px_80px_36px]">
                <div>Item</div>
                <div className="text-right">Qty</div>
                <div>Unit</div>
                <div></div>
              </div>
              <div className="divide-y">
                {items.map((row, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-2 px-3 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_100px_80px_36px] sm:gap-2 sm:py-2 sm:items-center"
                  >
                    <Select
                      value={row.productId}
                      onValueChange={(v) => {
                        const prod = productById.get(Number(v));
                        updateRow(idx, { productId: v, unit: row.unit || prod?.unit || "QTY" });
                      }}
                    >
                      <SelectTrigger className="min-w-0" data-testid={`select-transfer-item-${idx}`}>
                        <SelectValue placeholder="Select item…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(products ?? []).map((p: any) => (
                          <SelectItem key={p.id} value={String(p.id)}>
                            {p.name}{p.itemCode ? ` · ${p.itemCode}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2 sm:contents">
                      <div className="sm:contents">
                        <Label className="mb-1 block text-[11px] text-muted-foreground sm:hidden">Qty</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={row.qty}
                          onChange={(e) => updateRow(idx, { qty: e.target.value })}
                          className="text-right"
                          data-testid={`input-transfer-qty-${idx}`}
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
                    <div className="flex justify-end sm:contents">
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
              <div className="p-2 border-t bg-muted/30">
                <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-transfer-item">
                  <Plus className="h-3.5 w-3.5 mr-1" />Add item
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes <span className="text-xs text-muted-foreground">(optional)</span></Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. reason for transfer" />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)} disabled={createTransfer.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!canSave} data-testid="button-save-transfer">
              {createTransfer.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --------------------------- REPORT TAB ---------------------------

function ReportTab() {
  const { data: workloads, isLoading } = useListWorkloadCards();
  const { data: products } = useListProducts({});
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState("");

  const productById = useMemo(() => {
    const m = new Map<number, any>();
    (products ?? []).forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    const from = fromDate ? new Date(fromDate + "T00:00:00") : null;
    const to = toDate ? new Date(toDate + "T23:59:59") : null;
    const q = search.trim().toLowerCase();
    return (workloads ?? [])
      .filter((c: any) => c.status === "done")
      .filter((c: any) => {
        const date = c.completedAt ? new Date(c.completedAt) : null;
        if (from && date && date < from) return false;
        if (to && date && date > to) return false;
        return true;
      })
      .filter((c: any) => {
        if (!q) return true;
        return String(c.productName ?? "").toLowerCase().includes(q);
      })
      .sort((a: any, b: any) =>
        new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()
      );
  }, [workloads, fromDate, toDate, search]);

  const totalQty = filtered.reduce((sum: number, c: any) => sum + Number(c.targetQty ?? 0), 0);
  const totalLtrs = filtered.reduce((sum: number, c: any) => {
    const prod = productById.get(c.productId);
    const lpb = Number(prod?.litersPerBox ?? 0);
    return sum + Number(c.targetQty ?? 0) * lpb;
  }, 0);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Assembly Report</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          All completed assembly runs within the selected date range.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">From</label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Search Product</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by product name…"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex gap-4 flex-wrap">
          <div className="rounded-lg border bg-muted/30 px-4 py-2 text-sm">
            <span className="text-muted-foreground">Runs: </span>
            <span className="font-semibold">{filtered.length}</span>
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-2 text-sm">
            <span className="text-muted-foreground">Total Qty: </span>
            <span className="font-semibold">{totalQty.toLocaleString()}</span>
          </div>
          {totalLtrs > 0 && (
            <div className="rounded-lg border bg-muted/30 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Total Ltrs: </span>
              <span className="font-semibold">{totalLtrs.toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-lg">
          <Factory className="mx-auto h-10 w-10 text-muted-foreground opacity-20 mb-3" />
          <p className="text-sm text-muted-foreground">No assembly records found for the selected period.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs uppercase text-muted-foreground font-medium bg-muted/50">
            <div className="col-span-5 sm:col-span-4">Product</div>
            <div className="col-span-3 sm:col-span-2 text-right">Qty</div>
            <div className="col-span-4 sm:col-span-2 text-right">Ltrs</div>
            <div className="hidden sm:block sm:col-span-4 text-right">Completed At</div>
          </div>
          <div className="divide-y">
            {filtered.map((c: any) => {
              const prod = productById.get(c.productId);
              const lpb = Number(prod?.litersPerBox ?? 0);
              const ltrs = Number(c.targetQty ?? 0) * lpb;
              return (
                <div key={c.id} className="grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm">
                  <div className="col-span-5 sm:col-span-4 font-medium line-clamp-1">
                    {c.productName}
                    <div className="text-[11px] text-muted-foreground font-normal sm:hidden">
                      {c.completedAt ? new Date(c.completedAt).toLocaleDateString() : "—"}
                    </div>
                  </div>
                  <div className="col-span-3 sm:col-span-2 text-right tabular-nums font-medium">{Number(c.targetQty).toLocaleString()}</div>
                  <div className="col-span-4 sm:col-span-2 text-right tabular-nums font-medium">
                    {lpb > 0 ? ltrs.toLocaleString() : "—"}
                  </div>
                  <div className="hidden sm:block sm:col-span-4 text-right text-xs text-muted-foreground">
                    {c.completedAt ? new Date(c.completedAt).toLocaleString() : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
