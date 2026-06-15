import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/use-auth";
import { Redirect } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Search, Save, X, CheckSquare, Square, Tag } from "lucide-react";
import { format } from "date-fns";

type Product = {
  id: number;
  name: string;
  group: string | null;
  brand: string | null;
  itemCode: string | null;
  unit: string | null;
  hsnCode: string | null;
  taxRate: number | null;
  purchasePrice: number;
  wholesalePrice: number;
  retailPrice: number;
  updatedAt?: string;
  createdAt?: string;
};

type EditedRow = {
  purchasePrice: string;
  wholesalePrice: string;
  retailPrice: string;
};

const ALL = "__all__";

async function fetchProducts(): Promise<Product[]> {
  const r = await fetch("/api/products?limit=500");
  if (!r.ok) throw new Error("Failed to load products");
  return r.json();
}

async function fetchGroups(): Promise<string[]> {
  const r = await fetch("/api/products/groups");
  if (!r.ok) return [];
  return r.json();
}

async function fetchBrands(): Promise<string[]> {
  const r = await fetch("/api/products/brands");
  if (!r.ok) return [];
  return r.json();
}

async function bulkUpdatePrices(updates: Array<{
  id: number;
  purchasePrice?: number;
  wholesalePrice?: number;
  retailPrice?: number;
}>) {
  const r = await fetch("/api/products/bulk-price", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error ?? "Failed to save prices");
  }
  return r.json();
}

function numOrNull(s: string): number | undefined {
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

export default function PriceList() {
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState(ALL);
  const [brandFilter, setBrandFilter] = useState(ALL);
  const [edits, setEdits] = useState<Record<number, Partial<EditedRow>>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!hasRole(["admin"])) return <Redirect to="/" />;

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["products"],
    queryFn: fetchProducts,
  });

  const { data: groups = [] } = useQuery<string[]>({
    queryKey: ["product-groups"],
    queryFn: fetchGroups,
  });

  const { data: brands = [] } = useQuery<string[]>({
    queryKey: ["product-brands"],
    queryFn: fetchBrands,
  });

  const mutation = useMutation({
    mutationFn: bulkUpdatePrices,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setEdits({});
      setSelected(new Set());
      toast({ title: `Saved ${data.updated} product${data.updated !== 1 ? "s" : ""}`, description: "Prices updated successfully." });
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (groupFilter !== ALL && p.group !== groupFilter) return false;
      if (brandFilter !== ALL && p.brand !== brandFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !(p.itemCode ?? "").toLowerCase().includes(q) && !(p.brand ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, search, groupFilter, brandFilter]);

  const dirtyIds = useMemo(() => Object.keys(edits).map(Number).filter((id) => {
    const e = edits[id];
    return e && Object.keys(e).length > 0;
  }), [edits]);

  const getVal = (id: number, field: keyof EditedRow, fallback: number | string | null) => {
    return edits[id]?.[field] !== undefined ? edits[id][field]! : String(fallback ?? "");
  };

  const setCell = useCallback((id: number, field: keyof EditedRow, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [field]: value },
    }));
  }, []);

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
    }
  };

  const handleBulkEdit = (field: keyof EditedRow, value: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      selected.forEach((id) => {
        next[id] = { ...(next[id] ?? {}), [field]: value };
      });
      return next;
    });
  };

  const handleSaveConfirm = () => {
    const updates = dirtyIds.map((id) => {
      const e = edits[id];
      return {
        id,
        purchasePrice: e?.purchasePrice !== undefined ? numOrNull(e.purchasePrice) : undefined,
        wholesalePrice: e?.wholesalePrice !== undefined ? numOrNull(e.wholesalePrice) : undefined,
        retailPrice: e?.retailPrice !== undefined ? numOrNull(e.retailPrice) : undefined,
      };
    }).filter((u) => {
      return u.purchasePrice !== undefined || u.wholesalePrice !== undefined ||
        u.retailPrice !== undefined;
    });

    if (updates.length === 0) {
      toast({ title: "No changes to save" });
      setConfirmOpen(false);
      return;
    }

    mutation.mutate(updates);
    setConfirmOpen(false);
  };

  const clearEdits = () => {
    setEdits({});
    setSelected(new Set());
  };

  const numericCell = (id: number, field: keyof EditedRow, fallback: number | null, prefix = "₹") => {
    const original = products.find((p) => p.id === id);
    const origVal = String(original?.[field as keyof Product] ?? fallback ?? "");
    const current = getVal(id, field, fallback);
    const isDirty = edits[id]?.[field] !== undefined && current !== origVal;

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">{prefix}</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={current}
          onChange={(e) => setCell(id, field, e.target.value)}
          className={`h-8 pl-6 pr-1 text-right text-sm w-28 ${isDirty ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}
        />
      </div>
    );
  };

  const textCell = (id: number, field: keyof EditedRow, fallback: string | null) => {
    const original = products.find((p) => p.id === id);
    const origVal = String(original?.[field as keyof Product] ?? fallback ?? "");
    const current = getVal(id, field, fallback);
    const isDirty = edits[id]?.[field] !== undefined && current !== origVal;

    return (
      <Input
        value={current}
        onChange={(e) => setCell(id, field, e.target.value)}
        className={`h-8 text-sm w-24 ${isDirty ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}
      />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Price List</h1>
          {dirtyIds.length > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-400">
              {dirtyIds.length} unsaved change{dirtyIds.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirtyIds.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearEdits}>
              <X className="h-4 w-4 mr-1" /> Discard
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={dirtyIds.length === 0 || mutation.isPending}
          >
            <Save className="h-4 w-4 mr-1" />
            {mutation.isPending ? "Saving…" : `Save${dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="All groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All groups</SelectItem>
            {groups.filter(Boolean).map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="All brands" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All brands</SelectItem>
            {brands.filter(Boolean).map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        {(search || groupFilter !== ALL || brandFilter !== ALL) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setGroupFilter(ALL); setBrandFilter(ALL); }}>
            Clear filters
          </Button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} product{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Bulk edit bar — shown when rows are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-primary/10 border border-primary/20 flex-wrap">
          <span className="text-sm font-medium text-primary">{selected.size} selected — bulk edit:</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Purchase ₹</span>
            <Input type="number" step="0.01" min="0" placeholder="—" className="h-7 w-24 text-sm"
              onChange={(e) => handleBulkEdit("purchasePrice", e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Wholesale ₹</span>
            <Input type="number" step="0.01" min="0" placeholder="—" className="h-7 w-24 text-sm"
              onChange={(e) => handleBulkEdit("wholesalePrice", e.target.value)} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Retail ₹</span>
            <Input type="number" step="0.01" min="0" placeholder="—" className="h-7 w-24 text-sm"
              onChange={(e) => handleBulkEdit("retailPrice", e.target.value)} />
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear selection
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="w-10 px-3 py-2.5 text-center">
                <button onClick={toggleSelectAll} className="inline-flex items-center">
                  {allFilteredSelected
                    ? <CheckSquare className="h-4 w-4 text-primary" />
                    : <Square className="h-4 w-4 text-muted-foreground" />}
                </button>
              </th>
              <th className="text-left px-3 py-2.5 font-semibold min-w-44">Product</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Purchase ₹</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Wholesale ₹</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Retail ₹</th>
              <th className="text-left px-3 py-2.5 font-semibold w-36 text-muted-foreground text-xs">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">No products found</td></tr>
            )}
            {filtered.map((p, idx) => {
              const isSelected = selected.has(p.id);
              const isDirtyRow = edits[p.id] && Object.keys(edits[p.id]).length > 0;

              return (
                <tr
                  key={p.id}
                  className={`border-b last:border-0 transition-colors ${isSelected ? "bg-primary/5" : idx % 2 === 0 ? "bg-background" : "bg-muted/20"} ${isDirtyRow ? "ring-1 ring-inset ring-amber-300/50" : ""}`}
                >
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => setSelected((prev) => {
                        const next = new Set(prev);
                        next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                        return next;
                      })}
                      className="inline-flex items-center"
                    >
                      {isSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-1.5">
                      {p.itemCode && <span>{p.itemCode}</span>}
                      {p.group && <span>· {p.group}</span>}
                      {p.brand && <span>· {p.brand}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">{numericCell(p.id, "purchasePrice", p.purchasePrice)}</td>
                  <td className="px-3 py-2 text-right">{numericCell(p.id, "wholesalePrice", p.wholesalePrice)}</td>
                  <td className="px-3 py-2 text-right">{numericCell(p.id, "retailPrice", p.retailPrice)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {p.updatedAt || p.createdAt
                      ? format(new Date(p.updatedAt ?? p.createdAt!), "dd MMM yyyy")
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="inline-block w-3 h-3 bg-amber-400/30 border border-amber-400 rounded-sm mr-1.5 align-middle" />
        Highlighted cells have unsaved changes. Click <strong>Save</strong> to apply to your company's catalog, inventory, and future invoices.
        Existing invoices are not affected.
      </p>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update pricing for all selected products?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                You are about to update prices for <strong>{dirtyIds.length} product{dirtyIds.length !== 1 ? "s" : ""}</strong>.
              </p>
              <p>
                Changes will apply to <strong>your company's product catalog, inventory rates, and all future invoices</strong>.
                Existing invoices and past transactions will not be affected.
              </p>
              <p className="font-medium text-foreground">This applies only to {user?.name ?? "your company"} and cannot affect other companies.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveConfirm}>
              Yes, update {dirtyIds.length} product{dirtyIds.length !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
