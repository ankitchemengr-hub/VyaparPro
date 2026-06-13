import React from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Package, Users, FileText } from "lucide-react";
import { useGlobalSearch, getGlobalSearchQueryKey } from "@workspace/api-client-react";
import { moduleNavItems } from "@/lib/nav-items";

export default function Menu() {
  const { user, hasRole } = useAuth();
  const [query, setQuery] = React.useState("");
  const trimmed = query.trim();

  const { data: results, isFetching } = useGlobalSearch(
    { q: trimmed },
    { query: { queryKey: getGlobalSearchQueryKey({ q: trimmed }), enabled: trimmed.length >= 2 } },
  );

  const modules = moduleNavItems.filter((item) => hasRole(item.roles as any));

  const hasResults =
    results &&
    ((results.products?.length ?? 0) > 0 ||
      (results.entities?.length ?? 0) > 0 ||
      (results.invoices?.length ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Menu</h1>
        <p className="text-muted-foreground mt-2">
          Quick access to every module, plus global search across products, customers and invoices.
        </p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, customers, invoices..."
          className="pl-9"
          data-testid="input-global-search"
        />
      </div>

      {trimmed.length >= 2 && (
        <Card>
          <CardContent className="p-4 space-y-4">
            {isFetching && !results ? (
              <p className="text-sm text-muted-foreground">Searching...</p>
            ) : hasResults ? (
              <div className="space-y-5">
                {(results?.products?.length ?? 0) > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Package className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Products</h3>
                    </div>
                    <div className="space-y-1">
                      {results!.products.map((p) => (
                        <Link key={p.id} href="/inventory">
                          <div
                            className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                            data-testid={`search-product-${p.id}`}
                          >
                            <span className="font-medium">{p.name}</span>
                            <Badge variant="secondary">
                              {p.currentStock} {p.unit}
                            </Badge>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {(results?.entities?.length ?? 0) > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Users className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Customers & Entities</h3>
                    </div>
                    <div className="space-y-1">
                      {results!.entities.map((e) => (
                        <Link key={e.id} href={`/customers/${e.id}`}>
                          <div
                            className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                            data-testid={`search-entity-${e.id}`}
                          >
                            <span className="font-medium">{e.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{e.type}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {(results?.invoices?.length ?? 0) > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Invoices</h3>
                    </div>
                    <div className="space-y-1">
                      {results!.invoices.map((inv) => (
                        <Link key={inv.id} href={`/invoices/${inv.id}`}>
                          <div
                            className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted cursor-pointer"
                            data-testid={`search-invoice-${inv.id}`}
                          >
                            <span className="font-medium">{inv.invoiceNo}</span>
                            <span className="text-xs text-muted-foreground">
                              {inv.customerName || "Cash Sale"} · ₹{inv.grandTotal.toLocaleString()}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No results for "{trimmed}".</p>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h2 className="text-lg font-semibold mb-3">Modules</h2>
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {modules.map((item) => (
            <Link key={item.href} href={item.href}>
              <Card
                className="hover:border-primary hover:shadow-sm transition-colors cursor-pointer h-full"
                data-testid={`menu-tile-${item.href.replace(/\//g, "")}`}
              >
                <CardContent className="p-4 flex flex-col gap-2">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
