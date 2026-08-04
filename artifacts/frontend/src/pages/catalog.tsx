import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListProducts,
  useListProductGroups,
  useListBrands,
  useListEntities,
  useLookupEntityByMobile,
  useCreateEntity,
  useCreateCustomerOrder,
  useGetEntity,
  useGetTopProducts,
  getListCustomerOrdersQueryKey,
  getGetEntityQueryKey,
  getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
import { Search, Plus, Minus, ShoppingCart, Phone, User, CheckCircle, UserPlus, Loader2, X, SlidersHorizontal, ZoomIn } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getLookupEntityByMobileQueryKey } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";

export default function Catalog() {
  const { user, hasRole } = useAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<string>("");
  const [brand, setBrand] = useState<string>("");
  // Multi-product cart: productId -> quantity
  const [cart, setCart] = useState<Record<number, number>>({});
  // Raw text of an in-progress qty edit, keyed by product id — lets the field
  // actually show empty while backspacing/retyping instead of snapping back
  // to the last valid qty on every keystroke (the cart itself only updates
  // once a valid positive number exists; blur cleans up an abandoned edit).
  const [qtyDrafts, setQtyDrafts] = useState<Record<number, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [zoomImage, setZoomImage] = useState<{ url: string; name: string } | null>(null);

  // Cart review dialog (shown before customer lookup)
  const [showCartReview, setShowCartReview] = useState(false);

  // Final order-slip summary shown to a counter login after submitting —
  // captured from cart data at submit time since customer_orders doesn't
  // round-trip line items back on create.
  const [placedOrder, setPlacedOrder] = useState<{
    order: any;
    customer: any;
    items: Array<{ name: string; itemCode?: string; qty: number; rate: number; gstAmount: number; lineTotal: number }>;
    invoiceMode: "gst" | "non_gst";
  } | null>(null);

  // Customer lookup dialog state
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [mobileInput, setMobileInput] = useState("");
  const [searchMobile, setSearchMobile] = useState("");
  const [step, setStep] = useState<"mobile" | "not_found" | "found">("mobile");
  const [foundCustomer, setFoundCustomer] = useState<any>(null);
  const [nameSearch, setNameSearch] = useState("");

  const { data: products, isLoading } = useListProducts({
    search: search || undefined,
    group: group || undefined,
    brand: brand || undefined,
    forSale: true,
  });
  const { data: groups } = useListProductGroups();
  const { data: brands } = useListBrands();

  // Fast-selling products (by revenue, last-known top 10 companywide) get a
  // much better chance of landing near the front, but this is a weighted
  // shuffle, not a pin — it's freshly randomized on every load, so browsing
  // doesn't feel like the same fixed A-Z list every single time, and even a
  // low-weight product can still surface first on any given visit.
  const { data: topProducts } = useGetTopProducts();
  const topProductIds = useMemo(
    () => new Set((topProducts ?? []).map((p) => p.productId)),
    [topProducts],
  );
  const shuffledProducts = useMemo(() => {
    if (!products) return [];
    const weightOf = (id: number) => (topProductIds.has(id) ? 6 : 1);
    return products
      .map((p) => ({ p, score: Math.random() ** (1 / weightOf(p.id)) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.p);
  }, [products, topProductIds]);

  // Cart items must stay resolvable after the user changes the search/filter
  // text — `products` only ever holds the current search results, so a cart
  // item added under a previous search term would otherwise vanish from the
  // Order Summary (and its total) once that term no longer matches. This
  // cache accumulates every product seen so far, keyed by id, and is used
  // anywhere cart items are resolved back into product details.
  const [productCache, setProductCache] = useState<Record<number, NonNullable<typeof products>[number]>>({});
  useEffect(() => {
    if (!products || products.length === 0) return;
    setProductCache((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of products) {
        if (next[p.id] !== p) {
          next[p.id] = p;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [products]);

  const isB2B = user?.role === "customer";
  const isManufacturing = user?.role === "manufacturing";
  const isSalesman = user?.role === "salesman";
  const isStore = user?.role === "store";
  // "Counter" is a shared retail/wholesale login (not tied to one customer) —
  // its pricing tier is fixed on the account itself rather than looked up from
  // an entity, since many different people may use the same login.
  const isCounter = user?.role === "counter";
  const counterTier = (user as any)?.pricingTier as "retail" | "wholesale" | null | undefined;
  const isCounterRetail = isCounter && counterTier === "retail";
  const isCounterWholesale = isCounter && counterTier === "wholesale";
  const customerId = user?.customerId ?? 0;
  const { data: ownEntity } = useGetEntity(customerId, {
    query: { enabled: isB2B && !!user?.customerId, queryKey: getGetEntityQueryKey(customerId) },
  });
  const isWholesaleCustomer = isB2B && (ownEntity as any)?.pricingTier === "wholesale";
  const showRetailOnly = (isB2B && !isWholesaleCustomer) || isManufacturing || isCounterRetail;
  const hidePrices = false;
  const showAdvancedFilters = !isSalesman;
  const showNonGstRate = hasRole(["admin", "salesman", "store"]) || isWholesaleCustomer || isCounter;
  // Wholesale customers, salesmen, store users, and counter logins pick Cash Memo
  // (non-GST) vs E-Invoice (GST) before the order is placed. The choice carries
  // through to billing.tsx (for salesman/store, who redirect there) via the
  // invoiceType param.
  const showInvoiceTypeChoice = isWholesaleCustomer || isSalesman || isStore || isCounter;
  // Customer/counter/salesman checkout only ever places a customer_orders
  // record (no real stock deduction — see handlePlaceOrder/proceedToOrderWithCustomer
  // below) so it's fine, and expected, for them to order something that's out
  // of stock: Manufacturing/Store see it as a backorder and produce/restock
  // it. Only admin/store redirect straight to billing.tsx, which creates a
  // real invoice and does deduct real stock immediately, so that path alone
  // still needs the stock cap.
  const allowsBackorder = isB2B || isCounter || isSalesman;
  const [invoiceMode, setInvoiceMode] = useState<"gst" | "non_gst">("gst");
  const { toast } = useToast();
  const placeOrder = useCreateCustomerOrder();
  const queryClient = useQueryClient();

  // Derived cart data
  const cartItems = Object.entries(cart)
    .map(([id, qty]) => ({ productId: Number(id), qty }))
    .filter((i) => i.qty > 0);
  const cartCount = cartItems.length;
  const hasSelection = cartCount > 0;

  // Cart helpers
  const addToCart = (productId: number) => {
    setCart((c) => ({ ...c, [productId]: (c[productId] ?? 0) + 1 }));
  };

  const removeFromCart = (productId: number) => {
    setCart((c) => {
      const next = { ...c };
      delete next[productId];
      return next;
    });
  };

  const setQty = (productId: number, qty: number, maxStock: number) => {
    const clamped = Math.max(0.1, Math.min(maxStock, qty));
    setCart((c) => ({ ...c, [productId]: clamped }));
  };

  const decreaseQty = (productId: number) =>
    setCart((c) => {
      const next = (c[productId] ?? 1) - 1;
      if (next <= 0) {
        const updated = { ...c };
        delete updated[productId];
        return updated;
      }
      return { ...c, [productId]: next };
    });

  const increaseQty = (productId: number, maxStock: number) =>
    setCart((c) => ({ ...c, [productId]: Math.min(maxStock, (c[productId] ?? 0) + 1) }));

  const getStockBadge = (stock: number, unit: string) => {
    if (stock > 10) return <Badge className="bg-green-600 text-white border-transparent text-[10px]">{stock} {unit}</Badge>;
    if (stock > 0) return <Badge className="bg-amber-500 text-white border-transparent text-[10px]">{stock} {unit}</Badge>;
    return <Badge variant="destructive" className="text-[10px]">Out of Stock</Badge>;
  };

  const handlePlaceOrder = () => {
    if (!hasSelection) return;
    placeOrder.mutate(
      { data: { items: cartItems, invoiceType: invoiceMode } },
      {
        onSuccess: (order: any) => {
          toast({
            title: "Order placed",
            description: `Your order ${order.orderNo ?? ""} has been submitted.`,
          });
          setCart({});
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
          setLocation("/my-orders");
        },
        onError: (err: any) => {
          toast({
            title: "Failed to place order",
            description: err?.message ?? "Please try again",
            variant: "destructive",
          });
        },
      }
    );
  };

  const isStaff = hasRole(["admin", "salesman", "store", "manufacturing", "accountant", "counter"]);
  // Registering a brand-new customer (as opposed to looking one up by mobile
  // and ordering for them) is restricted to admin/salesman — store, counter,
  // manufacturing, and accountant can place orders for existing customers here
  // but cannot add new ones through this flow.
  const canRegisterNewCustomer = hasRole(["admin", "salesman"]);

  // Cart summary rows — join cart with product details
  const useNonGstRate = showInvoiceTypeChoice && invoiceMode === "non_gst";
  const cartSummaryRows = cartItems.map(({ productId, qty }) => {
    const product = productCache[productId] ?? products?.find((p) => p.id === productId);
    if (!product) return null;
    const baseRate = showRetailOnly ? Number(product.retailPrice) : Number(product.wholesalePrice);
    const nonGstRate = Number(product.nonGstPrice ?? 0);
    const rate = useNonGstRate && nonGstRate > 0 ? nonGstRate : baseRate;
    const gstRate = useNonGstRate ? 0 : Number(product.taxRate ?? 0);
    const baseAmount = rate * qty;
    const gstAmount = (baseAmount * gstRate) / 100;
    const lineTotal = baseAmount + gstAmount;
    const unitsPerBox = Number(product.unitsPerBox ?? 0);
    const boxCount = unitsPerBox > 0 ? qty / unitsPerBox : null;
    return { product, qty, rate, gstRate, gstAmount, lineTotal, boxCount };
  }).filter(Boolean) as Array<{
    product: NonNullable<typeof products>[number];
    qty: number;
    rate: number;
    gstRate: number;
    gstAmount: number;
    lineTotal: number;
    boxCount: number | null;
  }>;

  const grandTotal = cartSummaryRows.reduce((sum, r) => sum + r.lineTotal, 0);
  const grandGstAmount = cartSummaryRows.reduce((sum, r) => sum + r.gstAmount, 0);
  const totalBox = cartSummaryRows.reduce((sum, r) => sum + (r.boxCount ?? 0), 0);

  // Lookup hook — only fires when searchMobile is set
  const { data: lookupResult, isFetching: isLooking } = useLookupEntityByMobile(
    { mobile: searchMobile },
    { query: { enabled: searchMobile.length === 10, queryKey: getLookupEntityByMobileQueryKey({ mobile: searchMobile }) } }
  );

  // Name search — alternative to mobile lookup, for when the counter/salesman
  // knows the customer's name but not their number offhand.
  const trimmedNameSearch = nameSearch.trim();
  const { data: nameSearchResults, isFetching: isNameSearching } = useListEntities(
    { type: "customer", search: trimmedNameSearch },
    {
      query: {
        enabled: trimmedNameSearch.length >= 2,
        queryKey: getListEntitiesQueryKey({ type: "customer", search: trimmedNameSearch }),
      },
    },
  );

  const handleMobileLookup = () => {
    if (mobileInput.length !== 10) return;
    setSearchMobile(mobileInput);
  };

  const handleLookupResult = () => {
    if (!lookupResult) return;
    if (lookupResult.found && lookupResult.entity) {
      setFoundCustomer(lookupResult.entity);
      setStep("found");
    } else {
      setStep("not_found");
    }
  };

  // Auto-advance when lookup finishes
  if (lookupResult !== undefined && searchMobile && step === "mobile" && !isLooking) {
    handleLookupResult();
  }


const proceedToOrderWithCustomer = (customer: any) => {
  if (isSalesman || isCounter) {
    // Salesman/counter places the order directly with customer info — store now
    // creates invoices directly via billing.tsx instead (see the else
    // branch below), same as admin.
    placeOrder.mutate(
      { data: { items: cartItems, customerName: customer?.name, customerMobile: customer?.mobile, invoiceType: invoiceMode } },
      {
        onSuccess: (order: any) => {
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
          if (isCounter) {
            // Counter has no order list — show a final printable slip right
            // here instead of navigating away, using the cart snapshot since
            // the create response doesn't round-trip line items.
            setPlacedOrder({
              order,
              customer,
              invoiceMode,
              items: cartSummaryRows.map((r) => ({
                name: r.product.name,
                itemCode: r.product.itemCode,
                qty: r.qty,
                rate: r.rate,
                gstAmount: r.gstAmount,
                lineTotal: r.lineTotal,
              })),
            });
            setCart({});
            setShowCustomerDialog(false);
            return;
          }
          toast({
            title: "Order placed",
            description: `Order ${order.orderNo ?? ""} submitted for ${customer?.name ?? "customer"}.`,
          });
          setCart({});
          setShowCustomerDialog(false);
          setLocation("/my-orders");
        },
        onError: (err: any) => {
          toast({
            title: "Failed to place order",
            description: err?.message ?? "Please try again",
            variant: "destructive",
          });
        },
      }
    );
    return;
  }
  const cartParam = encodeURIComponent(JSON.stringify(cartItems));
  const customerParam = encodeURIComponent(JSON.stringify(customer));
  setLocation(`/billing?cart=${cartParam}&customer=${customerParam}&invoiceType=${invoiceMode}`);
};

  // Opens cart review dialog for everyone — salesmen and wholesale customers
  // also need it to pick Cash Memo (non-GST) vs E-Invoice (GST) before proceeding.
  const handleProceedClick = () => {
    if (!hasSelection) return;
    setShowCartReview(true);
  };

  // Called when user confirms cart review and is staff — opens customer lookup
  const openCustomerDialog = () => {
    setShowCartReview(false);
    setMobileInput("");
    setSearchMobile("");
    setStep("mobile");
    setFoundCustomer(null);
    setNameSearch("");
    newCustomerForm.reset({ name: "", mobile: "", gstin: "", address: "", city: "", state: "Maharashtra", pricingTier: "retail", assignedSalesmanId: "" });
    setShowCustomerDialog(true);
  };

  // New customer form
  const newCustomerForm = useForm({
    defaultValues: {
      name: "",
      mobile: mobileInput,
      gstin: "",
      address: "",
      city: "",
      state: "Maharashtra",
      pricingTier: "retail" as "retail" | "wholesale",
      assignedSalesmanId: "" as string,
    },
  });

  // Salesman picker for new customers registered on the fly — without this,
  // commission attribution (which is keyed off the customer's own
  // assignedSalesmanId, not who's logged in) silently never gets set for a
  // brand-new customer created through this dialog.
  const { data: salesmenList } = useListEntities(
    { type: "salesman" },
    { query: { enabled: isStaff, queryKey: getListEntitiesQueryKey({ type: "salesman" }) } },
  );

  const createEntity = useCreateEntity();

  const handleCreateCustomer = newCustomerForm.handleSubmit(async (data) => {
    const { assignedSalesmanId, ...rest } = data;
    createEntity.mutate(
      {
        data: {
          type: "customer",
          ...rest,
          mobile: mobileInput,
          ...(assignedSalesmanId ? { assignedSalesmanId: Number(assignedSalesmanId) } : {}),
        },
      },
      {
        onSuccess: (newCustomer) => {
          proceedToOrderWithCustomer(newCustomer);
        },
      }
    );
  });

  const proceedLabel = `Proceed to Order${hasSelection ? ` (${cartCount} Item${cartCount !== 1 ? "s" : ""})` : ""}`;

  const handlePrintOrderSlip = () => {
    if (!placedOrder) return;
    const { order, customer, items, invoiceMode: mode } = placedOrder;
    const total = items.reduce((s, i) => s + i.lineTotal, 0);
    const rows = items
      .map(
        (i) => `<tr>
          <td>${i.name}${i.itemCode ? ` <span class="muted">(${i.itemCode})</span>` : ""}</td>
          <td class="num">${i.qty}</td>
          <td class="num">₹${i.rate.toFixed(2)}</td>
          <td class="num">₹${i.lineTotal.toFixed(2)}</td>
        </tr>`
      )
      .join("");
    const html = `<!doctype html><html><head><title>Order ${order.orderNo ?? ""}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        .muted { color: #666; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; font-size: 13px; }
        .num { text-align: right; }
        .grand { font-weight: bold; font-size: 15px; }
        .meta { margin-top: 12px; font-size: 13px; }
      </style></head>
      <body>
        <h1>Order ${order.orderNo ?? ""}</h1>
        <div class="muted">${mode === "non_gst" ? "Cash Memo" : "E-Invoice"} — Pending</div>
        <div class="meta">
          <div><strong>Customer:</strong> ${customer?.name ?? "Customer"}</div>
          <div><strong>Mobile:</strong> ${customer?.mobile ?? ""}</div>
        </div>
        <table>
          <thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" class="grand" style="text-align:right">Total</td><td class="num grand">₹${total.toFixed(2)}</td></tr></tfoot>
        </table>
      </body></html>`;
    const win = window.open("", "_blank", "width=420,height=600");
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.20))]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-xl font-bold tracking-tight sm:text-3xl">Product Catalog</h1>
        <Button
          size="sm"
          disabled={!hasSelection || (!isStaff && placeOrder.isPending)}
          onClick={handleProceedClick}
          data-testid="button-proceed-order"
          className="shrink-0"
        >
          {placeOrder.isPending ? (
            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          ) : (
            <ShoppingCart className="w-4 h-4 mr-1" />
          )}
          <span className="hidden sm:inline">{proceedLabel}</span>
          <span className="sm:hidden">
            {hasSelection ? `Order (${cartCount})` : "Order"}
          </span>
        </Button>
      </div>

      {/* Compact search + filter bar */}
      <div className="mb-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              className="pl-8 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-search-products"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {showAdvancedFilters && (
            <Button
              variant={showFilters || group || brand ? "default" : "outline"}
              size="icon"
              className="h-10 w-10 shrink-0 relative"
              onClick={() => setShowFilters((v) => !v)}
              aria-label="Filters"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {(group || brand) && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary border-2 border-background" />
              )}
            </Button>
          )}
        </div>

        {/* Collapsible filter dropdowns */}
        {showAdvancedFilters && showFilters && (
          <div className="flex gap-2 flex-wrap animate-in slide-in-from-top-1 duration-150">
            <Select value={group} onValueChange={(v) => setGroup(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 flex-1 min-w-[130px] text-sm">
                <SelectValue placeholder="All Groups" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                {groups?.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={brand} onValueChange={(v) => setBrand(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 flex-1 min-w-[130px] text-sm">
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {brands?.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            {(group || brand) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-muted-foreground"
                onClick={() => { setGroup(""); setBrand(""); }}
              >
                <X className="w-3 h-3 mr-1" />Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Product grid — full width */}
      <div className="flex-1 overflow-y-auto pb-4">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...Array(10)].map((_, i) => <Card key={i} className="animate-pulse h-[320px]" />)}
          </div>
        ) : products?.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <ShoppingCart className="w-10 h-10 mb-2 opacity-30" />
            <p>No products found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {shuffledProducts.map((product) => {
              const inCart = product.id in cart;
              const qty = cart[product.id] ?? 0;
              const outOfStock = product.currentStock <= 0 && !allowsBackorder;
              // Backorder-eligible roles can order past actual stock (see
              // allowsBackorder above) — cap stays real for everyone else.
              const effectiveMaxStock = allowsBackorder ? Number.MAX_SAFE_INTEGER : product.currentStock;
              return (
                <Card
                  key={product.id}
                  data-testid={`card-product-${product.id}`}
                  className={`flex flex-col overflow-hidden transition-all ${
                    outOfStock ? "opacity-60" : ""
                  } ${
                    inCart
                      ? "border-2 border-primary ring-2 ring-primary/30 shadow-md"
                      : "border-border/50"
                  }`}
                >
                  <div className="aspect-square bg-muted flex items-center justify-center relative p-1 sm:p-2">
                    {product.imageUrl ? (
                      <button
                        type="button"
                        className="group relative h-full w-full cursor-zoom-in"
                        onClick={() => setZoomImage({ url: product.imageUrl!, name: product.name })}
                        data-testid={`button-zoom-product-${product.id}`}
                        aria-label={`View larger image of ${product.name}`}
                      >
                        <img src={product.imageUrl} alt={product.name} className="object-contain h-full w-full" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 transition-colors">
                          <ZoomIn className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 drop-shadow transition-opacity" />
                        </div>
                      </button>
                    ) : (
                      <div className="w-16 h-16 opacity-10 text-foreground">
                        <ShoppingCart className="w-full h-full" />
                      </div>
                    )}
                          <div className="absolute top-2 right-2">{getStockBadge(product.currentStock, product.unit ?? "")}</div>                             {inCart && (
                      <div className="absolute top-2 left-2">
                        <CheckCircle className="w-5 h-5 text-primary fill-background" />
                      </div>
                    )}
                  </div>
                  <CardContent className="flex-1 p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] text-muted-foreground font-mono">{product.itemCode}</div>
                      <div className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white ${
                        product.currentStock <= 0 ? "bg-red-600" :
                        product.currentStock <= 10 ? "bg-amber-500" :
                        "bg-green-600"
                    }`}>
                      {product.currentStock} {product.unit}
                     </div>
                    </div>
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</h3>
                    {!hidePrices && (
                      showRetailOnly ? (
                        <div className="text-primary font-bold text-sm">₹{product.retailPrice}</div>
                      ) : (isWholesaleCustomer || isCounterWholesale) ? (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-wrap">
                          <span>W: <span className="text-foreground font-medium">₹{product.wholesalePrice}</span></span>
                          {product.nonGstPrice != null && (
                            <>
                              <span className="text-border">|</span>
                              <span>NG: <span className="text-foreground font-medium">₹{product.nonGstPrice}</span></span>
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-wrap">
                          <span>W: <span className="text-foreground font-medium">₹{product.wholesalePrice}</span></span>
                          <span className="text-border">|</span>
                          <span>R: <span className="text-foreground font-medium">₹{product.retailPrice}</span></span>
                          {showNonGstRate && product.nonGstPrice != null && (
                            <>
                              <span className="text-border">|</span>
                              <span>NG: <span className="text-foreground font-medium">₹{product.nonGstPrice}</span></span>
                            </>
                          )}
                        </div>
                      )
                    )}
                    <div className="mt-auto flex flex-col gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0.1}
                          step={0.1}
                          max={effectiveMaxStock}
                          value={qtyDrafts[product.id] ?? (qty > 0 ? qty : "")}
                          placeholder="Qty"
                          className="h-8 w-16 text-sm text-center px-1"
                          disabled={outOfStock}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setQtyDrafts((prev) => ({ ...prev, [product.id]: raw }));
                            const val = parseFloat(raw);
                            if (!isNaN(val) && val > 0) {
                              // One decimal place — e.g. 0.5 for half a liter.
                              setQty(product.id, Math.round(val * 10) / 10, effectiveMaxStock);
                            }
                          }}
                          onBlur={() =>
                            setQtyDrafts((prev) => {
                              const next = { ...prev };
                              delete next[product.id];
                              return next;
                            })
                          }
                          data-testid={`input-qty-${product.id}`}
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 shrink-0"
                          onClick={() => decreaseQty(product.id)}
                          disabled={outOfStock || !inCart}
                          data-testid={`button-qty-minus-${product.id}`}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 shrink-0"
                          onClick={() => increaseQty(product.id, effectiveMaxStock)}
                          disabled={outOfStock || qty >= effectiveMaxStock}
                          data-testid={`button-qty-plus-${product.id}`}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        variant={inCart ? "default" : "outline"}
                        className="w-full h-8 text-xs"
                        onClick={() => inCart ? removeFromCart(product.id) : addToCart(product.id)}
                        disabled={outOfStock}
                        data-testid={`button-add-to-cart-${product.id}`}
                      >
                        {inCart ? "Remove" : "Add to Cart"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Cart Review Dialog ── */}
      <Dialog open={showCartReview} onOpenChange={setShowCartReview}>
        <DialogContent className="w-full max-w-lg mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-primary" />
              Order Summary
            </DialogTitle>
          </DialogHeader>

          {showInvoiceTypeChoice && (
            <div className="flex gap-2 pb-1">
              <Button
                type="button"
                variant={invoiceMode === "gst" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setInvoiceMode("gst")}
                data-testid="button-invoice-mode-gst"
              >
                E-Invoice
              </Button>
              <Button
                type="button"
                variant={invoiceMode === "non_gst" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setInvoiceMode("non_gst")}
                data-testid="button-invoice-mode-non-gst"
              >
                Cash Memo
              </Button>
            </div>
          )}

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 px-1">Product</th>
                  <th className="text-right py-2 px-1">Qty</th>
                  <th className="text-right py-2 px-1">Box</th>
                  <th className="text-right py-2 px-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {cartSummaryRows.map((row) => (
                  <tr key={row.product.id} className="border-b last:border-0">
                    <td className="py-2 px-1">
                      <div className="font-medium leading-tight line-clamp-2 max-w-[140px]">{row.product.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{row.product.itemCode}</div>
                    </td>
                    <td className="text-right py-2 px-1">
                     <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      max={allowsBackorder ? Number.MAX_SAFE_INTEGER : row.product.currentStock}
                      value={qtyDrafts[row.product.id] ?? row.qty}
                      onChange={(e) => {
                      const raw = e.target.value;
                      setQtyDrafts((prev) => ({ ...prev, [row.product.id]: raw }));
                      const val = parseFloat(raw);
                      if (!isNaN(val) && val > 0) {
                      // One decimal place — e.g. 0.5 for half a liter.
                      setQty(row.product.id, Math.round(val * 10) / 10, allowsBackorder ? Number.MAX_SAFE_INTEGER : row.product.currentStock);
                      }
                    }}
                    onBlur={() =>
                      setQtyDrafts((prev) => {
                        const next = { ...prev };
                        delete next[row.product.id];
                        return next;
                      })
                    }
                     className="w-16 text-right border rounded px-1 py-0.5 text-sm tabular-nums"
                   />
                 </td>
                    <td className="text-right py-2 px-1 tabular-nums text-muted-foreground">
                      {row.boxCount != null ? row.boxCount.toFixed(2).replace(/\.?0+$/, "") : "—"}
                    </td>
                    <td className="text-right py-2 px-1 tabular-nums font-semibold text-primary">
                      ₹{row.lineTotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td colSpan={3} className="pt-3 px-1 text-right text-sm text-muted-foreground">Total Box</td>
                  <td className="pt-3 px-1 text-right text-muted-foreground">{totalBox.toFixed(2).replace(/\.?0+$/, "")}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="pt-1 px-1 text-right text-sm text-muted-foreground">GST Amount</td>
                  <td className="pt-1 px-1 text-right text-muted-foreground">₹{grandGstAmount.toFixed(2)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="pt-1 px-1 font-bold text-right text-sm">Grand Total</td>
                  <td className="pt-1 px-1 text-right font-bold text-primary">₹{grandTotal.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowCartReview(false)}
              data-testid="button-cart-review-cancel"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
             <Button
               className="flex-1"
               onClick={() => {
                 if (isSalesman) {
                   openCustomerDialog();
                 } else if (isStaff) {
                   openCustomerDialog();
                 } else {
                   setShowCartReview(false);
                   handlePlaceOrder();
                }
               }}
              disabled={placeOrder.isPending}
            >
              {placeOrder.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Customer Lookup Dialog ── */}
      <Dialog open={showCustomerDialog} onOpenChange={setShowCustomerDialog}>
        <DialogContent className="w-full max-w-md mx-auto">
          {step === "mobile" && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-primary" />
                  Customer Mobile Number
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <p className="text-sm text-muted-foreground">
                  Enter the customer's mobile number to look up their profile or register a new customer.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="mobile-input">Mobile Number</Label>
                  <div className="flex gap-2">
                    <Input
                      id="mobile-input"
                      data-testid="input-customer-mobile"
                      placeholder="10-digit mobile number"
                      value={mobileInput}
                      maxLength={10}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, "");
                        setMobileInput(v);
                        setSearchMobile("");
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleMobileLookup(); }}
                      className="text-lg tracking-wider font-mono"
                    />
                    <Button
                      onClick={handleMobileLookup}
                      disabled={mobileInput.length !== 10 || isLooking}
                      data-testid="button-lookup-mobile"
                    >
                      {isLooking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                  {mobileInput.length > 0 && mobileInput.length < 10 && (
                    <p className="text-xs text-muted-foreground">{10 - mobileInput.length} more digits needed</p>
                  )}
                </div>

                <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex-1 h-px bg-border" />
                  or search by name
                  <div className="flex-1 h-px bg-border" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name-search-input">Customer Name</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="name-search-input"
                      data-testid="input-customer-name-search"
                      placeholder="Start typing a name..."
                      value={nameSearch}
                      onChange={(e) => setNameSearch(e.target.value)}
                      className="pl-8"
                    />
                  </div>
                  {trimmedNameSearch.length >= 2 && (
                    <div className="border rounded-md max-h-40 overflow-y-auto divide-y">
                      {isNameSearching ? (
                        <div className="flex items-center justify-center py-3 text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      ) : nameSearchResults && nameSearchResults.length > 0 ? (
                        nameSearchResults.map((entity: any) => (
                          <button
                            key={entity.id}
                            type="button"
                            data-testid={`option-customer-${entity.id}`}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                            onClick={() => { setFoundCustomer(entity); setStep("found"); }}
                          >
                            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="font-medium">{entity.name}</span>
                            {entity.mobile && <span className="text-muted-foreground">({entity.mobile})</span>}
                          </button>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-3">No customers match "{trimmedNameSearch}"</p>
                      )}
                    </div>
                  )}
                </div>

                <Button variant="outline" className="w-full" onClick={() => proceedToOrderWithCustomer(null)}>
                  Skip — Walk-in / Cash Customer
                </Button>
              </div>
            </>
          )}

          {step === "found" && foundCustomer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle className="w-5 h-5" />
                  Customer Found
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="bg-muted rounded-lg p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-lg">{foundCustomer.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="w-3 h-3" />
                    {foundCustomer.mobile}
                  </div>
                  {foundCustomer.gstin && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">GSTIN: </span>
                      <span className="font-mono text-xs">{foundCustomer.gstin}</span>
                    </div>
                  )}
                  {foundCustomer.address && (
                    <div className="text-sm text-muted-foreground line-clamp-2">
                      {foundCustomer.address}{foundCustomer.city ? `, ${foundCustomer.city}` : ""}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border/40">
                    <span className="text-muted-foreground">Outstanding Balance</span>
                    <span className={`font-bold ${foundCustomer.outstandingBalance > 0 ? "text-destructive" : "text-green-600"}`}>
                      ₹{Number(foundCustomer.outstandingBalance).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Pricing Tier</span>
                    <Badge variant="outline" className="capitalize">{foundCustomer.pricingTier}</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => { setStep("mobile"); setSearchMobile(""); }}>
                    Change
                  </Button>
                  <Button
                    className="flex-1"
                    onClick={() => proceedToOrderWithCustomer(foundCustomer)}
                    data-testid="button-confirm-customer"
                  >
                    Proceed to Order
                  </Button>
                </div>
              </div>
            </>
          )}

          {step === "not_found" && !canRegisterNewCustomer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-primary" />
                  Customer Not Found — {mobileInput}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  This mobile number isn't registered yet. New customers can only be registered by a
                  salesman or admin — ask one of them to add this customer first.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => { setStep("mobile"); setSearchMobile(""); }}
                >
                  Back
                </Button>
              </div>
            </>
          )}

          {step === "not_found" && canRegisterNewCustomer && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-primary" />
                  New Customer — {mobileInput}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  This mobile number is not registered. Fill in customer details to register and proceed.
                </p>
                <Form {...newCustomerForm}>
                  <form onSubmit={handleCreateCustomer} className="space-y-3">
                    <FormField
                      control={newCustomerForm.control}
                      name="name"
                      rules={{
                        validate: (value) =>
                          newCustomerForm.getValues("pricingTier") === "wholesale" && !value?.trim()
                            ? "Name is required for wholesale customers"
                            : true,
                      }}
                      render={({ field }) => {
                        const isWholesale = newCustomerForm.watch("pricingTier") === "wholesale";
                        return (
                          <FormItem>
                            <FormLabel>
                              Customer Name {isWholesale ? "*" : <span className="text-muted-foreground font-normal">(optional for retail)</span>}
                            </FormLabel>
                            <FormControl>
                              <Input
                                data-testid="input-new-customer-name"
                                placeholder={isWholesale ? "Business name" : "Leave blank for walk-in retail"}
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        );
                      }}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={newCustomerForm.control}
                        name="gstin"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>GSTIN</FormLabel>
                            <FormControl>
                              <Input data-testid="input-new-customer-gstin" placeholder="Optional" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={newCustomerForm.control}
                        name="pricingTier"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Pricing Tier</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl>
                                <SelectTrigger data-testid="select-pricing-tier">
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="retail">Retail</SelectItem>
                                <SelectItem value="wholesale">Wholesale</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={newCustomerForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address</FormLabel>
                          <FormControl>
                            <Input data-testid="input-new-customer-address" placeholder="Street address" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {isStaff && salesmenList && salesmenList.length > 0 && (
                      <FormField
                        control={newCustomerForm.control}
                        name="assignedSalesmanId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Assigned Salesman (optional)</FormLabel>
                            <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                              <FormControl>
                                <SelectTrigger data-testid="select-assigned-salesman">
                                  <SelectValue placeholder="No salesman" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="none">— No salesman —</SelectItem>
                                {salesmenList.map((s: any) => (
                                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              Credits this salesman's commission on future orders from this customer.
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={newCustomerForm.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input data-testid="input-new-customer-city" placeholder="City" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={newCustomerForm.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input data-testid="input-new-customer-state" placeholder="State" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button type="button" variant="outline" className="flex-1" onClick={() => { setStep("mobile"); setSearchMobile(""); }}>
                        Back
                      </Button>
                      <Button
                        type="submit"
                        className="flex-1"
                        disabled={createEntity.isPending}
                        data-testid="button-create-customer"
                      >
                        {createEntity.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                        Register & Proceed
                      </Button>
                    </div>
                  </form>
                </Form>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Order Placed Slip (counter logins only) ── */}
      <Dialog open={!!placedOrder} onOpenChange={(open) => { if (!open) setPlacedOrder(null); }}>
        <DialogContent className="w-full max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              Order {placedOrder?.order?.orderNo ?? ""} Submitted
            </DialogTitle>
          </DialogHeader>
          {placedOrder && (
            <div className="space-y-3">
              <div className="text-sm">
                <div><span className="text-muted-foreground">Customer:</span> {placedOrder.customer?.name ?? "Customer"}</div>
                <div><span className="text-muted-foreground">Mobile:</span> {placedOrder.customer?.mobile ?? ""}</div>
                <div><span className="text-muted-foreground">Type:</span> {placedOrder.invoiceMode === "non_gst" ? "Cash Memo" : "E-Invoice"}</div>
              </div>
              <div className="overflow-x-auto -mx-1 max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-1 px-1">Product</th>
                      <th className="text-right py-1 px-1">Qty</th>
                      <th className="text-right py-1 px-1">Rate</th>
                      <th className="text-right py-1 px-1">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {placedOrder.items.map((i, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-1 px-1">{i.name}</td>
                        <td className="text-right py-1 px-1 tabular-nums">{i.qty}</td>
                        <td className="text-right py-1 px-1 tabular-nums">₹{i.rate.toFixed(2)}</td>
                        <td className="text-right py-1 px-1 tabular-nums font-medium">₹{i.lineTotal.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between font-bold text-sm pt-1 border-t">
                <span>Total</span>
                <span>₹{placedOrder.items.reduce((s, i) => s + i.lineTotal, 0).toFixed(2)}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={handlePrintOrderSlip}>
                  Print
                </Button>
                <Button type="button" className="flex-1" onClick={() => setPlacedOrder(null)}>
                  New Order
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Product Image Zoom ── */}
      <Dialog open={!!zoomImage} onOpenChange={(open) => { if (!open) setZoomImage(null); }}>
        <DialogContent className="max-w-lg p-2">
          <DialogTitle className="sr-only">{zoomImage?.name}</DialogTitle>
          {zoomImage && (
            <img
              src={zoomImage.url}
              alt={zoomImage.name}
              className="w-full h-auto max-h-[80vh] object-contain rounded"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
