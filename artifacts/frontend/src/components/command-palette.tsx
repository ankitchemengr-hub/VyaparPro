import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { topNavItems, moduleNavItems, type Role } from "@/lib/nav-items";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import {
  FilePlus,
  Truck,
  Receipt,
  HandCoins,
  ClipboardList,
  FileText,
  Users,
  Package,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  path: string;
  roles: Role[];
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "New Bill / Invoice", icon: FilePlus, path: "/billing", roles: ["admin", "store"] },
  { label: "New Purchase Bill", icon: Truck, path: "/purchases", roles: ["admin", "accountant", "store"] },
  { label: "Add Expense", icon: Receipt, path: "/expenses", roles: ["admin", "accountant"] },
  { label: "Record Payment", icon: HandCoins, path: "/cashbook", roles: ["admin", "accountant"] },
  { label: "New Quotation", icon: ClipboardList, path: "/quotations", roles: ["admin", "salesman", "accountant"] },
];

interface SearchResults {
  products?: { id: number; name: string }[];
  entities?: { id: number; name: string; type: string }[];
  invoices?: { id: number; invoiceNo: string; customerName: string | null }[];
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const { hasRole } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(null);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setResults(data))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const go = (path: string) => {
    onOpenChange(false);
    setLocation(path);
  };

  const navItems = useMemo(() => {
    const seen = new Set<string>();
    return [...topNavItems, ...moduleNavItems].filter((item) => {
      if (seen.has(item.href) || !hasRole(item.roles as any)) return false;
      seen.add(item.href);
      return true;
    });
  }, [hasRole]);

  const actions = QUICK_ACTIONS.filter((a) => hasRole(a.roles as any));
  const customers = (results?.entities ?? []).filter((e) => e.type === "customer");

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Jump to a page, or search an invoice no / customer / product…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        {actions.length > 0 && (
          <CommandGroup heading="Actions">
            {actions.map((a) => (
              <CommandItem key={a.path + a.label} value={`action ${a.label}`} onSelect={() => go(a.path)}>
                <a.icon />
                <span>{a.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Go to">
          {navItems.map((item) => (
            <CommandItem
              key={item.href}
              value={`${item.name} ${item.description ?? ""}`}
              onSelect={() => go(item.href)}
            >
              <item.icon />
              <span>{item.name}</span>
              {item.description && (
                <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{item.description}</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        {(results?.invoices?.length ?? 0) > 0 && (
          <CommandGroup heading="Invoices">
            {results!.invoices!.map((inv) => (
              <CommandItem
                key={`inv-${inv.id}`}
                value={`${inv.invoiceNo} ${inv.customerName ?? ""}`}
                onSelect={() => go(`/invoices/${inv.id}`)}
              >
                <FileText />
                <span>{inv.invoiceNo}</span>
                {inv.customerName && (
                  <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">{inv.customerName}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {customers.length > 0 && hasRole(["admin", "salesman", "accountant"] as any) && (
          <CommandGroup heading="Customers">
            {customers.map((c) => (
              <CommandItem key={`cust-${c.id}`} value={`customer ${c.name}`} onSelect={() => go(`/customers/${c.id}`)}>
                <Users />
                <span>{c.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {(results?.products?.length ?? 0) > 0 && hasRole(["admin", "store"] as any) && (
          <CommandGroup heading="Products">
            {results!.products!.map((p) => (
              <CommandItem key={`prod-${p.id}`} value={`product ${p.name}`} onSelect={() => go("/inventory")}>
                <Package />
                <span>{p.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
