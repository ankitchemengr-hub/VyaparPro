// Customer Orders → New Order: admin / store takes an order in two steps —
// first the customer (found by mobile, or a new one), then the items.
import { useState } from "react";
import {
  useListProducts,
  useCreateEntity,
  useCreateCustomerOrder,
  useLookupEntityByMobile,
  getListCustomerOrdersQueryKey,
  getLookupEntityByMobileQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Search, Plus, Minus, Loader2, Send, CheckCircle, UserRound, Pencil, ArrowRight } from "lucide-react";

interface Customer {
  entityId: number | null;
  name: string;
  mobile: string;
  district: string;
  area: string;
  pinCode: string;
}
const EMPTY: Customer = { entityId: null, name: "", mobile: "", district: "", area: "", pinCode: "" };

export function NewOrderForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [customer, setCustomer] = useState<Customer>(EMPTY);
  return step === 1 ? (
    <CustomerStep value={customer} onChange={setCustomer} onNext={() => { setStep(2); window.scrollTo({ top: 0 }); }} />
  ) : (
    <ItemsStep customer={customer} onEditCustomer={() => setStep(1)} onDone={onDone} />
  );
}

function StepHead({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-semibold">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs">{n}</span>
      {title}
      <span className="ml-auto text-xs font-normal text-muted-foreground">Step {n} of 2</span>
    </div>
  );
}

function CustomerStep({ value, onChange, onNext }: { value: Customer; onChange: (c: Customer) => void; onNext: () => void }) {
  const set = (patch: Partial<Customer>) => onChange({ ...value, ...patch });
  const mobile = value.mobile;
  const { data: lookup, isFetching } = useLookupEntityByMobile(
    { mobile },
    { query: { enabled: mobile.length === 10, queryKey: getLookupEntityByMobileQueryKey({ mobile }) } },
  );
  const found = lookup?.found && lookup.entity ? lookup.entity : null;
  const canNext = !!value.entityId || value.name.trim().length > 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <StepHead n={1} title="Customer details" />
        <div className="space-y-1.5">
          <Label htmlFor="no-mobile">Mobile number</Label>
          <div className="relative">
            <Input
              id="no-mobile"
              inputMode="numeric"
              placeholder="10-digit mobile"
              value={mobile}
              maxLength={10}
              onChange={(e) => set({ mobile: e.target.value.replace(/\D/g, ""), entityId: null })}
              className="font-mono pr-9"
              data-testid="input-customer-mobile"
            />
            {isFetching && <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {found && value.entityId !== found.id && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm flex items-center gap-3">
            <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{found.name}</div>
              <div className="text-xs text-muted-foreground">Already a customer</div>
            </div>
            <Button
              size="sm"
              onClick={() => set({ entityId: found.id, name: found.name ?? "", mobile: found.mobile ?? mobile })}
              data-testid="button-use-customer"
            >
              Use
            </Button>
          </div>
        )}
        {value.entityId && (
          <div className="rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 px-3 py-2 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {value.name} selected
          </div>
        )}

        {!value.entityId && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="no-name">Customer name</Label>
              <Input id="no-name" placeholder="Customer name" value={value.name} onChange={(e) => set({ name: e.target.value })} data-testid="input-customer-name" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="no-district">District</Label>
                <Input id="no-district" placeholder="Optional" value={value.district} onChange={(e) => set({ district: e.target.value })} data-testid="input-customer-district" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="no-area">Area</Label>
                <Input id="no-area" placeholder="Optional" value={value.area} onChange={(e) => set({ area: e.target.value })} data-testid="input-customer-area" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="no-pin">Pin code</Label>
              <Input id="no-pin" inputMode="numeric" placeholder="Optional" maxLength={6} value={value.pinCode} onChange={(e) => set({ pinCode: e.target.value.replace(/\D/g, "") })} data-testid="input-customer-pincode" />
            </div>
          </>
        )}

        <Button className="w-full" disabled={!canNext} onClick={onNext} data-testid="button-next-items">
          Next: Add items <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

function ItemsStep({ customer, onEditCustomer, onDone }: { customer: Customer; onEditCustomer: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<number, { qty: number; name: string; price: number }>>({});
  const { data: products, isLoading } = useListProducts({ search: search || undefined, forSale: true });
  const createEntity = useCreateEntity();
  const createOrder = useCreateCustomerOrder();
  const busy = createEntity.isPending || createOrder.isPending;

  const change = (p: { id: number; name: string; wholesalePrice: number }, delta: number) =>
    setCart((prev) => {
      const qty = (prev[p.id]?.qty ?? 0) + delta;
      const next = { ...prev };
      if (qty <= 0) delete next[p.id];
      else next[p.id] = { qty, name: p.name, price: Number(p.wholesalePrice) };
      return next;
    });

  const lines = Object.entries(cart);
  const total = lines.reduce((s, [, l]) => s + l.qty * l.price, 0);

  const submit = async () => {
    const items = lines.map(([id, l]) => ({ productId: Number(id), qty: l.qty }));
    if (!items.length) return;
    let entityId = customer.entityId;
    if (!entityId && customer.mobile.length === 10) {
      try {
        const e = await createEntity.mutateAsync({
          data: {
            type: "customer",
            name: customer.name || undefined,
            mobile: customer.mobile,
            district: customer.district || undefined,
            area: customer.area || undefined,
            pinCode: customer.pinCode || undefined,
          },
        });
        entityId = e.id;
      } catch (err: any) {
        toast({ title: "Could not save the customer", description: err?.message ?? "Please try again", variant: "destructive" });
        return;
      }
    }
    createOrder.mutate(
      {
        data: {
          entityId: entityId ?? undefined,
          items,
          customerName: customer.name || undefined,
          customerMobile: customer.mobile || undefined,
          isDraft: false,
        },
      },
      {
        onSuccess: (order: any) => {
          toast({ title: "Order saved", description: `Order ${order.orderNo ?? `#${order.id}`} for ${customer.name}.` });
          queryClient.invalidateQueries({ queryKey: getListCustomerOrdersQueryKey() });
          onDone();
        },
        onError: (err: any) => toast({ title: "Could not save the order", description: err?.message ?? "Please try again", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="space-y-3 pb-24">
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <UserRound className="w-5 h-5 text-primary shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate" data-testid="text-order-customer">{customer.name || "Customer"}</div>
            {customer.mobile && <div className="text-xs text-muted-foreground font-mono">{customer.mobile}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onEditCustomer} data-testid="button-edit-customer">
            <Pencil className="w-3.5 h-3.5 mr-1" /> Change
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <StepHead n={2} title="Items" />
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search products…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-products" />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
          ) : !products?.length ? (
            <div className="text-center text-muted-foreground py-10">No products found.</div>
          ) : (
            <div className="divide-y rounded-md border">
              {products.map((p) => {
                const qty = cart[p.id]?.qty ?? 0;
                return (
                  <div key={p.id} className={`flex items-center gap-3 px-3 py-2 ${qty ? "bg-primary/5" : ""}`} data-testid={`row-product-${p.id}`}>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium leading-tight line-clamp-2">{p.name}</div>
                      <div className="text-xs text-muted-foreground">₹{Number(p.wholesalePrice).toLocaleString("en-IN")}</div>
                    </div>
                    {qty ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => change(p, -1)} data-testid={`button-remove-${p.id}`}><Minus className="h-3 w-3" /></Button>
                        <span className="w-7 text-center text-sm font-bold">{qty}</span>
                        <Button size="icon" className="h-8 w-8" onClick={() => change(p, 1)} data-testid={`button-add-${p.id}`}><Plus className="h-3 w-3" /></Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="shrink-0" onClick={() => change(p, 1)} data-testid={`button-addcart-${p.id}`}>
                        <Plus className="w-3 h-3 mr-1" /> Add
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {lines.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-1.5 text-sm">
            <div className="font-semibold mb-1">Order items</div>
            {lines.map(([id, l]) => (
              <div key={id} className="flex justify-between gap-2" data-testid={`cart-item-${id}`}>
                <span className="min-w-0 truncate">{l.name} × {l.qty}</span>
                <span className="shrink-0">₹{(l.qty * l.price).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur px-4 py-3 md:left-auto md:right-0 md:w-auto md:rounded-tl-lg md:border-l">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 md:flex-none text-sm">
            <div className="text-xs text-muted-foreground">{lines.length} {lines.length === 1 ? "item" : "items"}</div>
            <div className="font-bold" data-testid="text-order-total">₹{total.toLocaleString("en-IN")}</div>
          </div>
          <Button disabled={!lines.length || busy} onClick={submit} data-testid="button-submit-order">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Save Order
          </Button>
        </div>
      </div>
    </div>
  );
}
