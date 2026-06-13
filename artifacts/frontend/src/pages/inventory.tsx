import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/use-auth";
import { useListProducts, useCreateProduct, useUpdateProduct, useDeleteProduct } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ImageAdjustDialog } from "@/components/image-adjust-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { getListProductsQueryKey } from "@workspace/api-client-react";
import {
  PackageSearch, PackagePlus, Upload, X, ImageIcon, Loader2, ChevronRight,
  Pencil, Trash2, Save,
} from "lucide-react";

export default function Inventory() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const { data: products, isLoading } = useListProducts({ search: search || undefined });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteProduct = useDeleteProduct();

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteProduct.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: `Deleted "${deleteTarget.name}"` });
          setDeleteTarget(null);
        },
        onError: async (err: any) => {
          let desc = err?.message ?? "Server error";
          try {
            const body = err?.response ? await err.response.json() : null;
            if (body?.error) desc = String(body.error).slice(0, 300);
          } catch {}
          toast({ title: "Failed to delete product", description: desc, variant: "destructive" });
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Inventory Management</h1>
        <Button onClick={() => setAddOpen(true)} data-testid="button-add-product">
          <PackagePlus className="h-4 w-4 mr-2" />
          Add Product
        </Button>
      </div>

      <div className="flex gap-4">
        <div className="relative w-full max-w-sm">
          <PackageSearch className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products by name or code..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-inventory"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Image</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Pricing (W / R)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : products?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No products found.</TableCell>
                </TableRow>
              ) : (
                products?.map((product) => (
                  <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                    <TableCell>
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-10 h-10 object-contain rounded border bg-muted"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border bg-muted flex items-center justify-center">
                          <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{product.itemCode}</TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{product.brand}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={product.currentStock <= (product.minStockThreshold || 0) ? "text-destructive font-bold" : ""}>
                        {product.currentStock} {product.unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      ₹{product.wholesalePrice} / ₹{product.retailPrice}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {product.notForSale ? (
                          <Badge variant="secondary">Internal</Badge>
                        ) : (
                          <Badge className="bg-green-600 text-white border-transparent hover:bg-green-700">Active</Badge>
                        )}
                        {product.addForManufacturing && (
                          <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">Mfg</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8"
                          onClick={() => setEditProduct(product)}
                          data-testid={`button-edit-${product.id}`}
                          title="Edit product"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget(product)}
                          data-testid={`button-delete-${product.id}`}
                          title="Delete product"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductDialog open={addOpen} onOpenChange={setAddOpen} />
      <ProductDialog
        open={!!editProduct}
        onOpenChange={(v) => { if (!v) setEditProduct(null); }}
        product={editProduct}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteTarget?.name}</strong> ({deleteTarget?.itemCode}) from your catalog.
              If the product has been used in invoices or BOMs, deletion may be blocked by the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleteProduct.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProduct.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type ProductForm = {
  name: string;
  printName: string;
  group: string;
  brand: string;
  itemCode: string;
  unit: string;
  purchasePrice: string;
  mrp: string;
  wholesalePrice: string;
  retailPrice: string;
  hsnCode: string;
  taxRate: string;
  commissionPerLiter: string;
  litersPerBox: string;
  unitsPerBox: string;
  openingStock: string;
  minStockThreshold: string;
  notForSale: boolean;
  addForManufacturing: boolean;
  imageUrl: string;
};

const emptyForm: ProductForm = {
  name: "", printName: "", group: "", brand: "", itemCode: "",
  unit: "", purchasePrice: "", mrp: "", wholesalePrice: "", retailPrice: "",
  hsnCode: "", taxRate: "18", commissionPerLiter: "0", litersPerBox: "", unitsPerBox: "", openingStock: "0",
  minStockThreshold: "5", notForSale: false, addForManufacturing: false, imageUrl: "",
};

function ProductDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (v: boolean) => void; product?: any }) {
  const isEdit = !!product;
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [productType, setProductType] = useState<"Purchased" | "Manufactured">("Purchased");
  const [imagePreview, setImagePreview] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [adjustSrc, setAdjustSrc] = useState<string>("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  // Hydrate form when opening for edit
  useEffect(() => {
    if (open && product) {
      setForm({
        name: product.name ?? "",
        printName: product.printName ?? "",
        group: product.group ?? "",
        brand: product.brand ?? "",
        itemCode: product.itemCode ?? "",
        unit: product.unit ?? "",
        purchasePrice: product.purchasePrice != null ? String(product.purchasePrice) : "",
        mrp: product.mrp != null ? String(product.mrp) : "",
        wholesalePrice: product.wholesalePrice != null ? String(product.wholesalePrice) : "",
        retailPrice: product.retailPrice != null ? String(product.retailPrice) : "",
        hsnCode: product.hsnCode ?? "",
        taxRate: product.taxRate != null ? String(product.taxRate) : "18",
        commissionPerLiter: product.commissionPerLiter != null ? String(product.commissionPerLiter) : "0",
        litersPerBox: product.litersPerBox != null ? String(product.litersPerBox) : "",
        unitsPerBox: product.unitsPerBox != null ? String(product.unitsPerBox) : "",
        openingStock: product.openingStock != null ? String(product.openingStock) : "0",
        minStockThreshold: product.minStockThreshold != null ? String(product.minStockThreshold) : "5",
        notForSale: !!product.notForSale,
        addForManufacturing: !!product.addForManufacturing,
        imageUrl: product.imageUrl ?? "",
      });
      setImagePreview(product.imageUrl ?? "");
      setProductType(Number(product.purchasePrice) === 0 ? "Manufactured" : "Purchased");
      setTab("details");
    } else if (open && !product) {
      setForm(emptyForm);
      setImagePreview("");
      setProductType("Purchased");
      setTab("details");
    }
  }, [open, product]);

  const set = (field: keyof ProductForm, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleClose = () => {
    setForm(emptyForm);
    setImagePreview("");
    setTab("details");
    onOpenChange(false);
  };

  const handleImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "File too large", description: "Image must be under 8MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setAdjustSrc(result);
      setAdjustOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleImageFile(file);
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.itemCode.trim() || !form.group.trim() || !form.brand.trim() || !form.unit.trim()) {
      toast({ title: "Required fields missing", description: "Name, Item Code, Group, Brand and Unit are required.", variant: "destructive" });
      setTab("details");
      return;
    }
    const isManufactured = productType === "Manufactured";
    if (!form.retailPrice || !form.wholesalePrice || !form.mrp || (!isManufactured && !form.purchasePrice)) {
      toast({ title: "Pricing required", description: "Fill in all price fields.", variant: "destructive" });
      setTab("pricing");
      return;
    }
    if (!isManufactured && Number(form.purchasePrice) <= 0) {
      toast({ title: "Purchase price required", description: "Purchase Price must be greater than 0 for purchased products.", variant: "destructive" });
      setTab("pricing");
      return;
    }

    const payload: any = {
      name: form.name.trim(),
      printName: form.printName.trim() || undefined,
      group: form.group.trim(),
      brand: form.brand.trim(),
      itemCode: form.itemCode.trim(),
      unit: form.unit.trim(),
      purchasePrice: isManufactured ? 0 : Number(form.purchasePrice),
      mrp: Number(form.mrp),
      wholesalePrice: Number(form.wholesalePrice),
      retailPrice: Number(form.retailPrice),
      hsnCode: form.hsnCode.trim() || undefined,
      taxRate: form.taxRate ? Number(form.taxRate) : undefined,
      commissionPerLiter: form.commissionPerLiter ? Number(form.commissionPerLiter) : 0,
      litersPerBox: form.litersPerBox ? Number(form.litersPerBox) : undefined,
      unitsPerBox: form.unitsPerBox ? Number(form.unitsPerBox) : undefined,
      minStockThreshold: form.minStockThreshold ? Number(form.minStockThreshold) : undefined,
      notForSale: form.notForSale,
      addForManufacturing: form.addForManufacturing,
      imageUrl: form.imageUrl || undefined,
    };

    const handleError = async (err: any, fallback: string) => {
      let desc = err?.message ?? "Server error";
      try {
        const body = err?.response ? await err.response.json() : null;
        if (body?.error) desc = String(body.error).slice(0, 300);
      } catch {}
      toast({ title: fallback, description: desc, variant: "destructive" });
    };

    if (isEdit) {
      updateProduct.mutate(
        { id: product.id, data: payload },
        {
          onSuccess: (updated) => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: `Updated "${updated.name}"` });
            handleClose();
          },
          onError: (err) => handleError(err, "Failed to update product"),
        },
      );
    } else {
      createProduct.mutate(
        { data: { ...payload, openingStock: form.openingStock ? Number(form.openingStock) : 0 } },
        {
          onSuccess: (created) => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: `Product "${created.name}" added successfully` });
            handleClose();
          },
          onError: (err) => handleError(err, "Failed to create product"),
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? <Pencil className="w-5 h-5 text-primary" /> : <PackagePlus className="w-5 h-5 text-primary" />}
            {isEdit ? `Edit Product — ${product?.name ?? ""}` : "Add New Product"}
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="pricing">Pricing & Tax</TabsTrigger>
            <TabsTrigger value="stock">Stock & Image</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Details ── */}
          <TabsContent value="details" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Product Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Vipro 20W-40 Engine Oil 1L"
                  data-testid="input-product-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Print Name <span className="text-muted-foreground text-xs">(on invoice)</span></Label>
                <Input
                  value={form.printName}
                  onChange={(e) => set("printName", e.target.value)}
                  placeholder="Shorter name for print"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Item Code *</Label>
                <Input
                  value={form.itemCode}
                  onChange={(e) => set("itemCode", e.target.value)}
                  placeholder="e.g. VIP-20W40-1L"
                  data-testid="input-item-code"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Brand *</Label>
                <Input
                  value={form.brand}
                  onChange={(e) => set("brand", e.target.value)}
                  placeholder="e.g. Vipro"
                  data-testid="input-brand"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Group / Category *</Label>
                <Input
                  value={form.group}
                  onChange={(e) => set("group", e.target.value)}
                  placeholder="e.g. Engine Oil"
                  data-testid="input-group"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Unit *</Label>
                <Input
                  value={form.unit}
                  onChange={(e) => set("unit", e.target.value)}
                  placeholder="e.g. Ltr, Box, Pcs"
                  data-testid="input-unit"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Liters per {form.unit?.trim() ? form.unit.trim() : "Unit"}</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.litersPerBox}
                  onChange={(e) => set("litersPerBox", e.target.value)}
                  placeholder="Volume multiplier"
                />
              </div>
              <div className="space-y-1.5">
                <Label>1 Box = ___ {form.unit?.trim() || "Units"}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={form.unitsPerBox}
                  onChange={(e) => set("unitsPerBox", e.target.value)}
                  placeholder="e.g. 12"
                  data-testid="input-units-per-box"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used on invoice to show BOX = Qty / this value.
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={() => setTab("pricing")}>
                Next — Pricing <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </TabsContent>

          {/* ── Tab 2: Pricing ── */}
          <TabsContent value="pricing" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Product Type</Label>
                <Select
                  value={productType}
                  onValueChange={(v) => setProductType(v as "Purchased" | "Manufactured")}
                >
                  <SelectTrigger data-testid="select-product-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Purchased">Purchased</SelectItem>
                    <SelectItem value="Manufactured">Manufactured</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {productType === "Purchased" && (
                <div className="space-y-1.5">
                  <Label>Purchase Price (₹) *</Label>
                  <Input
                    type="number" min={0}
                    value={form.purchasePrice}
                    onChange={(e) => set("purchasePrice", e.target.value)}
                    placeholder="0.00"
                    data-testid="input-purchase-price"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>MRP (₹) *</Label>
                <Input
                  type="number" min={0}
                  value={form.mrp}
                  onChange={(e) => set("mrp", e.target.value)}
                  placeholder="0.00"
                  data-testid="input-mrp"
                />
              </div>
            </div>
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium">Selling Prices</p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Wholesale Price (₹) *</Label>
                  <Input
                    type="number" min={0}
                    value={form.wholesalePrice}
                    onChange={(e) => set("wholesalePrice", e.target.value)}
                    placeholder="0.00"
                    data-testid="input-wholesale-price"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Retail Price (₹) *</Label>
                  <Input
                    type="number" min={0}
                    value={form.retailPrice}
                    onChange={(e) => set("retailPrice", e.target.value)}
                    placeholder="0.00"
                    data-testid="input-retail-price"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>HSN Code</Label>
                <Input
                  value={form.hsnCode}
                  onChange={(e) => set("hsnCode", e.target.value)}
                  placeholder="e.g. 27101980"
                />
              </div>
              <div className="space-y-1.5">
                <Label>GST Rate (%)</Label>
                <Select
                  value={form.taxRate}
                  onValueChange={(v) => set("taxRate", v)}
                >
                  <SelectTrigger data-testid="select-tax-rate">
                    <SelectValue placeholder="Select GST rate" />
                  </SelectTrigger>
                  <SelectContent>
                    {["0", "5", "12", "18", "28"].map((rate) => (
                      <SelectItem key={rate} value={rate}>{rate}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Commission per Liter (₹)</Label>
                <Input
                  type="number" min={0} step="0.01"
                  value={form.commissionPerLiter}
                  onChange={(e) => set("commissionPerLiter", e.target.value)}
                  placeholder="0.00"
                  data-testid="input-commission-per-liter"
                />
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setTab("details")}>Back</Button>
              <Button type="button" onClick={() => setTab("stock")}>
                Next — Stock & Image <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </TabsContent>

          {/* ── Tab 3: Stock & Image ── */}
          <TabsContent value="stock" className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>
                  {isEdit ? "Current Stock" : "Opening Stock"}
                  {isEdit && <span className="ml-2 text-xs text-muted-foreground">(read-only — use stock movements)</span>}
                </Label>
                <Input
                  type="number" min={0}
                  value={isEdit ? String(product?.currentStock ?? 0) : form.openingStock}
                  onChange={(e) => set("openingStock", e.target.value)}
                  placeholder="0"
                  disabled={isEdit}
                  data-testid="input-opening-stock"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Low Stock Alert Level</Label>
                <Input
                  type="number" min={0}
                  value={form.minStockThreshold}
                  onChange={(e) => set("minStockThreshold", e.target.value)}
                  placeholder="5"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
                <Switch
                  id="not-for-sale"
                  checked={form.notForSale}
                  onCheckedChange={(v) => set("notForSale", v)}
                  data-testid="switch-not-for-sale"
                />
                <div>
                  <Label htmlFor="not-for-sale" className="cursor-pointer">Not for Sale</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Hide from price catalog &amp; billing</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/20">
                <Switch
                  id="add-for-mfg"
                  checked={form.addForManufacturing}
                  onCheckedChange={(v) => set("addForManufacturing", v)}
                  data-testid="switch-add-for-mfg"
                />
                <div>
                  <Label htmlFor="add-for-mfg" className="cursor-pointer">Add for Manufacturing</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Show in Manufacturing &amp; allow recipes (BOM)</p>
                </div>
              </div>
            </div>

            <ImageAdjustDialog
              open={adjustOpen}
              onOpenChange={setAdjustOpen}
              src={adjustSrc}
              onConfirm={(dataUrl) => {
                setImagePreview(dataUrl);
                set("imageUrl", dataUrl);
              }}
            />

            {/* ── Image Uploader ── */}
            <div className="space-y-2">
              <Label>Product Image</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFile(file);
                  e.target.value = "";
                }}
                data-testid="input-image-file"
              />

              {imagePreview ? (
                <div className="relative w-full rounded-lg border overflow-hidden bg-muted/30 flex items-center gap-4 p-3">
                  <img
                    src={imagePreview}
                    alt="Product preview"
                    className="w-24 h-24 object-contain rounded border bg-white shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">Image selected</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Click to replace or remove</p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5" />
                        Replace
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { setAdjustSrc(imagePreview); setAdjustOpen(true); }}
                        data-testid="button-adjust-image"
                      >
                        <Upload className="w-3.5 h-3.5 mr-1.5 rotate-180" />
                        Adjust
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setImagePreview(""); set("imageUrl", ""); }}
                        data-testid="button-remove-image"
                      >
                        <X className="w-3.5 h-3.5 mr-1.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className={`w-full rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-8 gap-3 cursor-pointer transition-all
                    ${isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  data-testid="drop-zone-image"
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">Click to upload or drag &amp; drop</p>
                    <p className="text-xs text-muted-foreground mt-0.5">PNG, JPG, WEBP — max 2MB</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" tabIndex={-1}>
                    <Upload className="w-3.5 h-3.5 mr-1.5" />
                    Browse File
                  </Button>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setTab("pricing")}>Back</Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={createProduct.isPending || updateProduct.isPending}
                data-testid="button-save-product"
              >
                {(createProduct.isPending || updateProduct.isPending) ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : isEdit ? (
                  <Save className="w-4 h-4 mr-2" />
                ) : (
                  <PackagePlus className="w-4 h-4 mr-2" />
                )}
                {isEdit ? "Save Changes" : "Save Product"}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
