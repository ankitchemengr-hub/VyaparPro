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
import { Search, Save, X, CheckSquare, Square, Tag, Percent } from "lucide-react";
import { format } from "date-fns";

// Default sale-price margins over Purchase ₹, used whenever a product's own
// Margin % column is left blank. Applied by the "Apply Margin" action below.
// Wholesale is worked out on a GST-exclusive basis: add the margin, then
// divide by (1 + that product's own GST rate) so it lines up with wholesale
// invoices where GST is charged separately on top. These margin % fields are
// independent of the older "Pricing Basis: Fixed Margin" product setting
// (Inventory edit form + raw-material cost cascade), which uses a different
// formula (no GST divide-back on wholesale) — the two don't share values.
const DEFAULT_NON_GST_MARGIN = 10;
const DEFAULT_RETAIL_MARGIN = 15;
const DEFAULT_WHOLESALE_MARGIN = 12;
const DEFAULT_GST_RATE = 18;

// The three sale-price tiers, each pairing its Margin % column with its ₹
// column — drives the stacked one-row-per-tier layout on mobile, mirroring
// the wide table's separate % and ₹ columns.
const PRICE_TIERS: {
  label: string;
  marginField: "nonGstMarginPct" | "retailMarginPct" | "wholesaleMarginPct";
  priceField: "nonGstPrice" | "retailPrice" | "wholesalePrice";
  defaultMargin: number;
}[] = [
  { label: "Wholesale", marginField: "wholesaleMarginPct", priceField: "wholesalePrice", defaultMargin: DEFAULT_WHOLESALE_MARGIN },
  { label: "Retail", marginField: "retailMarginPct", priceField: "retailPrice", defaultMargin: DEFAULT_RETAIL_MARGIN },
  { label: "Non-GST", marginField: "nonGstMarginPct", priceField: "nonGstPrice", defaultMargin: DEFAULT_NON_GST_MARGIN },
];

function marginedPrices(
  purchasePrice: number,
  taxRate: number | null | undefined,
  margins: { nonGstMarginPct: number; retailMarginPct: number; wholesaleMarginPct: number },
) {
  const gstFactor = 1 + (taxRate || DEFAULT_GST_RATE) / 100;
  return {
    nonGstPrice: purchasePrice * (1 + margins.nonGstMarginPct / 100),
    // Retail price is rounded up to the nearest ₹5 so shelf/counter prices
    // land on round numbers instead of odd-looking figures like ₹138.00.
    retailPrice: Math.ceil((purchasePrice * (1 + margins.retailMarginPct / 100)) / 5) * 5,
    wholesalePrice: (purchasePrice * (1 + margins.wholesaleMarginPct / 100)) / gstFactor,
  };
}

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
  manufacturingCost: number | null;
  wholesalePrice: number;
  retailPrice: number;
  nonGstPrice: number | null;
  nonGstMarginPct: number | null;
  retailMarginPct: number | null;
  wholesaleMarginPct: number | null;
  updatedAt?: string;
  createdAt?: string;
};

type EditedRow = {
  purchasePrice: string;
  wholesalePrice: string;
  retailPrice: string;
  nonGstPrice: string;
  nonGstMarginPct: string;
  retailMarginPct: string;
  wholesaleMarginPct: string;
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
  nonGstPrice?: number | null;
  nonGstMarginPct?: number | null;
  retailMarginPct?: number | null;
  wholesaleMarginPct?: number | null;
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
  // Price cells directly typed into (rather than driven by a Margin % edit)
  // are tracked here as "id:field" keys so they stop being recomputed from
  // margins until their matching % cell is touched again.
  const [manualPrice, setManualPrice] = useState<Set<string>>(new Set());

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
      setManualPrice(new Set());
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

  // Margin % cells drive their matching price cell live, not just via the
  // bulk "Apply Margin" button — typing a Wholesale % (say) immediately
  // recomputes Wholesale ₹ for that row from its current Purchase ₹, using
  // the margin just typed. Still only stages the value (highlighted,
  // unsaved) until Save is clicked.
  const MARGIN_TO_PRICE_FIELD: Record<string, "nonGstPrice" | "retailPrice" | "wholesalePrice"> = {
    nonGstMarginPct: "nonGstPrice",
    retailMarginPct: "retailPrice",
    wholesaleMarginPct: "wholesalePrice",
  };
  type MarginField = "nonGstMarginPct" | "retailMarginPct" | "wholesaleMarginPct";
  const PRICE_TO_MARGIN_FIELD: Record<"nonGstPrice" | "retailPrice" | "wholesalePrice", MarginField> = {
    nonGstPrice: "nonGstMarginPct",
    retailPrice: "retailMarginPct",
    wholesalePrice: "wholesaleMarginPct",
  };
  const MARGIN_DEFAULT: Record<MarginField, number> = {
    nonGstMarginPct: DEFAULT_NON_GST_MARGIN,
    retailMarginPct: DEFAULT_RETAIL_MARGIN,
    wholesaleMarginPct: DEFAULT_WHOLESALE_MARGIN,
  };

  // Single source of truth for "what should this price cell show right now",
  // given a specific row's staged edits (purchase price / that column's
  // margin %). Recomputed fresh every time it's called — nothing here is
  // ever read from a value stashed away at some earlier keystroke, so the
  // price can't go stale relative to whatever margin % is on screen.
  const derivePriceField = useCallback((
    rowEdits: Partial<EditedRow> | undefined,
    id: number,
    field: "nonGstPrice" | "retailPrice" | "wholesalePrice",
  ): string | undefined => {
    const original = products.find((p) => p.id === id);
    if (!original) return undefined;
    const stagedPurchase = rowEdits?.purchasePrice;
    const purchasePrice = stagedPurchase !== undefined
      ? numOrNull(stagedPurchase)
      : (original.manufacturingCost ?? original.purchasePrice);
    if (purchasePrice == null || !(purchasePrice > 0)) return undefined;

    const marginField = PRICE_TO_MARGIN_FIELD[field];
    const stagedMargin = rowEdits?.[marginField];
    const marginPct = stagedMargin !== undefined
      ? numOrNull(stagedMargin)
      : (original[marginField] ?? undefined);
    const effectiveMargin = marginPct ?? MARGIN_DEFAULT[marginField];

    const margins = {
      nonGstMarginPct: marginField === "nonGstMarginPct" ? effectiveMargin : DEFAULT_NON_GST_MARGIN,
      retailMarginPct: marginField === "retailMarginPct" ? effectiveMargin : DEFAULT_RETAIL_MARGIN,
      wholesaleMarginPct: marginField === "wholesaleMarginPct" ? effectiveMargin : DEFAULT_WHOLESALE_MARGIN,
    };
    return marginedPrices(purchasePrice, original.taxRate, margins)[field].toFixed(2);
  }, [products]);

  const PRICE_FIELDS = new Set<keyof EditedRow>(["nonGstPrice", "retailPrice", "wholesalePrice"]);

  const setCell = useCallback((id: number, field: keyof EditedRow, value: string) => {
    setEdits((prev) => {
      const rowEdits: Partial<EditedRow> = { ...(prev[id] ?? {}), [field]: value };
      const priceField = MARGIN_TO_PRICE_FIELD[field];
      if (priceField) {
        const computed = derivePriceField(rowEdits, id, priceField);
        if (computed !== undefined) rowEdits[priceField] = computed;
      }
      return { ...prev, [id]: rowEdits };
    });

    const priceField = MARGIN_TO_PRICE_FIELD[field];
    if (priceField) {
      // Typing a Margin % re-links its price cell to the formula, discarding
      // any earlier manual override of that specific ₹ box.
      const key = `${id}:${priceField}`;
      setManualPrice((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : prev));
    } else if (PRICE_FIELDS.has(field)) {
      const key = `${id}:${field}`;
      setManualPrice((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }
  }, [derivePriceField]);

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

  // What actually gets saved for a margin-linked ₹ field: the live formula
  // result (never a possibly-stale staged string), unless the user typed
  // directly into that ₹ box, in which case their exact entry is saved.
  const priceForSave = (id: number, field: "nonGstPrice" | "retailPrice" | "wholesalePrice"): string | undefined => {
    const staged = edits[id]?.[field];
    if (staged === undefined) return undefined;
    return manualPrice.has(`${id}:${field}`) ? staged : (derivePriceField(edits[id], id, field) ?? staged);
  };

  const handleSaveConfirm = () => {
    const updates = dirtyIds.map((id) => {
      const e = edits[id];
      const wholesaleVal = priceForSave(id, "wholesalePrice");
      const retailVal = priceForSave(id, "retailPrice");
      const nonGstVal = priceForSave(id, "nonGstPrice");
      return {
        id,
        purchasePrice: e?.purchasePrice !== undefined ? numOrNull(e.purchasePrice) : undefined,
        wholesalePrice: wholesaleVal !== undefined ? numOrNull(wholesaleVal) : undefined,
        retailPrice: retailVal !== undefined ? numOrNull(retailVal) : undefined,
        nonGstPrice: nonGstVal !== undefined ? (nonGstVal.trim() === "" ? null : numOrNull(nonGstVal)) : undefined,
        nonGstMarginPct: e?.nonGstMarginPct !== undefined ? (e.nonGstMarginPct.trim() === "" ? null : numOrNull(e.nonGstMarginPct)) : undefined,
        retailMarginPct: e?.retailMarginPct !== undefined ? (e.retailMarginPct.trim() === "" ? null : numOrNull(e.retailMarginPct)) : undefined,
        wholesaleMarginPct: e?.wholesaleMarginPct !== undefined ? (e.wholesaleMarginPct.trim() === "" ? null : numOrNull(e.wholesaleMarginPct)) : undefined,
      };
    }).filter((u) => {
      return u.purchasePrice !== undefined || u.wholesalePrice !== undefined ||
        u.retailPrice !== undefined || u.nonGstPrice !== undefined ||
        u.nonGstMarginPct !== undefined || u.retailMarginPct !== undefined || u.wholesaleMarginPct !== undefined;
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
    setManualPrice(new Set());
  };

  // Stages Non-GST/Retail/Wholesale for the selected rows (or every filtered
  // row if nothing's selected) from each row's current Purchase ₹ and its own
  // Margin % columns (falling back to the 10/15/12 defaults when a margin is
  // blank) — using staged edits where present, otherwise the saved value.
  // Only fills the input boxes (still editable, still requires Save) so
  // nothing is written to the catalog until the user reviews and confirms.
  const applyMargins = () => {
    const targets = selected.size > 0 ? filtered.filter((p) => selected.has(p.id)) : filtered;
    if (targets.length === 0) return;
    setEdits((prev) => {
      const next = { ...prev };
      targets.forEach((p) => {
        const rowEdits = prev[p.id];
        const nonGstPrice = derivePriceField(rowEdits, p.id, "nonGstPrice");
        const retailPrice = derivePriceField(rowEdits, p.id, "retailPrice");
        const wholesalePrice = derivePriceField(rowEdits, p.id, "wholesalePrice");
        if (nonGstPrice === undefined && retailPrice === undefined && wholesalePrice === undefined) return;
        next[p.id] = {
          ...(next[p.id] ?? {}),
          ...(nonGstPrice !== undefined && { nonGstPrice }),
          ...(retailPrice !== undefined && { retailPrice }),
          ...(wholesalePrice !== undefined && { wholesalePrice }),
        };
      });
      return next;
    });
    // Apply Margin always recomputes straight from the margins — any earlier
    // manual ₹ overrides on these rows are discarded in favor of the formula.
    setManualPrice((prev) => {
      const next = new Set(prev);
      targets.forEach((p) => {
        (["nonGstPrice", "retailPrice", "wholesalePrice"] as const).forEach((f) => next.delete(`${p.id}:${f}`));
      });
      return next;
    });
    toast({ title: `Margins applied to ${targets.length} product${targets.length !== 1 ? "s" : ""}`, description: "Review the highlighted prices, then Save." });
  };

  const numericCell = (
    id: number,
    field: keyof EditedRow,
    fallback: number | null,
    resolveCurrent?: (staged: string) => string,
    widthClass = "w-28",
  ) => {
    const original = products.find((p) => p.id === id);
    const origVal = String(original?.[field as keyof Product] ?? fallback ?? "");
    const staged = edits[id]?.[field];
    const current = staged === undefined ? String(fallback ?? "") : (resolveCurrent ? resolveCurrent(staged) : staged);
    const isDirty = staged !== undefined && current !== origVal;

    return (
      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">₹</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={current}
          onChange={(e) => setCell(id, field, e.target.value)}
          className={`h-8 pl-6 pr-1 text-right text-sm ${widthClass} ${isDirty ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}
        />
      </div>
    );
  };

  // For a margin-linked ₹ column: once staged, always show the live formula
  // result rather than whatever string happened to be written at the last
  // keystroke — unless the user typed directly into that ₹ box, in which
  // case their manual value sticks until they touch the % cell again.
  const resolveMarginPrice = (id: number, field: "nonGstPrice" | "retailPrice" | "wholesalePrice") =>
    (staged: string) => (manualPrice.has(`${id}:${field}`) ? staged : (derivePriceField(edits[id], id, field) ?? staged));

  const percentCell = (id: number, field: keyof EditedRow, defaultValue: number, widthClass = "w-20") => {
    const original = products.find((p) => p.id === id);
    const savedVal = original?.[field as keyof Product] as number | null | undefined;
    const origVal = String(savedVal ?? "");
    const current = getVal(id, field, savedVal ?? "");
    const isDirty = edits[id]?.[field] !== undefined && current !== origVal;

    return (
      <div className="relative">
        <Input
          type="number"
          step="0.1"
          min="0"
          value={current}
          placeholder={String(defaultValue)}
          onChange={(e) => setCell(id, field, e.target.value)}
          className={`h-8 pl-1 pr-5 text-right text-sm ${widthClass} ${isDirty ? "border-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">%</span>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Tag className="h-5 w-5 text-primary shrink-0" />
          <h1 className="text-xl font-bold">Price List</h1>
          {dirtyIds.length > 0 && (
            <Badge variant="outline" className="text-amber-600 border-amber-400">
              {dirtyIds.length} unsaved change{dirtyIds.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0 sm:overflow-visible">
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={applyMargins}
            title="Uses each product's Non-GST %/Retail %/Wholesale % column (defaults 10/15/12); Wholesale is also ÷ (1 + GST%)"
            data-testid="button-apply-margins"
          >
            <Percent className="h-4 w-4 mr-1 shrink-0" />
            Apply Margin{selected.size > 0 ? ` (${selected.size})` : " (all)"}
          </Button>
          {dirtyIds.length > 0 && (
            <Button variant="outline" size="sm" className="shrink-0" onClick={clearEdits}>
              <X className="h-4 w-4 mr-1 shrink-0" /> Discard
            </Button>
          )}
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => setConfirmOpen(true)}
            disabled={dirtyIds.length === 0 || mutation.isPending}
          >
            <Save className="h-4 w-4 mr-1 shrink-0" />
            {mutation.isPending ? "Saving…" : `Save${dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ""}`}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative w-full sm:flex-1 sm:min-w-48 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={groupFilter} onValueChange={setGroupFilter}>
          <SelectTrigger className="h-9 flex-1 sm:flex-none sm:w-40">
            <SelectValue placeholder="All groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All groups</SelectItem>
            {groups.filter(Boolean).map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={brandFilter} onValueChange={setBrandFilter}>
          <SelectTrigger className="h-9 flex-1 sm:flex-none sm:w-40">
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
        <div className="rounded-lg bg-primary/10 border border-primary/20 px-3 py-2.5 sm:px-4 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          <span className="block text-sm font-medium text-primary mb-2 sm:mb-0">
            {selected.size} selected — bulk edit:
          </span>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            {([
              ["Purchase ₹", "purchasePrice"],
              ["Wholesale ₹", "wholesalePrice"],
              ["Retail ₹", "retailPrice"],
              ["Non-GST ₹", "nonGstPrice"],
            ] as [string, keyof EditedRow][]).map(([label, field]) => (
              <div key={field} className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>
                <Input type="number" step="0.01" min="0" placeholder="—" className="h-7 w-full sm:w-24 text-sm"
                  onChange={(e) => handleBulkEdit(field, e.target.value)} />
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="w-full mt-2 sm:w-auto sm:mt-0 sm:ml-auto" onClick={() => setSelected(new Set())}>
            <X className="h-3.5 w-3.5 mr-1" /> Clear selection
          </Button>
        </div>
      )}

      {/* Mobile: one card per product — the wide table's 9 columns never fit
          a phone, so each product stacks its Purchase ₹ and the three
          Margin % / Price ₹ tier rows instead. */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center justify-between px-1">
          <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="button-select-all-mobile">
            {allFilteredSelected
              ? <CheckSquare className="h-4 w-4 text-primary" />
              : <Square className="h-4 w-4" />}
            {allFilteredSelected ? "Deselect all" : "Select all"}
          </button>
          {selected.size > 0 && (
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          )}
        </div>

        {isLoading && (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">Loading…</div>
        )}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground border rounded-lg">No products found</div>
        )}

        {filtered.map((p) => {
          const isSelected = selected.has(p.id);
          const isDirtyRow = edits[p.id] && Object.keys(edits[p.id]).length > 0;
          return (
            <div
              key={p.id}
              className={`rounded-lg border p-3 ${isSelected ? "bg-primary/5 border-primary/30" : "bg-background"} ${isDirtyRow ? "ring-1 ring-inset ring-amber-300/60" : ""}`}
              data-testid={`price-card-${p.id}`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => setSelected((prev) => {
                    const next = new Set(prev);
                    next.has(p.id) ? next.delete(p.id) : next.add(p.id);
                    return next;
                  })}
                  className="mt-0.5 shrink-0"
                  aria-label={isSelected ? "Deselect" : "Select"}
                >
                  {isSelected
                    ? <CheckSquare className="h-4 w-4 text-primary" />
                    : <Square className="h-4 w-4 text-muted-foreground" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-medium leading-tight">{p.name}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-1.5">
                    {p.itemCode && <span>{p.itemCode}</span>}
                    {p.group && <span>· {p.group}</span>}
                    {p.brand && <span>· {p.brand}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {p.updatedAt || p.createdAt
                    ? format(new Date(p.updatedAt ?? p.createdAt!), "dd MMM yy")
                    : "—"}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Purchase</span>
                {numericCell(p.id, "purchasePrice", p.manufacturingCost ?? p.purchasePrice, undefined, "w-32")}
              </div>
              {p.manufacturingCost != null && edits[p.id]?.purchasePrice === undefined && (
                <div className="text-[10px] text-muted-foreground text-right mt-0.5" data-testid={`hint-manufacturing-cost-mobile-${p.id}`}>
                  Live recipe cost — not yet saved
                </div>
              )}

              <div className="mt-2.5 border-t pt-2 space-y-2">
                <div className="grid grid-cols-[1fr_5rem_8rem] items-center gap-2 text-[11px] text-muted-foreground">
                  <span />
                  <span className="text-center">Margin %</span>
                  <span className="text-center">Price ₹</span>
                </div>
                {PRICE_TIERS.map((tier) => (
                  <div key={tier.priceField} className="grid grid-cols-[1fr_5rem_8rem] items-center gap-2">
                    <span className="text-sm">{tier.label}</span>
                    {percentCell(p.id, tier.marginField, tier.defaultMargin, "w-20")}
                    {numericCell(p.id, tier.priceField, p[tier.priceField], resolveMarginPrice(p.id, tier.priceField), "w-32")}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Table — desktop / tablet only */}
      <div className="hidden md:block border rounded-lg overflow-x-auto">
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
              <th className="text-right px-3 py-2.5 font-semibold w-20" title="Overrides the default 10% used by Apply Margin">Non-GST %</th>
              <th className="text-right px-3 py-2.5 font-semibold w-20" title="Overrides the default 15% used by Apply Margin">Retail %</th>
              <th className="text-right px-3 py-2.5 font-semibold w-20" title="Overrides the default 12% used by Apply Margin">Wholesale %</th>
              <th className="text-left px-3 py-2.5 font-semibold min-w-44">Product</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Purchase ₹</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Wholesale ₹</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Retail ₹</th>
              <th className="text-right px-3 py-2.5 font-semibold w-32">Non-GST ₹</th>
              <th className="text-left px-3 py-2.5 font-semibold w-36 text-muted-foreground text-xs">Last Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">No products found</td></tr>
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
                  <td className="px-3 py-2 text-right">{percentCell(p.id, "nonGstMarginPct", DEFAULT_NON_GST_MARGIN)}</td>
                  <td className="px-3 py-2 text-right">{percentCell(p.id, "retailMarginPct", DEFAULT_RETAIL_MARGIN)}</td>
                  <td className="px-3 py-2 text-right">{percentCell(p.id, "wholesaleMarginPct", DEFAULT_WHOLESALE_MARGIN)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium leading-tight">{p.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex gap-1.5">
                      {p.itemCode && <span>{p.itemCode}</span>}
                      {p.group && <span>· {p.group}</span>}
                      {p.brand && <span>· {p.brand}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {numericCell(p.id, "purchasePrice", p.manufacturingCost ?? p.purchasePrice)}
                    {p.manufacturingCost != null && edits[p.id]?.purchasePrice === undefined && (
                      <div className="text-[10px] text-muted-foreground mt-0.5" data-testid={`hint-manufacturing-cost-${p.id}`}>
                        Live recipe cost — not yet saved
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{numericCell(p.id, "wholesalePrice", p.wholesalePrice, resolveMarginPrice(p.id, "wholesalePrice"))}</td>
                  <td className="px-3 py-2 text-right">{numericCell(p.id, "retailPrice", p.retailPrice, resolveMarginPrice(p.id, "retailPrice"))}</td>
                  <td className="px-3 py-2 text-right">{numericCell(p.id, "nonGstPrice", p.nonGstPrice, resolveMarginPrice(p.id, "nonGstPrice"))}</td>
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
      <p className="text-xs text-muted-foreground">
        <strong>Apply Margin</strong> fills Non-GST, Retail and Wholesale (Wholesale ÷ (1 + that product's GST%)) from Purchase ₹ using each product's own Non-GST %/Retail %/Wholesale % column — defaulting to 10%/15%/12% when left blank. Retail ₹ is rounded up to the nearest ₹5. Still editable afterward, still requires Save.
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
