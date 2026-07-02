import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListProducts,
  useCreateEntity,
  useCreateCustomerOrder,
  useListCustomerOrders,
  useUpdateCustomerOrderStatus,
  useLookupEntityByMobile,
  getListCustomerOrdersQueryKey,
  getLookupEntityByMobileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Plus,
  Minus,
  ShoppingCart,
  Loader2,
  Send,
  Save,
  UserPlus,
  Phone,
  CheckCircle,
} from "lucide-react";

type CartItem = { qty: number };

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  processing: { label: "Processing", className: "bg-blue-100 text-blue-800 hover:bg-blue-100" },
  production: { label: "Production", className: "bg-indigo-100 text-indigo-800 hover:bg-indigo-100" },
  ready_for_dispatch: { label: "Ready", className: "bg-cyan-100 text-cyan-800 hover:bg-cyan-100" },
  dispatched: { label: "Dispatched", className: "bg-purple-100 text-purple-800 hover:bg-purple-100" },
  delivered: { label: "Delivered", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  done: { label: "Completed", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  cancelled: { label: "Cancelled", className: "bg-red-100 text-red-800 hover:bg-red-100" },
};

function StatusBadge({ status, isDraft }: { status: string; isDraft?: boolean }) {
  if (isDraft) {
    return (
      <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100" data-testid={`status-draft`}>
        Draft
      </Badge>
    );
  }
  const v = STATUS_VARIANTS[status] ?? { label: status, className: "" };
  return <Badge className={v.className} data-testid={`status-${status}`}>{v.label}</Badge>;
}

export default function SalesmanOrders() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Salesmen now create orders via Catalog → Order, not this page.
  useEffect(() => {
    if (user?.role === "salesman") {
      setLocation("/catalog");
    }
  }, [user?.role, setLocation]);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<number, CartItem>>({});

  // Customer details
  const [customerName, setCustomerName] = useState("");
  const [customerMobile, setCustomerMobile] = useState("");
  const [district, setDistrict] = useState("");
  const [area, setArea] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [entityId, setEntityId] = useState<number | null>(null);
  const [searchMobile, setSearchMobile] = useState("");

  const { data: products, isLoading } = useListProducts({
    search: search || undefined,
    forSale: true,
  });

  const { data: orders, isLoading: ordersLoading } = useListCustomerOrders();

  const createEntity = useCreateEntity();
  const createOrder = useCreateCustomerOrder();
  const updateStatus = useUpdateCustomerOrderStatus();

  // Lookup existing customer by mobile
  const { data: lookupResult, isFetching: isLooking } = useLookupEntityByMobile(
    { mobile: searchMobile },
    {
      query: {
        enabled: searchMobile.length === 10,
        queryKey: getLookupEntityByMobileQueryKey({ mobile: searchMobile }),
      },
    },
  );

  const foundCustomer =
    lookupResult?.found && lookupResult.entity ? lookupResult.entity : null;

  const distinctItems = Object.keys(cart).length;
  const totalItems = Object.values(cart).reduce((a, b) => a + b.qty, 0);
  const totalAmount = Object.entries(cart).reduce((total, [id, { qty }]) => {
    const product = products?.find((p) => p.id === Number(id));
    if (!product) return total;
    return total + qty * product.wholesalePrice;
  }, 0);

  const addToCart = (productId: number) => {
    setCart((prev) => ({
      ...prev,
      [productId]: { qty: (prev[productId]?.qty || 0) + 1 },
    }));
  };

  const removeFromCart = (productId: number) => {
    setCart((prev) => {
      const newCart = { ...prev };
      if (newCart[productId] && newCart[productId].qty > 1) {
        newCart[productId] = { qty: newCart[productId].qty - 1 };
      } else {
        delete newCart[productId];
      }
      return newCart;
    });
  };

  const resetForm = () => {
    setCart({});
    setCustomerName("");
    setCustomerMobile("");
    setDistrict("");
    setArea("");
    setPinCode("");
    setEntityId(null);
    setSearchMobile("");
  };

  const handleLookup = () => {
    if (customerMobile.length !== 10) return;
    setSearchMobile(customerMobile);
  };

  const useFoundCustomer = () => {
    if (!foundCustomer) return;
    setEntityId(foundCustomer.id);
    setCustomerName(foundCustomer.name ?? "");
    setCustomerMobile(foundCustomer.mobile ?? customerMobile);
    toast({ title: "Customer selected", description: foundCustomer.name ?? "" });
  };

  const buildItems = () =>
    Object.entries(cart)
      .map(([id, { qty }]) => ({ productId: Number(id), qty }))
      .filter((i) => i.qty > 0);

  const placeOrder = async (isDraft: boolean) => {
    const items = buildItems();
    if (items.length === 0) {
      toast({
        title: "Cart is empty",
        description: "Add at least one product to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!customerName.trim() && !entityId) {
      toast({
        title: "Customer required",
        description: "Enter a customer name or select an existing customer.",
        variant: "destructive",
      });
      return;
    }

    let resolvedEntityId = entityId;

    // Create new customer entity if none selected and mobile provided
    if (!resolvedEntityId && customerMobile.length === 10) {
      try {
        const newEntity = await createEntity.mutateAsync({
          data: {
            type: "customer",
            name: customerName || undefined,
            mobile: customerMobile,
            district: district || undefined,
            area: area || undefined,
            pinCode: pinCode || undefined,
          },
        });
        resolvedEntityId = newEntity.id;
        setEntityId(newEntity.id);
      } catch (err: any) {
        toast({
          title: "Failed to create customer",
          description: err?.message ?? "Please try again",
          variant: "destructive",
        });
        return;
      }
    }

    createOrder.mutate(
      {
        data: {
          entityId: resolvedEntityId ?? undefined,
          items,
          customerName: customerName || undefined,
          customerMobile: customerMobile || undefined,
          isDraft,
        },
      },
      {
        onSuccess: (order: any) => {
          toast({
            title: isDraft ? "Draft saved" : "Order submitted",
            description: `Order ${order.orderNo ?? `#${order.id}`} ${isDraft ? "saved as draft" : "submitted"}.`,
          });
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
          resetForm();
        },
        onError: (err: any) =>
          toast({
            title: isDraft ? "Failed to save draft" : "Failed to submit order",
            description: err?.message ?? "Please try again",
            variant: "destructive",
          }),
      },
    );
  };

  const submitDraft = (id: number) => {
    updateStatus.mutate(
      { id, data: { status: "processing", isDraft: false } },
      {
        onSuccess: () => {
          toast({ title: "Order submitted", description: "Draft converted to a live order." });
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
        },
        onError: (err: any) =>
          toast({
            title: "Failed to submit",
            description: err?.message ?? "Please try again",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <ShoppingCart className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Order</h1>
          <p className="text-sm text-muted-foreground">
            Build an order for a customer{user?.name ? ` — ${user.name}` : ""}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Products */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Products</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-products"
                />
              </div>
              {isLoading ? (
                <div className="flex items-center justify-center p-12 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
                </div>
              ) : !products || products.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">No products found.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {products.map((product) => (
                    <Card
                      key={product.id}
                      data-testid={`card-product-${product.id}`}
                      className="flex flex-col border-border/50"
                    >
                      <CardContent className="p-3 flex flex-col gap-2 flex-1">
                        <div className="text-[10px] text-muted-foreground font-mono">{product.itemCode}</div>
                        <h3 className="font-semibold text-sm leading-tight line-clamp-2">{product.name}</h3>
                        <div className="text-primary font-bold text-sm">₹{product.wholesalePrice}</div>
                        <div className="mt-auto">
                          {cart[product.id] ? (
                            <div className="flex items-center justify-between w-full gap-2">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() => removeFromCart(product.id)}
                                data-testid={`button-remove-${product.id}`}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="font-bold text-sm w-6 text-center">{cart[product.id].qty}</span>
                              <Button
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => addToCart(product.id)}
                                data-testid={`button-add-${product.id}`}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              className="w-full h-8 text-xs"
                              onClick={() => addToCart(product.id)}
                              data-testid={`button-addcart-${product.id}`}
                            >
                              <Plus className="w-3 h-3 mr-1" />
                              Add
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Customer + Cart */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-primary" /> Customer
              </CardTitle>
              <CardDescription>Look up by mobile or enter a new customer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cust-mobile">Mobile Number</Label>
                <div className="flex gap-2">
                  <Input
                    id="cust-mobile"
                    placeholder="10-digit mobile"
                    value={customerMobile}
                    maxLength={10}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      setCustomerMobile(v);
                      setEntityId(null);
                      setSearchMobile("");
                    }}
                    className="font-mono"
                    data-testid="input-customer-mobile"
                  />
                  <Button
                    variant="outline"
                    onClick={handleLookup}
                    disabled={customerMobile.length !== 10 || isLooking}
                    data-testid="button-lookup-mobile"
                  >
                    {isLooking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {foundCustomer && entityId !== foundCustomer.id && (
                <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="font-medium">{foundCustomer.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Phone className="w-3 h-3" /> {foundCustomer.mobile}
                  </div>
                  <Button size="sm" className="w-full" onClick={useFoundCustomer} data-testid="button-use-customer">
                    Use this customer
                  </Button>
                </div>
              )}

              {entityId && (
                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                  Existing customer selected
                </Badge>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="cust-name">Customer Name</Label>
                <Input
                  id="cust-name"
                  placeholder="Customer name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  data-testid="input-customer-name"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cust-district">District</Label>
                  <Input
                    id="cust-district"
                    placeholder="Optional"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    data-testid="input-customer-district"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cust-area">Area</Label>
                  <Input
                    id="cust-area"
                    placeholder="Optional"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    data-testid="input-customer-area"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cust-pin">Pin Code</Label>
                <Input
                  id="cust-pin"
                  placeholder="Optional"
                  value={pinCode}
                  onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  data-testid="input-customer-pincode"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Cart</span>
                <Badge variant="secondary" data-testid="badge-cart-count">
                  {distinctItems} {distinctItems === 1 ? "item" : "items"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {distinctItems === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6 flex flex-col items-center">
                  <ShoppingCart className="w-8 h-8 mb-2 opacity-20" />
                  Cart is empty
                </div>
              ) : (
                Object.entries(cart).map(([id, { qty }]) => {
                  const product = products?.find((p) => p.id === Number(id));
                  if (!product) return null;
                  return (
                    <div key={id} data-testid={`cart-item-${id}`} className="flex justify-between text-sm gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs line-clamp-1">{product.name}</p>
                        <p className="text-muted-foreground text-xs">
                          {qty} × ₹{product.wholesalePrice}
                        </p>
                      </div>
                      <div className="font-bold text-xs shrink-0">
                        ₹{(qty * product.wholesalePrice).toLocaleString("en-IN")}
                      </div>
                    </div>
                  );
                })
              )}
              <div className="flex justify-between font-bold border-t pt-3">
                <span>Total</span>
                <span className="text-primary">₹{totalAmount.toLocaleString("en-IN")}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 pt-1">
                <Button
                  variant="outline"
                  disabled={totalItems === 0 || createOrder.isPending || createEntity.isPending}
                  onClick={() => placeOrder(true)}
                  data-testid="button-save-draft"
                >
                  {createOrder.isPending || createEntity.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save as Draft
                </Button>
                <Button
                  disabled={totalItems === 0 || createOrder.isPending || createEntity.isPending}
                  onClick={() => placeOrder(false)}
                  data-testid="button-submit-order"
                >
                  {createOrder.isPending || createEntity.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Submit Order
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* My orders */}
      <Card>
        <CardHeader>
          <CardTitle>My Orders</CardTitle>
          <CardDescription>Drafts and submitted orders.</CardDescription>
        </CardHeader>
        <CardContent>
          {ordersLoading ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">No orders yet.</div>
          ) : (
            <div className="border rounded-md overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order No</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id} data-testid={`order-row-${o.id}`}>
                      <TableCell className="font-mono text-xs">{o.orderNo ?? `#${o.id}`}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell>{o.customerName}</TableCell>
                      <TableCell className="text-right">{o.totalItems}</TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{Number(o.totalAmount).toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={o.status} isDraft={o.isDraft} />
                      </TableCell>
                      <TableCell className="text-right">
                        {o.isDraft && (
                          <Button
                            size="sm"
                            onClick={() => submitDraft(o.id)}
                            disabled={updateStatus.isPending}
                            data-testid={`button-submit-draft-${o.id}`}
                          >
                            {updateStatus.isPending ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                            ) : (
                              <Send className="w-3 h-3 mr-1" />
                            )}
                            Submit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
