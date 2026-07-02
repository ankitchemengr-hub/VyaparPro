import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListProducts,
  useListProductGroups,
  useListBrands,
  useLookupEntityByMobile,
  useCreateEntity,
  useCreateCustomerOrder,
  getListCustomerOrdersQueryKey,
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
import { Search, Plus, Minus, ShoppingCart, Phone, User, CheckCircle, UserPlus, Loader2, X, SlidersHorizontal } from "lucide-react";
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
  const [showFilters, setShowFilters] = useState(false);

  // Cart review dialog (shown before customer lookup)
  const [showCartReview, setShowCartReview] = useState(false);

  // Customer lookup dialog state
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [mobileInput, setMobileInput] = useState("");
  const [searchMobile, setSearchMobile] = useState("");
  const [step, setStep] = useState<"mobile" | "not_found" | "found">("mobile");
  const [foundCustomer, setFoundCustomer] = useState<any>(null);

  const { data: products, isLoading } = useListProducts({
    search: search || undefined,
    group: group || undefined,
    brand: brand || undefined,
    forSale: true,
  });
  const { data: groups } = useListProductGroups();
  const { data: brands } = useListBrands();

  const isB2B = user?.role === "customer";
  const isManufacturing = user?.role === "manufacturing";
  const isSalesman = user?.role === "salesman";
  const showRetailOnly = isB2B || isManufacturing;
  const hidePrices = isSalesman;
  const showAdvancedFilters = !isSalesman;
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
    const clamped = Math.max(1, Math.min(maxStock, qty));
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

  const getStockBadge = (stock: number) => {
    if (stock > 10) return <Badge className="bg-green-600 text-white border-transparent text-[10px]">In Stock</Badge>;
    if (stock > 0) return <Badge variant="outline" className="text-amber-500 border-amber-500 text-[10px]">Only {stock} Left!</Badge>;
    return <Badge variant="destructive" className="text-[10px]">Out of Stock</Badge>;
  };

  const handlePlaceOrder = () => {
    if (!hasSelection) return;
    placeOrder.mutate(
      { data: { items: cartItems } },
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
      },
    );
  };

  const isStaff = hasRole(["admin", "salesman", "store", "manufacturing", "accountant"]);

  // Cart summary rows — join cart with product details
  const cartSummaryRows = cartItems.map(({ productId, qty }) => {
    const product = products?.find((p) => p.id === productId);
    if (!product) return null;
    const rate = showRetailOnly ? Number(product.retailPrice) : Number(product.wholesalePrice);
    const gstRate = Number(product.gstRate ?? 0);
    const baseAmount = rate * qty;
    const gstAmount = (baseAmount * gstRate) / 100;
    const lineTotal = baseAmount + gstAmount;
    return { product, qty, rate, gstRate, gstAmount, lineTotal };
  }).filter(Boolean) as Array<{
    product: NonNullable<typeof products>[number];
    qty: number;
    rate: number;
    gstRate: number;
    gstAmount: number;
    lineTotal: number;
  }>;

  const grandTotal = cartSummaryRows.reduce((sum, r) => sum + r.lineTotal, 0);

  // Lookup hook — only fires when searchMobile is set
  const { data: lookupResult, isFetching: isLooking } = useLookupEntityByMobile(
    { mobile: searchMobile },
    { query: { enabled: searchMobile.length === 10, queryKey: getLookupEntityByMobileQueryKey({ mobile: searchMobile }) } }
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
    const cartParam = encodeURIComponent(JSON.stringify(cartItems));
    const customerParam = encodeURIComponent(JSON.stringify(customer));
    setLocation(`/billing?cart=${cartParam}&customer=${customerParam}`);
  };

  // Opens cart review dialog; non-staff customers skip straight to place order
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
    newCustomerForm.reset({ name: "", mobile: "", gstin: "", address: "", city: "", state: "Maharashtra", pricingTier: "retail" });
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
    },
  });

  const createEntity = useCreateEntity();

  const handleCreateCustomer = newCustomerForm.handleSubmit(async (data) => {
    createEntity.mutate(
      { data: { type: "customer", ...data, mobile: mobileInput } },
      {
        onSuccess: (newCustomer) => {
          proceedToOrderWithCustomer(newCustomer);
        },
      }
    );
  });

  const proceedLabel = `Proceed to Order${hasSelection ? ` (${cartCount} Item${cartCount !== 1 ? "s" : ""})` : ""}`;

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
            {products?.map((product) => {
              const inCart = product.id in cart;
              const qty = cart[product.id] ?? 0;
              const outOfStock = product.currentStock <= 0;
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
                      <img src={product.imageUrl} alt={product.name} className="object-contain h-full w-full" />
                    ) : (
                      <div className="w-16 h-16 opacity-10 text-foreground">
                        <ShoppingCart className="w-full h-full" />
                      </div>
                    )}
                    <div className="absolute top-2 right-2">{getStockBadge(product.currentStock)}</div>
                    {inCart && (
                      <div className="absolute top-2 left-2">
                        <CheckCircle className="w-5 h-5 text-primary fill-background" />
                      </div>
                    )}
                  </div>
                  <CardContent className="flex-1 p-3 flex flex-col gap-2">
                    <div className="text-[10px] text-muted-foreground font-mono">{product.itemCode}</div>
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</h3>
                    {!hidePrices && (
                      showRetailOnly ? (
                        <div className="text-primary font-bold text-sm">₹{product.retailPrice}</div>
                      ) : (
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground flex-wrap">
                          <span>W: <span className="text-foreground font-medium">₹{product.wholesalePrice}</span></span>
                          <span className="text-border">|</span>
                          <span>R: <span className="text-foreground font-medium">₹{product.retailPrice}</span></span>
                        </div>
                      )
                    )}
                    <div className="mt-auto flex flex-col gap-2">
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          max={product.currentStock}
                          value={qty > 0 ? qty : ""}
                          placeholder="Qty"
                          className="h-8 w-16 text-sm text-center px-1"
                          disabled={outOfStock}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10);
                            if (!isNaN(val) && val > 0) {
                              setQty(product.id, val, product.currentStock);
                            }
                          }}
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
                          onClick={() => increaseQty(product.id, product.currentStock)}
                          disabled={outOfStock || qty >= product.currentStock}
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

          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left py-2 px-1">Product</th>
                  <th className="text-right py-2 px-1">Qty</th>
                  <th className="text-right py-2 px-1">Rate</th>
                  <th className="text-right py-2 px-1">GST</th>
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
                    <td className="text-right py-2 px-1 tabular-nums">{row.qty}</td>
                    <td className="text-right py-2 px-1 tabular-nums">₹{row.rate.toFixed(2)}</td>
                    <td className="text-right py-2 px-1 tabular-nums text-muted-foreground">
                      {row.gstRate > 0 ? `₹${row.gstAmount.toFixed(2)}` : "—"}
                    </td>
                    <td className="text-right py-2 px-1 tabular-nums font-semibold text-primary">
                      ₹{row.lineTotal.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td colSpan={4} className="pt-3 px-1 font-bold text-right text-sm">Grand Total</td>
                  <td className="pt-3 px-1 text-right font-bold text-primary">₹{grandTotal.toFixed(2)}</td>
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
                if (isStaff) {
                  openCustomerDialog();
                } else {
                  setShowCartReview(false);
                  handlePlaceOrder();
                }
              }}
              disabled={placeOrder.isPending}
              data-testid="button-cart-review-continue"
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

          {step === "not_found" && (
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
    </div>
  );
}
