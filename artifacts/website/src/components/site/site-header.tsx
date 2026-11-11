import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { Menu as MenuIcon, X, ArrowRight } from "lucide-react";
import { BrandLogo } from "@/components/site/brand-logo";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/#features" },
  { label: "Solutions", href: "/#solutions" },
  { label: "Pricing", href: "/pricing" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "/contact" },
] as const;

// Public marketing-site header. Deliberately separate from the ERP app's own
// AppLayout sidebar/topbar — this is the "public website" surface, not the
// authenticated product.
export function SiteHeader() {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Keep the page behind the open mobile menu from scrolling.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,box-shadow,border-color] duration-200",
        scrolled || open
          ? "bg-white/90 backdrop-blur-md border-slate-200/80 shadow-[0_1px_12px_rgba(15,23,42,0.06)]"
          : "bg-white/70 backdrop-blur border-transparent",
      )}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" aria-label="SHRADHA ERP home" onClick={() => setOpen(false)}>
          <BrandLogo />
        </Link>

        <nav aria-label="Main" className="hidden lg:flex items-center gap-1 text-sm font-medium text-slate-600">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="px-3 py-2 rounded-md hover:text-slate-900 hover:bg-slate-100/80 transition-colors">
              {n.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-2">
          {isAuthenticated ? (
            <Link href="/dashboard" className="btn-primary">Dashboard <ArrowRight className="w-4 h-4" /></Link>
          ) : (
            <>
              <Link href="/login" className="px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-100/80 transition-colors">
                Login
              </Link>
              <Link href="/register" className="btn-primary">Get Started <ArrowRight className="w-4 h-4" /></Link>
            </>
          )}
        </div>

        <button
          className="lg:hidden -mr-2 p-2 rounded-lg text-slate-700 hover:bg-slate-100"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
        >
          {open ? <X className="w-6 h-6" /> : <MenuIcon className="w-6 h-6" />}
        </button>
      </div>

      {open && (
        // Absolute + explicit height, not `fixed inset-0`: the header's
        // backdrop-blur makes it the containing block for fixed children,
        // which collapsed the menu to nothing.
        <div id="mobile-menu" className="lg:hidden absolute inset-x-0 top-full h-[calc(100dvh-4rem)] bg-white overflow-y-auto border-t">
          <nav aria-label="Mobile" className="px-4 py-2 flex flex-col">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="py-3.5 text-base font-medium text-slate-800 border-b border-slate-100"
                onClick={() => setOpen(false)}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <div className="px-4 pt-4 pb-8 flex flex-col gap-3">
            {isAuthenticated ? (
              <Link href="/dashboard" className="btn-primary w-full py-3" onClick={() => setOpen(false)}>Dashboard</Link>
            ) : (
              <>
                <Link href="/register" className="btn-primary w-full py-3" onClick={() => setOpen(false)}>
                  Get Started <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/login" className="btn-secondary w-full py-3" onClick={() => setOpen(false)}>Login</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
