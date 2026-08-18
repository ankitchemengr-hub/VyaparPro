import React from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import {
  useListCustomerOrders, getListCustomerOrdersQueryKey,
  useListEntities, getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { moduleNavItems } from "@/lib/nav-items";

// Cycled per tile so the module grid reads as colorful/scannable at a glance
// instead of every icon box sharing one flat brand-orange tint. Each entry is
// a light pastel background + a matching saturated icon/border color, with a
// dark-mode variant so the page still works if the app theme is ever toggled.
const TILE_COLORS = [
  { bg: "bg-blue-50 dark:bg-blue-950/40", icon: "text-blue-600 dark:text-blue-400", ring: "hover:border-blue-300 dark:hover:border-blue-700" },
  { bg: "bg-emerald-50 dark:bg-emerald-950/40", icon: "text-emerald-600 dark:text-emerald-400", ring: "hover:border-emerald-300 dark:hover:border-emerald-700" },
  { bg: "bg-violet-50 dark:bg-violet-950/40", icon: "text-violet-600 dark:text-violet-400", ring: "hover:border-violet-300 dark:hover:border-violet-700" },
  { bg: "bg-rose-50 dark:bg-rose-950/40", icon: "text-rose-600 dark:text-rose-400", ring: "hover:border-rose-300 dark:hover:border-rose-700" },
  { bg: "bg-amber-50 dark:bg-amber-950/40", icon: "text-amber-600 dark:text-amber-400", ring: "hover:border-amber-300 dark:hover:border-amber-700" },
  { bg: "bg-teal-50 dark:bg-teal-950/40", icon: "text-teal-600 dark:text-teal-400", ring: "hover:border-teal-300 dark:hover:border-teal-700" },
  { bg: "bg-fuchsia-50 dark:bg-fuchsia-950/40", icon: "text-fuchsia-600 dark:text-fuchsia-400", ring: "hover:border-fuchsia-300 dark:hover:border-fuchsia-700" },
  { bg: "bg-cyan-50 dark:bg-cyan-950/40", icon: "text-cyan-600 dark:text-cyan-400", ring: "hover:border-cyan-300 dark:hover:border-cyan-700" },
  { bg: "bg-orange-50 dark:bg-orange-950/40", icon: "text-orange-600 dark:text-orange-400", ring: "hover:border-orange-300 dark:hover:border-orange-700" },
  { bg: "bg-lime-50 dark:bg-lime-950/40", icon: "text-lime-600 dark:text-lime-400", ring: "hover:border-lime-300 dark:hover:border-lime-700" },
  { bg: "bg-indigo-50 dark:bg-indigo-950/40", icon: "text-indigo-600 dark:text-indigo-400", ring: "hover:border-indigo-300 dark:hover:border-indigo-700" },
  { bg: "bg-pink-50 dark:bg-pink-950/40", icon: "text-pink-600 dark:text-pink-400", ring: "hover:border-pink-300 dark:hover:border-pink-700" },
];

export default function Menu() {
  const { hasRole } = useAuth();
  const [query, setQuery] = React.useState("");
  const trimmed = query.trim();

  const modules = moduleNavItems.filter((item) => hasRole(item.roles as any));
  const filteredModules = trimmed
    ? modules.filter((item) => item.name.toLowerCase().includes(trimmed.toLowerCase()))
    : modules;

  const canSeeOrders = hasRole(["admin", "store", "manufacturing"]);
  const isAdmin = hasRole(["admin"]);
  const ordersParams = { status: "pending" as const };
  const { data: pendingOrders } = useListCustomerOrders(ordersParams, {
    query: { enabled: canSeeOrders, queryKey: getListCustomerOrdersQueryKey(ordersParams) },
  });
  const newCustomerParams = { type: "customer" as const, isNewFromSalesman: true };
  const { data: newCustomers } = useListEntities(newCustomerParams, {
    query: { enabled: isAdmin, queryKey: getListEntitiesQueryKey(newCustomerParams) },
  });
  const badgeCounts: Record<string, number> = {
    "/customer-orders": pendingOrders?.length ?? 0,
    "/customers": newCustomers?.length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Menu</h1>
        <p className="text-muted-foreground mt-2">
          Quick access to every module.
        </p>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search modules..."
          className="pl-9"
          data-testid="input-global-search"
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Modules</h2>
        {filteredModules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No modules match "{trimmed}".</p>
        ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {filteredModules.map((item, i) => {
            const color = TILE_COLORS[i % TILE_COLORS.length];
            const badgeCount = badgeCounts[item.href] ?? 0;
            return (
              <Link key={item.href} href={item.href}>
                <Card
                  className={`${color.ring} hover:shadow-md transition-all cursor-pointer h-full border-transparent bg-white dark:bg-card shadow-sm`}
                  data-testid={`menu-tile-${item.href.replace(/\//g, "")}`}
                >
                  <CardContent className="p-4 flex flex-col gap-2">
                    <div className={`relative w-10 h-10 rounded-md ${color.bg} flex items-center justify-center ${color.icon}`}>
                      <item.icon className="h-5 w-5" />
                      {badgeCount > 0 && (
                        <span
                          className="absolute -top-2 -right-2 min-w-[1.25rem] h-5 px-1 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center shadow"
                          data-testid={`menu-tile-badge-${item.href.replace(/\//g, "")}`}
                        >
                          {badgeCount > 99 ? "99+" : badgeCount}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
