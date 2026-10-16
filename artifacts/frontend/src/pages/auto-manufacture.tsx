import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListProductsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, CheckCircle2, Factory, Loader2, Search, Wrench } from "lucide-react";

type Material = { productId: number; name: string; unit: string; qty: number; stockAfter: number };
type FixedProduct = {
  productId: number;
  productName: string;
  unit: string;
  stockBefore: number;
  stockAfter: number;
  fromReady: number;
  manufactured: number;
  materials: Material[];
};
type FixResult = {
  applied: boolean;
  productCount: number;
  rawMaterialsNegative: { productId: number; name: string; unit: string; stockAfter: number }[];
  products: FixedProduct[];
};

const qty = (n: number) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 3 });

// Admin: the "auto-manufacture on sale" switch, plus a one-time fix that
// brings manufactured products already below zero back to 0 by consuming
// their BOM raw materials (preview first, then Apply).
export default function AutoManufacture() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<FixResult | null>(null);
  const [loading, setLoading] = useState<"preview" | "apply" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    fetch("/api/auto-manufacture/settings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEnabled(!!d.enabled))
      .catch(() => setEnabled(null));
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await fetch("/api/auto-manufacture/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Could not save", variant: "destructive" }); return; }
      setEnabled(data.enabled);
      toast({ title: data.enabled ? "Auto manufacturing ON" : "Auto manufacturing OFF" });
    } catch {
      toast({ title: "Could not save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const run = async (mode: "preview" | "apply") => {
    setLoading(mode);
    try {
      const res = await fetch(`/api/auto-manufacture/negative-stock/${mode}`, {
        method: mode === "preview" ? "GET" : "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error ?? "Failed", variant: "destructive" }); return; }
      setResult(data);
      if (mode === "apply") {
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
        toast({ title: "Stock fixed", description: `${data.productCount} products brought back to 0.` });
      }
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Auto Manufacturing</h1>
        <p className="text-muted-foreground mt-2">
          Products you make (with a BOM) never go into negative stock when sold.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Factory className="h-4 w-4" /> Auto-manufacture on sale</CardTitle>
          <CardDescription>
            When a bill needs more of a manufactured product than is in stock, the shortfall is taken from Ready Material
            first; anything still short is treated as made right now — its raw materials are reduced as per the BOM and the
            product stops at 0 instead of going negative. Bought-in items (no BOM) are not affected.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch
            id="auto-manufacture"
            checked={!!enabled}
            disabled={enabled === null || saving}
            onCheckedChange={toggle}
            data-testid="switch-auto-manufacture"
          />
          <Label htmlFor="auto-manufacture">{enabled === null ? "Loading…" : enabled ? "On" : "Off"}</Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4" /> Fix products already in negative</CardTitle>
          <CardDescription>
            One-time clean-up: each manufactured product below zero is brought back to 0 the same way (Ready Material first,
            then raw materials per BOM). Check first — nothing changes until you Apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => run("preview")} disabled={loading !== null} data-testid="button-negative-preview">
            {loading === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
            Check negative stock
          </Button>
          {result && !result.applied && result.productCount > 0 && (
            <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={loading !== null} data-testid="button-negative-apply">
              {loading === "apply" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wrench className="h-4 w-4 mr-2" />}
              Fix {result.productCount} products
            </Button>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {result.productCount === 0 ? (
                <><CheckCircle2 className="h-5 w-5 text-green-600" /> No manufactured product is in negative stock</>
              ) : result.applied ? (
                <><CheckCircle2 className="h-5 w-5 text-green-600" /> {result.productCount} products brought back to 0</>
              ) : (
                <>{result.productCount} products will be brought back to 0</>
              )}
            </CardTitle>
          </CardHeader>
          {result.products.length > 0 && (
            <CardContent className="space-y-4">
              {result.rawMaterialsNegative.length > 0 && (
                <div className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm" data-testid="raw-negative-warning">
                  <div className="font-semibold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" /> These raw materials will be below zero — purchase / stock entry needed:
                  </div>
                  <div className="mt-1 text-amber-900 dark:text-amber-200">
                    {result.rawMaterialsNegative.map((m) => `${m.name} (${qty(m.stockAfter)} ${m.unit})`).join(", ")}
                  </div>
                </div>
              )}
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Stock now</TableHead>
                      <TableHead className="text-right">From Ready</TableHead>
                      <TableHead className="text-right">Auto made</TableHead>
                      <TableHead>Raw material used</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.products.map((p) => (
                      <TableRow key={p.productId} data-testid={`row-negative-${p.productId}`}>
                        <TableCell className="font-medium">{p.productName}</TableCell>
                        <TableCell className="text-right whitespace-nowrap text-red-600 font-semibold">{qty(p.stockBefore)} → 0</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{p.fromReady > 0 ? qty(p.fromReady) : "—"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{p.manufactured > 0 ? `${qty(p.manufactured)} ${p.unit}` : "—"}</TableCell>
                        <TableCell className="text-xs">
                          {p.materials.length === 0 ? "—" : p.materials.map((m) => (
                            <div key={m.productId} className={m.stockAfter < 0 ? "text-red-600" : undefined}>
                              {m.name}: −{qty(m.qty)} {m.unit}
                            </div>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fix {result?.productCount} products?</AlertDialogTitle>
            <AlertDialogDescription>
              Their stock becomes 0 and the raw materials shown are reduced, exactly as listed. Take a database backup first
              (Backup &amp; Restore) — this cannot be undone from the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmOpen(false); run("apply"); }}
              data-testid="button-negative-confirm"
            >
              Yes, fix stock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
