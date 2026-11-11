import { Link } from "wouter";
import { Mail, Phone, MapPin, MessageCircle } from "lucide-react";
import { BrandLogo } from "@/components/site/brand-logo";
import { LEGAL } from "@/lib/legal";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Product Tour", href: "/#showcase" },
      { label: "Pricing", href: "/pricing" },
      { label: "Start Free Trial", href: "/register" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About Us", href: "/about" },
      { label: "Industries", href: "/#solutions" },
      { label: "Contact Us", href: "/contact" },
      { label: "Customer Login", href: "/login" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms & Conditions", href: "/terms" },
      { label: "Refund & Cancellation", href: "/refund-policy" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="bg-[#0a1630] text-slate-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-14 pb-10 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <BrandLogo light />
          <p className="mt-4 text-sm leading-relaxed text-slate-400 max-w-sm">
            Cloud ERP for Indian businesses — GST billing, sales, purchases, inventory, accounting and
            manufacturing in one place.
          </p>
          <ul className="mt-5 space-y-2.5 text-sm">
            <li>
              <a href={`tel:+${LEGAL.phoneDigits}`} className="inline-flex items-center gap-2.5 hover:text-white">
                <Phone className="w-4 h-4 text-blue-400" /> {LEGAL.phone}
              </a>
            </li>
            <li>
              <a href={`mailto:${LEGAL.email}`} className="inline-flex items-center gap-2.5 hover:text-white">
                <Mail className="w-4 h-4 text-blue-400" /> {LEGAL.email}
              </a>
            </li>
            <li>
              <a href={`https://wa.me/${LEGAL.phoneDigits}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2.5 hover:text-white">
                <MessageCircle className="w-4 h-4 text-blue-400" /> WhatsApp us
              </a>
            </li>
            <li className="flex items-start gap-2.5 text-slate-400">
              <MapPin className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" /> {LEGAL.address}
            </li>
          </ul>
        </div>

        <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-3 gap-8">
          {COLUMNS.map((c) => (
            <div key={c.title}>
              <h2 className="text-white text-sm font-semibold">{c.title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.href.includes("#") ? (
                      <a href={l.href} className="hover:text-white transition-colors">{l.label}</a>
                    ) : (
                      <Link href={l.href} className="hover:text-white transition-colors">{l.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row gap-2 justify-between text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {LEGAL.brand}. A product of {LEGAL.legalName}. All rights reserved.</span>
          <span>GSTIN {LEGAL.gstin}</span>
        </div>
      </div>
    </footer>
  );
}
