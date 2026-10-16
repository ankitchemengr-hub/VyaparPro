import React from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/use-auth";
import { cn } from "@/lib/utils";
import { Home, ShoppingCart, PackageCheck, FileText, Wallet, LogOut } from "lucide-react";

// App-style frame for the customer portal login (mechanics / retailers):
// shop name on top, five big tabs at the bottom on phones (top on desktop).
// Replaces the staff ERP chrome — sidebar, Ctrl+K search, keyboard-shortcut
// help, "role" labels — which only confused these users.

const TABS = [
  { href: "/home", en: "Home", hi: "होम", icon: Home },
  { href: "/catalog", en: "Order", hi: "ऑर्डर दें", icon: ShoppingCart },
  { href: "/track-orders", en: "My Orders", hi: "मेरे ऑर्डर", icon: PackageCheck },
  { href: "/my-orders", en: "Bills", hi: "बिल", icon: FileText },
  { href: "/my-statement", en: "Account", hi: "खाता", icon: Wallet },
];

function useCompanyProfile() {
  // Same cache key as useCompanyLogo / the Company Profile settings panel.
  const { data } = useQuery<{ id: number; name: string; logo: string | null }>({
    queryKey: ["/api/company-profile"],
    queryFn: async () => {
      const res = await fetch("/api/company-profile", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load company profile");
      return res.json();
    },
    staleTime: 60_000,
  });
  return data;
}

export function CustomerShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const company = useCompanyProfile();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    if (!window.confirm("Log out? · लॉग आउट करें?")) return;
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        window.location.href = "/login";
      },
    });
  };

  const isActive = (href: string) => location === href || (href !== "/home" && location.startsWith(href + "/"));

  return (
    <div className="min-h-screen w-full bg-muted/30 text-foreground">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:hidden">
        <div className="max-w-5xl mx-auto h-14 px-4 flex items-center gap-3">
          <Link href="/home" className="flex items-center gap-2.5 min-w-0">
            {company?.logo ? (
              <img src={company.logo} alt="" className="w-9 h-9 rounded-lg object-contain bg-card border" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
                {(company?.name ?? "S").charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">{company?.name ?? ""}</div>
              <div className="text-xs text-muted-foreground leading-tight truncate">{user?.name}</div>
            </div>
          </Link>

          {/* Desktop tabs */}
          <nav className="hidden md:flex items-center gap-1 ml-6">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors",
                    isActive(t.href) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <t.icon className="w-4 h-4" /> {t.en}
                </span>
              </Link>
            ))}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            data-testid="button-customer-logout"
          >
            <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto p-4 pb-28 md:pb-8 outline-none">
        {children}
      </main>

      {/* Phone bottom tabs */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)] print:hidden">
        <div className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link key={t.href} href={t.href}>
                <span
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 cursor-pointer select-none",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                  data-testid={`customer-tab-${t.href.replace(/\//g, "")}`}
                >
                  <span className={cn("grid place-items-center w-10 h-7 rounded-full transition-colors", active && "bg-primary/10")}>
                    <t.icon className="w-5 h-5" />
                  </span>
                  <span className="text-[11px] font-medium leading-none">{t.en}</span>
                  <span className="text-[10px] leading-none opacity-80">{t.hi}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
