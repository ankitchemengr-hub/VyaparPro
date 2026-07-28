import React, { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  useListPurchases,
  useCreatePurchase,
  useUpdatePurchase,
  useDeletePurchase,
  useGetPurchase,
  useListEntities,
  useCreateEntity,
  useListProducts,
  useCreateProduct,
  useListBrandMaster,
  useCreateBrand,
  getListPurchasesQueryKey,
  getGetPurchaseQueryKey,
  getListProductsQueryKey,
  getListEntitiesQueryKey,
  getListBrandMasterQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Truck, Plus, Trash2, Loader2, FileText, Save, UserPlus, Pencil, ChevronsUpDown, Check,
  Paperclip, BarChart2, Download, Eye, File as FileIcon, X, FileImage,
} from "lucide-react";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

function ProductCombobox({
  products,
  value,
  onChange,
  testId,
}: {
  products: any[];
  value: number | null;
  onChange: (id: string) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  const trimmedQuery = query.trim();
  const filtered = trimmedQuery
    ? products.filter((p) => p.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : products;
  const exactMatch = products.some((p) => p.name.toLowerCase() === trimmedQuery.toLowerCase());

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="min-w-[180px] justify-between font-normal"
          data-testid={testId}
        >
          <span className="truncate">{selected ? selected.name : "Pick product"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search product…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-60">
            {filtered.length === 0 && (
              <CommandEmpty className="py-2 px-3 text-sm text-muted-foreground">No product found.</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onChange(String(p.id));
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")}
                  />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmedQuery && !exactMatch && (
              <CommandGroup>
                <CommandItem onSelect={() => { setOpen(false); setQuickAddOpen(true); }}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add "{trimmedQuery}" as new product
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <QuickAddProductDialog
      open={quickAddOpen}
      onOpenChange={setQuickAddOpen}
      initialName={trimmedQuery}
      onCreated={(created) => {
        onChange(String(created.id));
        setQuery("");
      }}
    />
    </>
  );
}

// Lightweight duplicate of Inventory's BrandCombobox — lets a brand be added
// inline from here too, since a product created mid-purchase often needs a
// brand that doesn't exist yet either.
function BrandCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: brands, isError: brandsFailedToLoad } = useListBrandMaster();
  const queryClient = useQueryClient();
  const createBrand = useCreateBrand();
  const { toast } = useToast();
  const list = brands ?? [];
  const trimmedQuery = query.trim();
  const filtered = trimmedQuery
    ? list.filter((b) => b.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : list;
  const exactMatch = list.some((b) => b.name.toLowerCase() === trimmedQuery.toLowerCase());

  const handleCreate = () => {
    if (!trimmedQuery) return;
    createBrand.mutate(
      { data: { name: trimmedQuery } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListBrandMasterQueryKey() });
          onChange(created.name);
          setOpen(false);
          setQuery("");
        },
        onError: (err: any) => {
          toast({ title: "Failed to add brand", description: err?.message ?? "Server error", variant: "destructive" });
        },
      },
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          type="button"
          className="w-full justify-between font-normal"
          data-testid="input-quick-add-brand"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || "Select brand"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search or add brand…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-60">
            {brandsFailedToLoad && (
              <p className="py-2 px-3 text-xs text-destructive">Couldn't load brands — you can still type a new one below.</p>
            )}
            {filtered.length === 0 && (
              <CommandEmpty className="py-2 px-3 text-sm text-muted-foreground">No brand found.</CommandEmpty>
            )}
            <CommandGroup>
              {filtered.map((b) => (
                <CommandItem key={b.id} value={b.name} onSelect={() => { onChange(b.name); setOpen(false); setQuery(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === b.name ? "opacity-100" : "opacity-0")} />
                  {b.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmedQuery && !exactMatch && (
              <CommandGroup>
                <CommandItem onSelect={handleCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add "{trimmedQuery}" as new brand
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function suggestItemCode(name: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9\s-]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, 3).map((w) => (/\d/.test(w) ? w : w.slice(0, 3))).join("-");
}

// Quick-add a brand-new product without leaving the Purchase form. Only the
// fields the product schema actually requires (name/group/brand/itemCode/
// unit/purchasePrice/retailPrice/wholesalePrice/mrp) — sale prices default to
// sane margins over purchase price and stay editable, since a purchase alone
// doesn't tell us what this should sell for.
function QuickAddProductDialog({
  open, onOpenChange, initialName, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialName: string;
  onCreated: (product: any) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateProduct();
  const [name, setName] = useState(initialName);
  const [itemCode, setItemCode] = useState("");
  const [itemCodeAuto, setItemCodeAuto] = useState(true);
  const [brand, setBrand] = useState("");
  const [group, setGroup] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [taxRate, setTaxRate] = useState("18");
  const [purchasePrice, setPurchasePrice] = useState("0");
  const [retailPrice, setRetailPrice] = useState("0");
  const [wholesalePrice, setWholesalePrice] = useState("0");
  const [mrp, setMrp] = useState("0");
  const [priceEdited, setPriceEdited] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setItemCode(suggestItemCode(initialName));
      setItemCodeAuto(true);
      setBrand(""); setGroup(""); setUnit("pcs"); setTaxRate("18");
      setPurchasePrice("0"); setRetailPrice("0"); setWholesalePrice("0"); setMrp("0");
      setPriceEdited(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (itemCodeAuto) setItemCode(suggestItemCode(name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, itemCodeAuto]);

  // Suggest sale prices from purchase price with typical margins, until the
  // user edits one of them directly.
  useEffect(() => {
    if (priceEdited) return;
    const p = Number(purchasePrice) || 0;
    setRetailPrice(p > 0 ? (p * 1.15).toFixed(2) : "0");
    setWholesalePrice(p > 0 ? (p * 1.10).toFixed(2) : "0");
    setMrp(p > 0 ? (p * 1.25).toFixed(2) : "0");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchasePrice, priceEdited]);

  const canSave = name.trim() && itemCode.trim() && brand.trim() && group.trim() && unit.trim() && !create.isPending;

  const handleSave = () => {
    create.mutate(
      {
        data: {
          name: name.trim(),
          itemCode: itemCode.trim(),
          brand: brand.trim(),
          group: group.trim(),
          unit: unit.trim(),
          taxRate: Number(taxRate) || 0,
          purchasePrice: Number(purchasePrice) || 0,
          retailPrice: Number(retailPrice) || 0,
          wholesalePrice: Number(wholesalePrice) || 0,
          mrp: Number(mrp) || 0,
        },
      },
      {
        onSuccess: (created) => {
          // NewPurchaseTab/HistoryTab's edit dialog all call useListProducts({}) —
          // match that exact key so the new product is visible in this line's
          // picker immediately, not just after the invalidate below settles.
          queryClient.setQueryData(getListProductsQueryKey({}), (old: any[] | undefined) => [...(old ?? []), created]);
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product added" });
          onCreated(created);
          onOpenChange(false);
        },
        onError: async (err: any) => {
          let desc = err?.message ?? "Server error";
          try {
            const body = err?.response ? await err.response.json() : null;
            if (body?.error) desc = String(body.error).slice(0, 300);
          } catch {}
          toast({ title: "Could not add product", description: desc, variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Add Product</DialogTitle>
          <DialogDescription>
            Adds this straight to your catalog so you can pick it in this purchase. You can fill in the rest (image, stock threshold, etc.) later in Inventory.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="input-quick-add-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Brand *</Label>
              <BrandCombobox value={brand} onChange={setBrand} />
            </div>
            <div>
              <Label>Group / Category *</Label>
              <Input value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Engine Oil" data-testid="input-quick-add-group" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Unit *</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. Ltr, Box, Pcs" data-testid="input-quick-add-unit" />
            </div>
            <div>
              <Label>Item Code *</Label>
              <Input
                value={itemCode}
                onChange={(e) => { setItemCode(e.target.value); setItemCodeAuto(false); }}
                data-testid="input-quick-add-item-code"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Purchase Price (₹) *</Label>
              <Input type="number" min="0" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} data-testid="input-quick-add-purchase-price" />
            </div>
            <div>
              <Label>Tax Rate (%)</Label>
              <Input type="number" min="0" max="100" step="0.5" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Retail Price *</Label>
              <Input type="number" min="0" step="0.01" value={retailPrice} onChange={(e) => { setRetailPrice(e.target.value); setPriceEdited(true); }} />
            </div>
            <div>
              <Label className="text-xs">Wholesale Price *</Label>
              <Input type="number" min="0" step="0.01" value={wholesalePrice} onChange={(e) => { setWholesalePrice(e.target.value); setPriceEdited(true); }} />
            </div>
            <div>
              <Label className="text-xs">MRP *</Label>
              <Input type="number" min="0" step="0.01" value={mrp} onChange={(e) => { setMrp(e.target.value); setPriceEdited(true); }} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Sale prices are suggested from purchase price — adjust if needed.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave} data-testid="button-save-quick-add-product">
            {create.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Add Product
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function lineAmount(l: Line, isGst: boolean): number {
  const qty = Number(l.qty) || 0;
  const rate = Number(l.rate) || 0;
  const disc = Number(l.discountPct) || 0;
  const taxPct = isGst ? Number(l.taxPct) || 0 : 0;
  const base = qty * rate;
  const taxable = base - (base * disc / 100);
  return taxable + (taxable * taxPct / 100);
}

// Back-solves Rate from a directly-typed Amount, holding Qty/Disc%/GST% fixed
// — Amount itself is never stored, it's always qty*rate net of discount/tax,
// so "editing" it just means picking the rate that reproduces that total.
function rateForAmount(l: Line, isGst: boolean, amount: number): number | null {
  const qty = Number(l.qty) || 0;
  const disc = Number(l.discountPct) || 0;
  const taxPct = isGst ? Number(l.taxPct) || 0 : 0;
  const denom = qty * (1 - disc / 100) * (1 + taxPct / 100);
  if (!(denom > 0) || Number.isNaN(amount)) return null;
  return amount / denom;
}

// Renders purchase line items as a table on tablet/desktop and as stacked
// cards on mobile, so entry never requires horizontal scrolling on a phone.
function LineItemsEditor({
  lines,
  isGst,
  products,
  onPickProduct,
  onUpdateLine,
  onRemoveLine,
  testIdPrefix,
}: {
  lines: Line[];
  isGst: boolean;
  products: any[];
  onPickProduct: (i: number, v: string) => void;
  onUpdateLine: (i: number, patch: Partial<Line>) => void;
  onRemoveLine: (i: number) => void;
  testIdPrefix?: string;
}) {
  // Raw text of an in-progress Amount edit, keyed by row — kept separate from
  // the derived display value so mid-typing digits aren't reformatted out
  // from under the cursor; cleared on blur once the rate has been solved for.
  const [amountDrafts, setAmountDrafts] = useState<Record<number, string>>({});

  const handleAmountChange = (i: number, raw: string) => {
    setAmountDrafts((prev) => ({ ...prev, [i]: raw }));
    const newRate = rateForAmount(lines[i], isGst, Number(raw));
    if (newRate != null) onUpdateLine(i, { rate: String(newRate) });
  };
  const clearAmountDraft = (i: number) =>
    setAmountDrafts((prev) => {
      const next = { ...prev };
      delete next[i];
      return next;
    });

  return (
    <>
      {/* Tablet/desktop: table */}
      <div className="hidden sm:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4 min-w-[200px]">Product</TableHead>
              <TableHead className="w-24 text-right">Qty</TableHead>
              <TableHead className="w-20">Unit</TableHead>
              <TableHead className="w-28 text-right">Rate (₹)</TableHead>
              <TableHead className="w-20 text-right">Disc%</TableHead>
              {isGst && <TableHead className="w-20 text-right">GST%</TableHead>}
              <TableHead className="w-28 text-right">Amount</TableHead>
              <TableHead className="w-12 pr-4"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i} data-testid={testIdPrefix ? `${testIdPrefix}-${i}` : undefined}>
                <TableCell className="pl-4">
                  <ProductCombobox
                    products={products}
                    value={l.productId}
                    onChange={(v) => onPickProduct(i, v)}
                    testId={testIdPrefix ? `select-product-${i}` : undefined}
                  />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" min="0" step="1"
                    value={l.qty} onChange={(e) => onUpdateLine(i, { qty: e.target.value })}
                    className="w-20 text-right ml-auto" data-testid={testIdPrefix ? `input-qty-${i}` : undefined} />
                </TableCell>
                <TableCell>
                  <Input value={l.unit} onChange={(e) => onUpdateLine(i, { unit: e.target.value })} className="w-16" />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" min="0" step="0.01"
                    value={l.rate} onChange={(e) => onUpdateLine(i, { rate: e.target.value })}
                    className="w-24 text-right ml-auto" data-testid={testIdPrefix ? `input-rate-${i}` : undefined} />
                </TableCell>
                <TableCell className="text-right">
                  <Input type="number" min="0" max="100" step="0.1"
                    value={l.discountPct} onChange={(e) => onUpdateLine(i, { discountPct: e.target.value })}
                    className="w-16 text-right ml-auto" />
                </TableCell>
                {isGst && (
                  <TableCell className="text-right">
                    <Input type="number" min="0" max="100" step="0.5"
                      value={l.taxPct} onChange={(e) => onUpdateLine(i, { taxPct: e.target.value })}
                      className="w-16 text-right ml-auto" />
                  </TableCell>
                )}
                <TableCell className="text-right pr-4">
                  <Input
                    type="number" min="0" step="0.01"
                    value={amountDrafts[i] ?? lineAmount(l, isGst).toFixed(2)}
                    onChange={(e) => handleAmountChange(i, e.target.value)}
                    onBlur={() => clearAmountDraft(i)}
                    className="w-28 text-right ml-auto tabular-nums font-semibold"
                    data-testid={testIdPrefix ? `input-amount-${i}` : undefined}
                  />
                </TableCell>
                <TableCell className="pr-4">
                  <Button size="icon" variant="ghost" onClick={() => onRemoveLine(i)}
                    data-testid={testIdPrefix ? `button-remove-line-${i}` : undefined}>
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards, no horizontal scroll */}
      <div className="sm:hidden divide-y">
        {lines.map((l, i) => (
          <div key={i} className="p-4 space-y-3" data-testid={testIdPrefix ? `${testIdPrefix}-mobile-${i}` : undefined}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <ProductCombobox products={products} value={l.productId} onChange={(v) => onPickProduct(i, v)} />
              </div>
              <Button size="icon" variant="ghost" className="shrink-0" onClick={() => onRemoveLine(i)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Qty</Label>
                <Input type="number" min="0" step="1" value={l.qty} onChange={(e) => onUpdateLine(i, { qty: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Unit</Label>
                <Input value={l.unit} onChange={(e) => onUpdateLine(i, { unit: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Rate (₹)</Label>
                <Input type="number" min="0" step="0.01" value={l.rate} onChange={(e) => onUpdateLine(i, { rate: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Discount %</Label>
                <Input type="number" min="0" max="100" step="0.1" value={l.discountPct} onChange={(e) => onUpdateLine(i, { discountPct: e.target.value })} />
              </div>
            </div>
            {isGst && (
              <div className="space-y-1 w-1/2 pr-1">
                <Label className="text-xs text-muted-foreground">GST %</Label>
                <Input type="number" min="0" max="100" step="0.5" value={l.taxPct} onChange={(e) => onUpdateLine(i, { taxPct: e.target.value })} />
              </div>
            )}
            <div className="flex items-center justify-between gap-2 pt-2 border-t">
              <Label className="text-sm text-muted-foreground shrink-0">Amount (₹)</Label>
              <Input
                type="number" min="0" step="0.01"
                value={amountDrafts[i] ?? lineAmount(l, isGst).toFixed(2)}
                onChange={(e) => handleAmountChange(i, e.target.value)}
                onBlur={() => clearAmountDraft(i)}
                className="w-32 text-right font-bold tabular-nums"
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// sessionStorage key the Smart Order page writes to before navigating here
// with "Create Purchase" — see artifacts/frontend/src/pages/smart-order.tsx.
const SMART_ORDER_PREFILL_KEY = "smart_order_prefill";

export default function Purchases() {
  const [tab, setTab] = useState("new");
  const [smartOrderPrefill, setSmartOrderPrefill] = useState<{ productId: number; qty: number } | null>(() => {
    try {
      const raw = sessionStorage.getItem(SMART_ORDER_PREFILL_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const consumePrefill = () => {
    setSmartOrderPrefill(null);
    try {
      sessionStorage.removeItem(SMART_ORDER_PREFILL_KEY);
    } catch {
      /* ignore storage failures */
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Purchases</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full max-w-sm grid-cols-2">
          <TabsTrigger value="new" data-testid="tab-new-purchase">New Purchase</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-purchase-history">Purchase History</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-6">
          <NewPurchaseTab
            prefill={smartOrderPrefill}
            onConsumePrefill={consumePrefill}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          <HistoryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------- NEW PURCHASE ----------------------------

type Line = {
  productId: number | null;
  productName: string;
  unit: string;
  qty: string;
  rate: string;
  discountPct: string;
  taxPct: string;
};

function emptyLine(): Line {
  return {
    productId: null,
    productName: "",
    unit: "pcs",
    qty: "1",
    rate: "0",
    discountPct: "0",
    taxPct: "18",
  };
}

function NewPurchaseTab({
  prefill, onConsumePrefill,
}: {
  prefill?: { productId: number; qty: number } | null;
  onConsumePrefill?: () => void;
} = {}) {
  const { data: vendors } = useListEntities({ type: "vendor" });
  const { data: products } = useListProducts({});
  const create = useCreatePurchase();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [vendorId, setVendorId] = useState<string>("");
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [vendorBillNo, setVendorBillNo] = useState("");
  const [billType, setBillType] = useState<"gst" | "non_gst">("gst");
  const [placeOfSupply, setPlaceOfSupply] = useState("Maharashtra");
  const [billDate, setBillDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [freight, setFreight] = useState("0");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [savedPurchaseId, setSavedPurchaseId] = useState<number | null>(null);

  const productMap = useMemo(() => {
    const m = new Map<number, any>();
    (products ?? []).forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

  // Smart Order handoff — drop the suggested product+qty into the form. If
  // the only line so far is the untouched default, replace it; otherwise
  // append, so an in-progress purchase isn't clobbered.
  useEffect(() => {
    if (!prefill || !products) return;
    const p = productMap.get(prefill.productId);
    if (!p) return;
    const newLine: Line = {
      productId: p.id,
      productName: p.name,
      unit: p.unit ?? "pcs",
      qty: String(prefill.qty),
      rate: String(p.purchasePrice ?? p.retailPrice ?? p.wholesalePrice ?? 0),
      discountPct: "0",
      taxPct: String(p.taxRate ?? p.taxPct ?? p.gstPct ?? 18),
    };
    setLines((prev) => {
      const isBlankDefault = prev.length === 1 && prev[0].productId == null;
      return isBlankDefault ? [newLine] : [...prev, newLine];
    });
    onConsumePrefill?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, products]);

  const isInterstate = placeOfSupply !== "Maharashtra";
  const isGst = billType === "gst";

  const totals = useMemo(() => {
    let subtotal = 0, totalTax = 0, totalDiscount = 0;
    lines.forEach((l) => {
      const qty = Number(l.qty) || 0;
      const rate = Number(l.rate) || 0;
      const discPct = Number(l.discountPct) || 0;
      const taxPct = isGst ? Number(l.taxPct) || 0 : 0;
      const base = qty * rate;
      const disc = base * discPct / 100;
      const taxable = base - disc;
      const tax = taxable * taxPct / 100;
      subtotal += taxable;
      totalDiscount += disc;
      totalTax += tax;
    });
    const fr = Number(freight) || 0;
    const grand = subtotal + totalTax + fr;
    const roundOff = Math.round(grand) - grand;
    return { subtotal, totalTax, totalDiscount, freight: fr, grand, roundOff, finalTotal: Math.round(grand) };
  }, [lines, freight, isGst]);

  const updateLine = (i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  const onPickProduct = (i: number, pid: string) => {
    const p = productMap.get(Number(pid));
    if (!p) return;
    updateLine(i, {
      productId: p.id,
      productName: p.name,
      unit: p.unit ?? "pcs",
      rate: String(p.purchasePrice ?? p.retailPrice ?? p.wholesalePrice ?? 0),
      taxPct: String(p.taxRate ?? p.taxPct ?? p.gstPct ?? 18),
    });
  };

  const removeLine = (i: number) => {
    setLines((prev) => prev.length === 1 ? [emptyLine()] : prev.filter((_, idx) => idx !== i));
  };

  const valid = lines.every((l) => l.productId != null && Number(l.qty) > 0 && Number(l.rate) >= 0);

  const onSubmit = async () => {
    if (!valid) {
      toast({ title: "Incomplete line items", description: "Pick a product and enter quantity for each line.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const vendor = vendorId ? (vendors ?? []).find((v: any) => String(v.id) === vendorId) : null;
      const newPurchase: any = await create.mutateAsync({
        data: {
          billType,
          billDate: new Date(billDate).toISOString(),
          vendorBillNo: vendorBillNo || undefined,
          vendorId: vendor ? vendor.id : undefined,
          vendorName: vendor?.name,
          vendorGstin: vendor?.gstin ?? undefined,
          placeOfSupply,
          notes: notes || undefined,
          freight: Number(freight) || 0,
          roundOff: totals.roundOff,
          items: lines.map((l) => ({
            productId: l.productId!,
            qty: Number(l.qty),
            unit: l.unit,
            rate: Number(l.rate),
            discountPct: Number(l.discountPct) || 0,
            taxPct: isGst ? (Number(l.taxPct) || 0) : 0,
          })),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() }),
      ]);
      setSavedPurchaseId(newPurchase.id);
      toast({ title: "Purchase saved", description: `Bill recorded. Stock updated, vendor payable booked.` });
      setLines([emptyLine()]);
      setVendorBillNo("");
      setNotes("");
      setFreight("0");
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({ title: "Purchase failed", description: desc, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl">
      {/* ── Bill Details ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bill Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Vendor</Label>
              <div className="flex gap-2">
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger data-testid="select-vendor" className="flex-1">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {(vendors ?? []).length === 0 && (
                      <div className="px-2 py-3 text-sm text-muted-foreground">No vendors yet. Click + to add one.</div>
                    )}
                    {(vendors ?? []).map((v: any) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.name}{v.mobile ? ` · ${v.mobile}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="icon" onClick={() => setVendorDialogOpen(true)}
                  data-testid="button-add-vendor" title="Add new vendor">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Vendor Bill #</Label>
              <Input placeholder="e.g. SUP/2026/119" value={vendorBillNo}
                onChange={(e) => setVendorBillNo(e.target.value)} data-testid="input-vendor-bill-no" />
            </div>

            <div className="space-y-1.5">
              <Label>Bill Date</Label>
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} data-testid="input-bill-date" />
            </div>

            <div className="space-y-1.5">
              <Label>Bill Type</Label>
              <Select value={billType} onValueChange={(v) => setBillType(v as any)}>
                <SelectTrigger data-testid="select-bill-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gst">GST</SelectItem>
                  <SelectItem value="non_gst">Non-GST</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Place of Supply</Label>
              <Input value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} />
            </div>
          </div>
          {isInterstate && (
            <p className="text-xs text-amber-600 mt-2">⚠ Non-Maharashtra — IGST will apply instead of CGST + SGST.</p>
          )}
        </CardContent>
      </Card>

      {/* ── Line Items ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Line Items</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])} data-testid="button-add-line">
              <Plus className="w-4 h-4 mr-1" /> Add Line
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <LineItemsEditor
            lines={lines}
            isGst={isGst}
            products={products ?? []}
            onPickProduct={onPickProduct}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
            testIdPrefix="line"
          />
        </CardContent>
      </Card>

      {/* ── Freight, Notes, Summary, Save ── */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Freight / Other Charges (₹)</Label>
              <Input type="number" min="0" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks…" />
            </div>
          </div>

          {/* Summary row */}
          <div className="rounded-lg bg-muted/50 border px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm">
            <div className="flex gap-1.5">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="tabular-nums font-medium">₹{totals.subtotal.toFixed(2)}</span>
            </div>
            {totals.totalDiscount > 0 && (
              <div className="flex gap-1.5">
                <span className="text-muted-foreground">Discount:</span>
                <span className="tabular-nums text-destructive">−₹{totals.totalDiscount.toFixed(2)}</span>
              </div>
            )}
            {isGst && totals.totalTax > 0 && (
              isInterstate
                ? <div className="flex gap-1.5"><span className="text-muted-foreground">IGST:</span><span className="tabular-nums">₹{totals.totalTax.toFixed(2)}</span></div>
                : <>
                    <div className="flex gap-1.5"><span className="text-muted-foreground">CGST:</span><span className="tabular-nums">₹{(totals.totalTax/2).toFixed(2)}</span></div>
                    <div className="flex gap-1.5"><span className="text-muted-foreground">SGST:</span><span className="tabular-nums">₹{(totals.totalTax/2).toFixed(2)}</span></div>
                  </>
            )}
            {totals.freight > 0 && (
              <div className="flex gap-1.5">
                <span className="text-muted-foreground">Freight:</span>
                <span className="tabular-nums">₹{totals.freight.toFixed(2)}</span>
              </div>
            )}
            {Math.abs(totals.roundOff) > 0.001 && (
              <div className="flex gap-1.5">
                <span className="text-muted-foreground">Round Off:</span>
                <span className="tabular-nums">{totals.roundOff > 0 ? "+" : ""}₹{totals.roundOff.toFixed(2)}</span>
              </div>
            )}
            <div className="w-full sm:w-auto sm:ml-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4">
              <div className="text-center sm:text-left">
                <span className="text-muted-foreground mr-1.5">Grand Total:</span>
                <span className="text-xl font-bold tabular-nums" data-testid="text-grand-total">₹{totals.finalTotal.toFixed(2)}</span>
              </div>
              <Button
                disabled={!valid || submitting}
                onClick={onSubmit}
                data-testid="button-save-purchase"
                size="lg"
                className="w-full sm:w-auto"
              >
                {submitting
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                  : <><Save className="w-4 h-4 mr-2" /> Save Purchase</>}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AddVendorDialog
        open={vendorDialogOpen}
        onOpenChange={setVendorDialogOpen}
        onCreated={(v) => setVendorId(String(v.id))}
      />

      {savedPurchaseId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="w-4 h-4" />
              Attachments — Bill #{savedPurchaseId}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AttachmentsSection purchaseId={savedPurchaseId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AddVendorDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (vendor: any) => void;
}) {
  const createEntity = useCreateEntity();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [gstin, setGstin] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Maharashtra");
  const [address, setAddress] = useState("");

  const reset = () => {
    setName(""); setMobile(""); setGstin(""); setCity(""); setState("Maharashtra"); setAddress("");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !mobile.trim()) {
      toast({ title: "Name and mobile are required", variant: "destructive" });
      return;
    }
    if (!/^\d{10}$/.test(mobile.trim())) {
      toast({ title: "Invalid mobile number", description: "Mobile must be exactly 10 digits", variant: "destructive" });
      return;
    }
    try {
      const created = await createEntity.mutateAsync({
        data: {
          type: "vendor",
          name: name.trim(),
          mobile: mobile.trim(),
          gstin: gstin.trim() || undefined,
          city: city.trim() || undefined,
          state: state.trim() || undefined,
          address: address.trim() || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
      onCreated(created);
      toast({ title: "Vendor added", description: `${created.name} is now available.` });
      reset();
      onOpenChange(false);
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({ title: "Could not add vendor", description: desc, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Vendor</DialogTitle>
          <DialogDescription>
            Quick-add a supplier to use on this purchase bill.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Plastics Pvt Ltd"
                data-testid="input-new-vendor-name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Mobile <span className="text-destructive">*</span></Label>
              <Input
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9999900001"
                inputMode="numeric"
                maxLength={10}
                data-testid="input-new-vendor-mobile"
              />
            </div>
            <div className="space-y-2">
              <Label>GSTIN</Label>
              <Input
                value={gstin}
                onChange={(e) => setGstin(e.target.value)}
                placeholder="27AAACA1234A1Z5"
                data-testid="input-new-vendor-gstin"
              />
            </div>
            <div className="space-y-2">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Address</Label>
              <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={createEntity.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createEntity.isPending} data-testid="button-submit-new-vendor">
              {createEntity.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
                : <><UserPlus className="w-4 h-4 mr-2" /> Add Vendor</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SumRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">₹{value.toFixed(2)}</span>
    </div>
  );
}

// ------------------------------ ATTACHMENTS SECTION ------------------------------

interface Attachment {
  id: number;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  available: boolean;
}

function AttachmentsSection({ purchaseId }: { purchaseId: number }) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  // Previewed in-app instead of navigating to the file URL — on a phone with
  // this app added to the home screen, target="_blank"/full navigation to a
  // PDF/image hands off to the OS's native viewer, and its back button has no
  // app history to return to, so it looks like the whole app was closed.
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const loadAttachments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/attachments`);
      if (res.ok) setAttachments(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAttachments(); }, [purchaseId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    setUploading(true);
    const form = new FormData();
    Array.from(e.target.files).forEach((f) => form.append("files", f));
    try {
      const res = await fetch(`/api/purchases/${purchaseId}/attachments`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast({ title: "Upload failed", description: body.error ?? "Unknown error", variant: "destructive" });
      } else {
        await loadAttachments();
        toast({ title: "Files uploaded", description: "Attachments saved successfully." });
      }
    } catch {
      toast({ title: "Upload failed", description: "Network error", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/purchases/attachments/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAttachments((prev) => prev.filter((a) => a.id !== id));
        toast({ title: "Attachment deleted" });
      } else {
        toast({ title: "Delete failed", variant: "destructive" });
      }
    } finally {
      setDeletingId(null);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {loading ? "Loading…" : `${attachments.length} file(s) attached`}
        </span>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Paperclip className="w-4 h-4 mr-1" />}
          {uploading ? "Uploading…" : "Attach File"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".jpg,.jpeg,.png,.pdf"
          className="hidden"
          onChange={handleUpload}
        />
      </div>
      {attachments.length === 0 && !loading && (
        <p className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded">
          No attachments. Click "Attach File" to upload JPG, PNG, or PDF files.
        </p>
      )}
      <div className="space-y-2">
        {attachments.map((a) => (
          <div key={a.id} className={`flex items-center gap-2 p-2 border rounded-md ${a.available ? "bg-muted/30" : "bg-destructive/5 border-dashed"}`}>
            {a.mimeType.startsWith("image/") ? (
              <FileImage className={`w-5 h-5 shrink-0 ${a.available ? "text-blue-500" : "text-muted-foreground"}`} />
            ) : (
              <FileIcon className={`w-5 h-5 shrink-0 ${a.available ? "text-red-500" : "text-muted-foreground"}`} />
            )}
            <div className="flex-1 min-w-0">
              <span className="text-sm truncate block" title={a.originalName}>{a.originalName}</span>
              {!a.available && (
                <span className="text-xs text-destructive">Unavailable — delete and re-upload</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground shrink-0">{formatSize(a.fileSize)}</span>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setPreviewAttachment(a)}
              title={a.available ? "View" : "Unavailable"}
              disabled={!a.available}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
            {a.available ? (
              <a href={`/api/purchases/attachments/${a.id}/file`} download={a.originalName} title="Download">
                <Button size="icon" variant="ghost" className="h-7 w-7">
                  <Download className="w-3.5 h-3.5" />
                </Button>
              </a>
            ) : (
              <Button size="icon" variant="ghost" className="h-7 w-7" disabled title="Unavailable">
                <Download className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              disabled={deletingId === a.id}
              onClick={() => handleDelete(a.id)}
              title="Delete attachment"
            >
              {deletingId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5 text-destructive" />}
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={!!previewAttachment} onOpenChange={(open) => { if (!open) setPreviewAttachment(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate">{previewAttachment?.originalName}</DialogTitle>
          </DialogHeader>
          {previewAttachment && (
            previewAttachment.mimeType.startsWith("image/") ? (
              <img
                src={`/api/purchases/attachments/${previewAttachment.id}/file`}
                alt={previewAttachment.originalName}
                className="max-h-[75vh] w-full object-contain rounded"
              />
            ) : previewAttachment.mimeType === "application/pdf" ? (
              <iframe
                src={`/api/purchases/attachments/${previewAttachment.id}/file`}
                title={previewAttachment.originalName}
                className="w-full h-[75vh] rounded border"
              />
            ) : (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Preview isn't available for this file type — use Download instead.
              </p>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttachmentsDialog({
  purchaseId,
  billNo,
  open,
  onOpenChange,
}: {
  purchaseId: number;
  billNo: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="w-4 h-4" />
            Attachments — {billNo}
          </DialogTitle>
          <DialogDescription>Upload or view JPG, PNG, or PDF files for this purchase.</DialogDescription>
        </DialogHeader>
        <AttachmentsSection purchaseId={purchaseId} />
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------ PURCHASE REPORT ------------------------------

interface ReportRow {
  purchaseId: number;
  billDate: string;
  vendorName: string;
  billNo: string;
  vendorBillNo: string;
  productName: string;
  qty: string;
  unit: string;
  rate: string;
  taxPct: string;
  discountPct: string;
  amount: string;
  grandTotal: string;
  billType: string;
}

// Type-to-search dropdown for report filters — a plain <Select> forces
// scrolling through the whole vendor/product list to find one by name.
function FilterCombobox({
  items, value, onChange, placeholder, allLabel, className,
}: {
  items: { id: number; name: string }[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  allLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((i) => String(i.id) === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-8 text-sm w-full justify-between font-normal", className)}
        >
          <span className="truncate">{selected ? selected.name : allLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList className="max-h-60">
            <CommandEmpty>No match found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value={allLabel} onSelect={() => { onChange(""); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {items.map((it) => (
                <CommandItem
                  key={it.id}
                  value={it.name}
                  onSelect={() => { onChange(String(it.id)); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === String(it.id) ? "opacity-100" : "opacity-0")} />
                  {it.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PurchaseReportDialog({
  open,
  onOpenChange,
  products,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  products: any[];
}) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [billType, setBillType] = useState<string>("");
  const [vendorId, setVendorId] = useState<string>("");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const { toast } = useToast();
  const { data: vendors } = useListEntities({ type: "vendor" });

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("fromDate", fromDate);
      if (toDate) params.set("toDate", toDate);
      if (productId) params.set("productId", productId);
      if (billType) params.set("billType", billType);
      if (vendorId) params.set("vendorId", vendorId);
      const res = await fetch(`/api/purchases/report?${params}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      const data = await res.json();
      setRows(data);
      setFetched(true);
    } catch {
      toast({ title: "Error", description: "Could not load report", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);

  const handlePrint = () => {
    const printHTML = `
      <html><head><title>Purchase Report</title>
      <style>
        body { font-family: sans-serif; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
        th { background: #f3f4f6; font-weight: 600; }
        td.num { text-align: right; }
        tfoot td { font-weight: bold; background: #f9fafb; }
        h2 { margin: 0 0 4px 0; }
        .sub { color: #666; font-size: 11px; margin-bottom: 8px; }
      </style></head><body>
      <h2>Purchase Report</h2>
      <div class="sub">${fromDate ? `From: ${fromDate}` : ""} ${toDate ? `To: ${toDate}` : ""}</div>
      <table>
        <thead><tr>
          <th>Date</th><th>Bill #</th><th>Vendor</th><th>Type</th>
          <th>Product</th><th>Qty</th><th>Unit</th>
          <th>Rate ₹</th><th>Tax%</th><th>Amount ₹</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td>${new Date(r.billDate).toLocaleDateString("en-IN")}</td>
            <td>${r.billNo}</td><td>${r.vendorName}</td>
            <td>${r.billType === "gst" ? "GST" : "Non-GST"}</td>
            <td>${r.productName}</td>
            <td class="num">${Number(r.qty).toFixed(2)}</td>
            <td>${r.unit}</td>
            <td class="num">₹${Number(r.rate).toFixed(2)}</td>
            <td class="num">${Number(r.taxPct).toFixed(1)}%</td>
            <td class="num">₹${Number(r.amount).toFixed(2)}</td>
          </tr>`).join("")}
        </tbody>
        <tfoot><tr>
          <td colspan="9" style="text-align:right">Total</td>
          <td class="num">₹${totalAmount.toFixed(2)}</td>
        </tr></tfoot>
      </table>
      </body></html>
    `;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(printHTML);
    w.document.close();
    w.focus();
    w.print();
  };

  const handlePDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("Purchase Report", 40, 40);
    if (fromDate || toDate) {
      doc.setFontSize(10);
      doc.text(`${fromDate ? `From: ${fromDate}` : ""} ${toDate ? `To: ${toDate}` : ""}`.trim(), 40, 58);
    }
    const headers = [["Date", "Bill #", "Vendor", "Type", "Product", "Qty", "Unit", "Rate ₹", "Tax%", "Amount ₹"]];
    const body = rows.map((r) => [
      new Date(r.billDate).toLocaleDateString("en-IN"),
      r.billNo, r.vendorName, r.billType === "gst" ? "GST" : "Non-GST", r.productName,
      Number(r.qty).toFixed(2), r.unit,
      Number(r.rate).toFixed(2),
      `${Number(r.taxPct).toFixed(1)}%`,
      Number(r.amount).toFixed(2),
    ]);
    (doc as any).autoTable({
      head: headers,
      body,
      startY: fromDate || toDate ? 70 : 55,
      foot: [["", "", "", "", "", "", "", "", "Total", totalAmount.toFixed(2)]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [243, 244, 246], textColor: [0, 0, 0] },
    });
    doc.save(`purchase-report-${fromDate || "all"}.pdf`);
  };

  const handleExcel = () => {
    const wsData = [
      ["Date", "Bill #", "Vendor Bill #", "Vendor", "Type", "Product", "Qty", "Unit", "Rate", "Tax%", "Amount"],
      ...rows.map((r) => [
        new Date(r.billDate).toLocaleDateString("en-IN"),
        r.billNo, r.vendorBillNo, r.vendorName, r.billType === "gst" ? "GST" : "Non-GST", r.productName,
        Number(r.qty), r.unit, Number(r.rate), Number(r.taxPct), Number(r.amount),
      ]),
      ["", "", "", "", "", "", "", "", "", "Total", totalAmount],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase Report");
    XLSX.writeFile(wb, `purchase-report-${fromDate || "all"}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5" />
            Purchase Report
          </DialogTitle>
          <DialogDescription>Filter by date range and/or item to generate a report.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-3 items-end border-b pb-4">
          <div className="space-y-1 flex-1 min-w-[130px] sm:flex-none">
            <Label className="text-xs">From Date</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-36 h-8 text-sm" />
          </div>
          <div className="space-y-1 flex-1 min-w-[130px] sm:flex-none">
            <Label className="text-xs">To Date</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-36 h-8 text-sm" />
          </div>
          <div className="space-y-1 flex-1 min-w-[160px] sm:min-w-[200px] sm:flex-none">
            <Label className="text-xs">Item / Product</Label>
            <FilterCombobox
              items={products}
              value={productId}
              onChange={setProductId}
              placeholder="Search product…"
              allLabel="All Products"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[160px] sm:min-w-[200px] sm:flex-none">
            <Label className="text-xs">Vendor</Label>
            <FilterCombobox
              items={vendors ?? []}
              value={vendorId}
              onChange={setVendorId}
              placeholder="Search vendor…"
              allLabel="All Vendors"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[130px] sm:flex-none">
            <Label className="text-xs">Bill Type</Label>
            <Select value={billType || "all"} onValueChange={(v) => setBillType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm w-full sm:w-32">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="gst">GST</SelectItem>
                <SelectItem value="non_gst">Non-GST</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={fetchReport} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <BarChart2 className="w-4 h-4 mr-1.5" />}
            Generate
          </Button>
          {fetched && rows.length > 0 && (
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button size="sm" variant="outline" onClick={handlePrint}>
                <FileText className="w-4 h-4 mr-1.5" /> Print
              </Button>
              <Button size="sm" variant="outline" onClick={handlePDF}>
                <Download className="w-4 h-4 mr-1.5" /> PDF
              </Button>
              <Button size="sm" variant="outline" onClick={handleExcel}>
                <Download className="w-4 h-4 mr-1.5" /> Excel
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto">
          {!fetched && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              Set filters above and click <strong>Generate</strong> to load the report.
            </div>
          )}
          {fetched && rows.length === 0 && (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No purchases found for the selected filters.
            </div>
          )}
          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Rate ₹</TableHead>
                  <TableHead className="text-right">Tax%</TableHead>
                  <TableHead className="text-right">Amount ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{new Date(r.billDate).toLocaleDateString("en-IN")}</TableCell>
                    <TableCell className="text-sm font-medium">{r.billNo}</TableCell>
                    <TableCell className="text-sm">{r.vendorName}</TableCell>
                    <TableCell className="text-sm">
                      <Badge variant="outline">{r.billType === "gst" ? "GST" : "Non-GST"}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{r.productName}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{Number(r.qty).toFixed(2)}</TableCell>
                    <TableCell className="text-sm">{r.unit}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">₹{Number(r.rate).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{Number(r.taxPct).toFixed(1)}%</TableCell>
                    <TableCell className="text-right tabular-nums text-sm font-medium">₹{Number(r.amount).toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={9} className="text-right text-sm">Total</TableCell>
                  <TableCell className="text-right tabular-nums">₹{totalAmount.toFixed(2)}</TableCell>
                </TableRow>
              </tfoot>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------ HISTORY ------------------------------

function HistoryTab() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const { data: purchases, isLoading } = useListPurchases();
  const { data: products } = useListProducts({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [attachmentsFor, setAttachmentsFor] = useState<{ id: number; billNo: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; billNo: string } | null>(null);
  const deletePurchase = useDeletePurchase();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deletePurchase.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() });
          toast({ title: `Cancelled bill ${deleteTarget.billNo}`, description: "Stock and vendor payable were reversed." });
          setDeleteTarget(null);
        },
        onError: (err: any) => {
          toast({
            title: "Failed to cancel bill",
            description: err?.response?.data?.error ?? err?.message ?? "Please try again",
            variant: "destructive",
          });
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto" />
      </div>
    );
  }

  if (!purchases || purchases.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed rounded-lg">
        <Truck className="mx-auto h-12 w-12 text-muted-foreground opacity-20 mb-4" />
        <h3 className="text-lg font-medium">No purchases yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Record your first goods-receipt from a vendor under the New Purchase tab.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
          <BarChart2 className="w-4 h-4 mr-1.5" />
          Purchase Report
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="hidden md:table-cell">Vendor Bill</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="hidden sm:table-cell text-right">Balance Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((p: any) => (
                  <TableRow key={p.id} data-testid={`row-purchase-${p.id}`}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        {p.billNo}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(p.billDate).toLocaleDateString("en-IN")}
                    </TableCell>
                    <TableCell>{p.vendorName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground">{p.vendorBillNo ?? "—"}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={p.billType === "gst" ? "default" : "secondary"}>
                        {p.billType === "gst" ? "GST" : "Non-GST"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      ₹{Number(p.grandTotal).toFixed(2)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-right tabular-nums">
                      ₹{Number(p.balanceDue).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "cancelled" ? "destructive" : "outline"}>{p.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-0.5">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Attachments"
                          onClick={() => setAttachmentsFor({ id: p.id, billNo: p.billNo })}
                        >
                          <Paperclip className="w-4 h-4" />
                        </Button>
                        {isAdmin && p.status !== "cancelled" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Edit bill"
                            onClick={() => setEditingId(p.id)}
                            data-testid={`button-edit-purchase-${p.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {isAdmin && p.status !== "cancelled" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete bill"
                            onClick={() => setDeleteTarget({ id: p.id, billNo: p.billNo })}
                            data-testid={`button-delete-purchase-${p.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {editingId !== null && (
        <EditPurchaseDialog
          purchaseId={editingId}
          open={editingId !== null}
          onOpenChange={(open) => { if (!open) setEditingId(null); }}
        />
      )}

      <PurchaseReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        products={products ?? []}
      />

      {attachmentsFor && (
        <AttachmentsDialog
          purchaseId={attachmentsFor.id}
          billNo={attachmentsFor.billNo}
          open={true}
          onOpenChange={(v) => { if (!v) setAttachmentsFor(null); }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel bill {deleteTarget?.billNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              This reverses the stock this bill added and reduces the vendor's outstanding payable
              by the bill amount. The bill stays visible with a "cancelled" status for your records.
              This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deletePurchase.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletePurchase.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Cancel Bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ------------------------------ EDIT DIALOG ------------------------------

function EditPurchaseDialog({
  purchaseId,
  open,
  onOpenChange,
}: {
  purchaseId: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { data: purchase, isLoading } = useGetPurchase(purchaseId, {
    query: { enabled: open, queryKey: getGetPurchaseQueryKey(purchaseId) },
  });
  const { data: vendors } = useListEntities({ type: "vendor" });
  const { data: products } = useListProducts({});
  const update = useUpdatePurchase();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [vendorId, setVendorId] = useState("");
  const [vendorBillNo, setVendorBillNo] = useState("");
  const [billType, setBillType] = useState<"gst" | "non_gst">("gst");
  const [placeOfSupply, setPlaceOfSupply] = useState("Maharashtra");
  const [billDate, setBillDate] = useState("");
  const [notes, setNotes] = useState("");
  const [freight, setFreight] = useState("0");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  // Pre-fill when purchase loads
  useEffect(() => {
    if (!purchase) return;
    setVendorId(purchase.vendorId ? String(purchase.vendorId) : "");
    setVendorBillNo(purchase.vendorBillNo ?? "");
    setBillType(purchase.billType as "gst" | "non_gst");
    setPlaceOfSupply(purchase.placeOfSupply ?? "Maharashtra");
    setBillDate(purchase.billDate ? purchase.billDate.slice(0, 10) : "");
    setNotes(purchase.notes ?? "");
    setFreight(purchase.freight ?? "0");
    if (purchase.items && purchase.items.length > 0) {
      setLines(purchase.items.map((it: any) => ({
        productId: it.productId ?? null,
        productName: it.productName ?? "",
        unit: it.unit ?? "pcs",
        qty: it.qty ?? "1",
        rate: it.rate ?? "0",
        discountPct: it.discountPct ?? "0",
        taxPct: it.taxPct ?? "18",
      })));
    }
  }, [purchase]);

  const isGst = billType === "gst";
  const isInterstate = placeOfSupply !== "Maharashtra";

  const totals = useMemo(() => {
    let subtotal = 0, totalDiscount = 0, totalTax = 0;
    for (const l of lines) {
      const qty = Number(l.qty) || 0;
      const rate = Number(l.rate) || 0;
      const disc = Number(l.discountPct) || 0;
      const taxPct = isGst ? Number(l.taxPct) || 0 : 0;
      const base = qty * rate;
      const discAmt = base * disc / 100;
      const taxable = base - discAmt;
      const tax = taxable * taxPct / 100;
      subtotal += taxable;
      totalDiscount += discAmt;
      totalTax += tax;
    }
    const fr = Number(freight) || 0;
    const grand = subtotal + totalTax + fr;
    const roundOff = Math.round(grand) - grand;
    return { subtotal, totalDiscount, totalTax, freight: fr, grand, roundOff, finalTotal: Math.round(grand) };
  }, [lines, isGst, freight]);

  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i: number) => setLines((prev) => prev.filter((_, idx) => idx !== i));

  const onPickProduct = (i: number, productIdStr: string) => {
    const prod = (products ?? []).find((p: any) => String(p.id) === productIdStr);
    if (!prod) return;
    updateLine(i, {
      productId: prod.id,
      productName: prod.name,
      unit: prod.unit ?? "pcs",
      rate: String(prod.purchasePrice ?? 0),
      taxPct: String(prod.taxRate ?? 18),
    });
  };

  const valid = vendorId && lines.length > 0 && lines.every((l) => l.productId && Number(l.qty) > 0);

  const onSubmit = async () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      await update.mutateAsync({
        id: purchaseId,
        data: {
          vendorId: Number(vendorId),
          vendorBillNo: vendorBillNo || undefined,
          billDate,
          billType,
          placeOfSupply,
          notes: notes || undefined,
          freight: Number(freight) || 0,
          roundOff: totals.roundOff,
          items: lines.map((l) => ({
            productId: l.productId!,
            qty: Number(l.qty),
            unit: l.unit,
            rate: Number(l.rate),
            discountPct: Number(l.discountPct) || 0,
            taxPct: Number(l.taxPct) || 0,
          })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: getListPurchasesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetPurchaseQueryKey(purchaseId) });
      toast({ title: "Purchase updated", description: "Bill and stock have been adjusted." });
      onOpenChange(false);
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({ title: "Could not update purchase", description: desc, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Purchase — {purchase?.billNo}</DialogTitle>
          <DialogDescription>
            Changes will reverse old stock movements and ledger entries, then re-apply with updated values.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {/* Bill Details */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Vendor</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                  <SelectContent>
                    {(vendors ?? []).map((v: any) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.name}{v.mobile ? ` · ${v.mobile}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Vendor Bill #</Label>
                <Input value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} placeholder="e.g. SUP/2026/119" />
              </div>
              <div className="space-y-1.5">
                <Label>Bill Date</Label>
                <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Bill Type</Label>
                <Select value={billType} onValueChange={(v) => setBillType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gst">GST</SelectItem>
                    <SelectItem value="non_gst">Non-GST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Place of Supply</Label>
                <Input value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} />
              </div>
            </div>

            {/* Line Items */}
            <div className="rounded-lg border">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <span className="text-sm font-semibold">Line Items</span>
                <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>
                  <Plus className="w-4 h-4 mr-1" /> Add Line
                </Button>
              </div>
              <LineItemsEditor
                lines={lines}
                isGst={isGst}
                products={products ?? []}
                onPickProduct={onPickProduct}
                onUpdateLine={updateLine}
                onRemoveLine={removeLine}
              />
            </div>

            {/* Freight + Notes */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Freight / Other Charges (₹)</Label>
                <Input type="number" min="0" step="0.01" value={freight} onChange={(e) => setFreight(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional remarks…" />
              </div>
            </div>

            {/* Summary bar */}
            <div className="rounded-lg bg-muted/50 border px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-center text-sm">
              <div className="flex gap-1.5"><span className="text-muted-foreground">Subtotal:</span><span className="tabular-nums font-medium">₹{totals.subtotal.toFixed(2)}</span></div>
              {totals.totalDiscount > 0 && <div className="flex gap-1.5"><span className="text-muted-foreground">Discount:</span><span className="tabular-nums text-destructive">−₹{totals.totalDiscount.toFixed(2)}</span></div>}
              {isGst && totals.totalTax > 0 && (
                isInterstate
                  ? <div className="flex gap-1.5"><span className="text-muted-foreground">IGST:</span><span className="tabular-nums">₹{totals.totalTax.toFixed(2)}</span></div>
                  : <><div className="flex gap-1.5"><span className="text-muted-foreground">CGST:</span><span className="tabular-nums">₹{(totals.totalTax/2).toFixed(2)}</span></div><div className="flex gap-1.5"><span className="text-muted-foreground">SGST:</span><span className="tabular-nums">₹{(totals.totalTax/2).toFixed(2)}</span></div></>
              )}
              {totals.freight > 0 && <div className="flex gap-1.5"><span className="text-muted-foreground">Freight:</span><span className="tabular-nums">₹{totals.freight.toFixed(2)}</span></div>}
              {Math.abs(totals.roundOff) > 0.001 && <div className="flex gap-1.5"><span className="text-muted-foreground">Round Off:</span><span className="tabular-nums">{totals.roundOff > 0 ? "+" : ""}₹{totals.roundOff.toFixed(2)}</span></div>}
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground">Grand Total:</span>
                <span className="text-xl font-bold tabular-nums">₹{totals.finalTotal.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button disabled={!valid || submitting || isLoading} onClick={onSubmit} data-testid="button-save-edit-purchase">
            {submitting
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</>
              : <><Save className="w-4 h-4 mr-2" /> Save Changes</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
