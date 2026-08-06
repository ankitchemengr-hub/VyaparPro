import { useState } from "react";
import { useListProducts, getListProductsQueryKey, useGetItemRegister, getGetItemRegisterQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { History, Search, ChevronsUpDown, Check, Loader2, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Package } from "lucide-react";

const REASON_LABEL: Record<string, string> = {
  purchase: "Purchase",
  invoice: "Invoice sale",
  invoice_edit: "Invoice edited",
  invoice_edit_reversal: "Invoice edit — reversed",
  sales_return: "Sales return",
  workload: "Manufacturing",
  material_transfer: "Material transfer",
  stock_reconciliation: "Stock adjustment",
};

function ProductPicker({
  value, onChange, placeholder = "Search item by name...",
}: {
  value: { id: number; name: string } | null;
  onChange: (p: { id: number; name: string } | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const productSearchParams = { search: trimmed || undefined };
  const { data: products, isFetching } = useListProducts(
    productSearchParams,
    { query: { enabled: trimmed.length >= 1, queryKey: getListProductsQueryKey(productSearchParams) } },
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          type="button"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid="button-item-register-product"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value ? value.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type an item name..." value={query} onValueChange={setQuery} />
          <CommandList className="max-h-64">
            {trimmed.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Start typing to search products.</div>
            ) : isFetching ? (
              <div className="p-3 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                <CommandEmpty>No products found.</CommandEmpty>
                <CommandGroup>
                  {(products ?? []).map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.name}
                      onSelect={() => { onChange({ id: p.id, name: p.name }); setOpen(false); setQuery(""); }}
                      data-testid={`item-register-product-option-${p.id}`}
                    >
                      <Check className={cn("mr-2 h-4 w-4 shrink-0", value?.id === p.id ? "opacity-100" : "opacity-0")} />
                      <span className="truncate">{p.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default function ItemRegister() {
  const [product, setProduct] = useState<{ id: number; name: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Only the params behind the last Search click drive the query — typing a
  // new date or picking a different item doesn't refetch until asked to,
  // so partial/mid-edit filter combinations never fire a request.
  const [searchParams, setSearchParams] = useState<{ productId: number; from?: string; to?: string } | null>(null);

  const canSearch = !!product;
  const handleSearch = () => {
    if (!product) return;
    setSearchParams({ productId: product.id, from: from || undefined, to: to || undefined });
  };

  const { data: report, isFetching, isError } = useGetItemRegister(
    searchParams ?? { productId: 0 },
    { query: { enabled: !!searchParams, queryKey: getGetItemRegisterQueryKey(searchParams ?? { productId: 0 }) } },
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <History className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Item Register</h1>
          <p className="text-sm text-muted-foreground">Purchase, sale and adjustment movement for one item over a date range.</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-5 pb-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_160px_160px_auto] items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">Item Name</Label>
              <ProductPicker value={product} onChange={setProduct} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-item-register-from" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Upto Date</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-item-register-to" />
            </div>
            <Button onClick={handleSearch} disabled={!canSearch || isFetching} data-testid="button-item-register-search">
              {isFetching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {!searchParams && (
        <div className="text-center py-16 text-muted-foreground text-sm flex flex-col items-center gap-2">
          <Package className="w-8 h-8 opacity-40" />
          Pick an item and hit Search to see its movement register.
        </div>
      )}

      {isError && (
        <div className="text-center py-8 text-destructive text-sm">Could not load this item's register. Try again.</div>
      )}

      {report && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Purchased</CardTitle>
                <ArrowDownToLine className="w-4 h-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600" data-testid="text-item-register-purchased">
                  {report.purchasedQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{report.unit}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Sold</CardTitle>
                <ArrowUpFromLine className="w-4 h-4 text-amber-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-amber-600" data-testid="text-item-register-sold">
                  {report.soldQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{report.unit}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Adjusted</CardTitle>
                <SlidersHorizontal className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${report.adjustedQty < 0 ? "text-destructive" : "text-primary"}`} data-testid="text-item-register-adjusted">
                  {report.adjustedQty > 0 ? "+" : ""}{report.adjustedQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{report.unit}</p>
              </CardContent>
            </Card>
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Available</CardTitle>
                <Package className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary" data-testid="text-item-register-available">
                  {report.currentStock.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{report.unit} — right now</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {report.productName} — movements {(from || to) && <span className="text-muted-foreground font-normal">({from ? format(new Date(from), "dd MMM yyyy") : "start"} – {to ? format(new Date(to), "dd MMM yyyy") : "today"})</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.movements.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No stock movement in this range.</TableCell></TableRow>
                    ) : (
                      report.movements.map((m) => {
                        const isIn = m.type === "inward" || (m.type === "adjustment" && m.quantity > 0);
                        return (
                          <TableRow key={m.id} data-testid={`item-register-movement-${m.id}`}>
                            <TableCell className="text-sm whitespace-nowrap">{format(new Date(m.date), "dd MMM yyyy, hh:mm a")}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={isIn ? "text-emerald-700 border-emerald-300" : "text-amber-700 border-amber-300"}>
                                {REASON_LABEL[m.referenceType ?? ""] ?? m.referenceType ?? m.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{m.reason}</TableCell>
                            <TableCell className={`text-right font-medium tabular-nums ${isIn ? "text-emerald-700" : "text-amber-700"}`}>
                              {isIn ? "+" : "-"}{Math.abs(m.quantity).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
