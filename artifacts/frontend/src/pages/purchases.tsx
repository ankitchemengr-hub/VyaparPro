import React, { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import {
  useListPurchases,
  useCreatePurchase,
  useUpdatePurchase,
  useGetPurchase,
  useListEntities,
  useCreateEntity,
  useListProducts,
  getListPurchasesQueryKey,
  getGetPurchaseQueryKey,
  getListProductsQueryKey,
  getListEntitiesQueryKey,
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
  Truck, Plus, Trash2, Loader2, FileText, Save, UserPlus, Pencil, ChevronsUpDown, Check,
} from "lucide-react";
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
  const selected = products.find((p) => p.id === value);
  return (
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
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search product…" />
          <CommandList className="max-h-60">
            <CommandEmpty>No product found.</CommandEmpty>
            <CommandGroup>
              {products.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onChange(String(p.id));
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")}
                  />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function Purchases() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Purchases</h1>
        <p className="text-muted-foreground mt-2">
          Record goods received from vendors. Adds to inventory and creates a payable in the vendor ledger.
        </p>
      </div>

      <Tabs defaultValue="new" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="new" data-testid="tab-new-purchase">New Purchase</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-purchase-history">Purchase History</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-6">
          <NewPurchaseTab />
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

function NewPurchaseTab() {
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

  const productMap = useMemo(() => {
    const m = new Map<number, any>();
    (products ?? []).forEach((p: any) => m.set(p.id, p));
    return m;
  }, [products]);

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
    return { subtotal, totalTax, totalDiscount, freight: fr, grand };
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
      await create.mutateAsync({
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
          <div className="overflow-x-auto">
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
                {lines.map((l, i) => {
                  const qty  = Number(l.qty) || 0;
                  const rate = Number(l.rate) || 0;
                  const disc = Number(l.discountPct) || 0;
                  const taxPct = isGst ? Number(l.taxPct) || 0 : 0;
                  const base   = qty * rate;
                  const taxable = base - (base * disc / 100);
                  const amount  = taxable + (taxable * taxPct / 100);
                  return (
                    <TableRow key={i} data-testid={`line-${i}`}>
                      <TableCell className="pl-4">
                        <ProductCombobox
                          products={products ?? []}
                          value={l.productId}
                          onChange={(v) => onPickProduct(i, v)}
                          testId={`select-product-${i}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" min="0" step="1"
                          value={l.qty} onChange={(e) => updateLine(i, { qty: e.target.value })}
                          className="w-20 text-right ml-auto" data-testid={`input-qty-${i}`} />
                      </TableCell>
                      <TableCell>
                        <Input value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} className="w-16" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" min="0" step="0.01"
                          value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })}
                          className="w-24 text-right ml-auto" data-testid={`input-rate-${i}`} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input type="number" min="0" max="100" step="0.1"
                          value={l.discountPct} onChange={(e) => updateLine(i, { discountPct: e.target.value })}
                          className="w-16 text-right ml-auto" />
                      </TableCell>
                      {isGst && (
                        <TableCell className="text-right">
                          <Input type="number" min="0" max="100" step="0.5"
                            value={l.taxPct} onChange={(e) => updateLine(i, { taxPct: e.target.value })}
                            className="w-16 text-right ml-auto" />
                        </TableCell>
                      )}
                      <TableCell className="text-right tabular-nums font-semibold pr-4">
                        ₹{amount.toFixed(2)}
                      </TableCell>
                      <TableCell className="pr-4">
                        <Button size="icon" variant="ghost" onClick={() => removeLine(i)}
                          data-testid={`button-remove-line-${i}`}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
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
            <div className="ml-auto flex items-center gap-4">
              <div>
                <span className="text-muted-foreground mr-1.5">Grand Total:</span>
                <span className="text-xl font-bold tabular-nums" data-testid="text-grand-total">₹{totals.grand.toFixed(2)}</span>
              </div>
              <Button
                disabled={!valid || submitting}
                onClick={onSubmit}
                data-testid="button-save-purchase"
                size="lg"
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

// ------------------------------ HISTORY ------------------------------

function HistoryTab() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole(["admin"]);
  const { data: purchases, isLoading } = useListPurchases();
  const [editingId, setEditingId] = useState<number | null>(null);

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
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bill #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Vendor Bill</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance Due</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead className="w-16"></TableHead>}
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
                    <TableCell className="text-muted-foreground">{p.vendorBillNo ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={p.billType === "gst" ? "default" : "secondary"}>
                        {p.billType === "gst" ? "GST" : "Non-GST"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      ₹{Number(p.grandTotal).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ₹{Number(p.balanceDue).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "cancelled" ? "destructive" : "outline"}>{p.status}</Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        {p.status !== "cancelled" && (
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
                      </TableCell>
                    )}
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
    query: { enabled: open },
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
    return { subtotal, totalDiscount, totalTax, freight: fr, grand: subtotal + totalTax + fr };
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
            <div className="rounded-lg border overflow-x-auto">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <span className="text-sm font-semibold">Line Items</span>
                <Button size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>
                  <Plus className="w-4 h-4 mr-1" /> Add Line
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4 min-w-[180px]">Product</TableHead>
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
                  {lines.map((l, i) => {
                    const qty   = Number(l.qty) || 0;
                    const rate  = Number(l.rate) || 0;
                    const disc  = Number(l.discountPct) || 0;
                    const taxPct = isGst ? Number(l.taxPct) || 0 : 0;
                    const base   = qty * rate;
                    const taxable = base - (base * disc / 100);
                    const amount  = taxable + (taxable * taxPct / 100);
                    return (
                      <TableRow key={i}>
                        <TableCell className="pl-4">
                          <ProductCombobox
                            products={products ?? []}
                            value={l.productId}
                            onChange={(v) => onPickProduct(i, v)}
                          />
                        </TableCell>
                        <TableCell><Input type="number" min="0" step="1" value={l.qty} onChange={(e) => updateLine(i, { qty: e.target.value })} className="w-20 text-right ml-auto" /></TableCell>
                        <TableCell><Input value={l.unit} onChange={(e) => updateLine(i, { unit: e.target.value })} className="w-16" /></TableCell>
                        <TableCell><Input type="number" min="0" step="0.01" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24 text-right ml-auto" /></TableCell>
                        <TableCell><Input type="number" min="0" max="100" step="0.1" value={l.discountPct} onChange={(e) => updateLine(i, { discountPct: e.target.value })} className="w-16 text-right ml-auto" /></TableCell>
                        {isGst && <TableCell><Input type="number" min="0" max="100" step="0.5" value={l.taxPct} onChange={(e) => updateLine(i, { taxPct: e.target.value })} className="w-16 text-right ml-auto" /></TableCell>}
                        <TableCell className="text-right tabular-nums font-semibold pr-4">₹{amount.toFixed(2)}</TableCell>
                        <TableCell className="pr-4">
                          <Button size="icon" variant="ghost" onClick={() => removeLine(i)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
              <div className="ml-auto flex items-center gap-2">
                <span className="text-muted-foreground">Grand Total:</span>
                <span className="text-xl font-bold tabular-nums">₹{totals.grand.toFixed(2)}</span>
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
