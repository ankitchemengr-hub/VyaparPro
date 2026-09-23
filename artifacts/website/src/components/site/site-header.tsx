import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { Button } from "@/components/ui/button";
import { Menu as MenuIcon, X, Building2 } from "lucide-react";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/#features" },
  { label: "Solutions", href: "/#solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
] as const;

// Public marketing-site header. Deliberately separate from the ERP app's own
// AppLayout sidebar/topbar — this is the "public website" surface, not the
// authenticated product, per the architecture split in the plan.
export function SiteHeader() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b">
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-bold text-lg text-slate-900">
          <Building2 className="w-6 h-6 text-blue-600" />
          SHRADHA ERP
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="hover:text-blue-600">{n.label}</a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          {isAuthenticated ? (
            <Link href="/dashboard"><Button size="sm">Dashboard</Button></Link>
          ) : (
            <>
              <Link href="/login"><Button size="sm" variant="ghost">Login</Button></Link>
              <Link href="/register"><Button size="sm" className="bg-blue-600 hover:bg-blue-700">Get Started</Button></Link>
            </>
          )}
        </div>

        <button className="md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t bg-white px-4 py-4 space-y-3">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="block text-sm font-medium text-slate-700" onClick={() => setOpen(false)}>
              {n.label}
            </a>
          ))}
          <div className="pt-3 border-t flex flex-col gap-2">
            {isAuthenticated ? (
              <Link href="/dashboard"><Button className="w-full">Dashboard</Button></Link>
            ) : (
              <>
                <Link href="/login"><Button className="w-full" variant="outline">Login</Button></Link>
                <Link href="/register"><Button className="w-full bg-blue-600 hover:bg-blue-700">Get Started</Button></Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
