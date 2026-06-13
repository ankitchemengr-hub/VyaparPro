import { useState, useMemo } from "react";
import {
  useListBoms,
  useListProducts,
  getListBomsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BomDialog, type BomDialogState } from "@/components/bom-dialog";
import {
  FileText, Loader2, Plus, Pencil, Search, AlertTriangle, ShieldOff, Package,
} from "lucide-react";

export default function BomPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  // Admin gate (route already restricted, but defensive UI)
  if (user && user.role !== "admin") {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="py-12 text-center space-y-4">
          <ShieldOff className="w-12 h-12 mx-auto text-muted-foreground" />
          <div>
            <h2 className="text-lg font-semibold">Admin Only</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Bill of Materials management is restricted to administrators.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/")}>Back to Dashboard</Button>
        </CardContent>
      </Card>
    );
  }

  const { data: boms, isLoading: bomsLoading } = useListBoms();
  const { data: products } = useListProducts({});
  const [search, setSearch] = useState("");
  const [dialogState, setDialogState] = useState<BomDialogState | null>(null);

  // Index products by id for material name lookups
  const productById = useMemo(() => {
    const m = new Map<number, any>();
    (products ?? []).forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

  // Map BOMs by finished product id for quick lookup when listing products
  const bomByProduct = useMemo(() => {
    const m = new Map<number, any>();
    (boms ?? []).forEach((b: any) => m.set(b.finishedProductId, b));
    return m;
  }, [boms]);

  // Show all products as potential BOM candidates, with BOM status
  const rows = useMemo(() => {
    const list = (products ?? []).map((p: any) => ({
      product: p,
      bom: bomByProduct.get(p.id) ?? null,
    }));
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter(
          (r) =>
            r.product.name?.toLowerCase().includes(q) ||
            r.product.itemCode?.toLowerCase().includes(q),
        )
      : list;
    // BOMs first, then products without BOM
    return filtered.sort((a, b) => {
      if (!!a.bom !== !!b.bom) return a.bom ? -1 : 1;
      return (a.product.name ?? "").localeCompare(b.product.name ?? "");
    });
  }, [products, bomByProduct, search]);

  const withBomCount = (boms ?? []).length;
  const withoutBomCount = (products ?? []).length - withBomCount;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="w-7 h-7 text-primary" /> Bill of Materials
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Recipes for manufactured products — define materials consumed per batch.
            Admin-only access; manufacturing team uses these recipes to produce batches.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" /> Recipes Defined
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withBomCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Products Without BOM
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withoutBomCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="w-4 h-4" /> Total Products
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(products ?? []).length}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">All Recipes</CardTitle>
            <div className="relative w-72">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search product name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
                data-testid="input-bom-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {bomsLoading ? (
            <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No products found.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Finished Product</TableHead>
                  <TableHead>Item Code</TableHead>
                  <TableHead className="text-right">Output / Batch</TableHead>
                  <TableHead>Materials</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ product, bom }) => (
                  <TableRow key={product.id} data-testid={`row-bom-${product.id}`}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{product.itemCode || "—"}</TableCell>
                    <TableCell className="text-right font-mono">
                      {bom ? `${bom.outputQuantity} ${product.unit ?? ""}` : "—"}
                    </TableCell>
                    <TableCell>
                      {bom && bom.items?.length > 0 ? (
                        <div className="flex flex-wrap gap-1 max-w-[400px]">
                          {bom.items.slice(0, 4).map((it: any) => {
                            const m = productById.get(it.materialProductId);
                            return (
                              <Badge key={it.materialProductId} variant="outline" className="text-xs">
                                {m?.name ?? `#${it.materialProductId}`} · {it.quantity} {it.unit}
                              </Badge>
                            );
                          })}
                          {bom.items.length > 4 && (
                            <Badge variant="outline" className="text-xs">+{bom.items.length - 4} more</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {bom ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Recipe Set</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200">No Recipe</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={bom ? "ghost" : "outline"}
                        onClick={() =>
                          setDialogState({
                            finishedProductId: product.id,
                            finishedProductName: product.name,
                            existingBom: bom,
                          })
                        }
                        data-testid={`button-${bom ? "edit" : "add"}-bom-${product.id}`}
                      >
                        {bom ? <><Pencil className="w-4 h-4 mr-1" /> Edit</> : <><Plus className="w-4 h-4 mr-1" /> Add BOM</>}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <BomDialog
        state={dialogState}
        allProducts={products ?? []}
        allBoms={boms ?? []}
        onClose={() => setDialogState(null)}
      />
    </div>
  );
}
