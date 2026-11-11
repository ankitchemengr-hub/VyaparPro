import { Link } from "wouter";
import { ArrowRight, Target, Eye, HeartHandshake, MapPin, Mail, Phone } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { LEGAL } from "@/lib/legal";
import { usePageMeta } from "@/lib/seo";

const VALUES = [
  { icon: Target, title: "Our Mission", desc: "Give every Indian business — from a single counter to a growing factory — one simple system for billing, stock, purchases and accounts." },
  { icon: Eye, title: "Our Approach", desc: "We build from real shop-floor needs: fast billing, correct GST, honest reports, and screens that work as well on a phone as on a laptop." },
  { icon: HeartHandshake, title: "Our Promise", desc: "Clear pricing, your data kept separate and safe, and real people to help you when you need it." },
] as const;

export default function SiteAbout() {
  usePageMeta(
    "About Us",
    "SHRADHA ERP is a cloud ERP built in Solapur, Maharashtra for Indian manufacturers, distributors, wholesalers, traders and retailers.",
  );

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <main>
        <section className="bg-gradient-to-b from-[#f4f7ff] to-white border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
            <span className="eyebrow">About Us</span>
            <h1 className="mt-5 text-4xl sm:text-5xl font-extrabold tracking-tight text-[#0b1b3f]">
              Business software, built for how India trades
            </h1>
            <p className="mt-6 text-lg text-slate-600 leading-relaxed">
              {LEGAL.brand} is a product of {LEGAL.legalName}, Solapur, Maharashtra. We build it around the daily work of
              Indian businesses — billing, GST, stock, purchases, manufacturing and accounts — in one connected system.
            </p>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid gap-6 md:grid-cols-3">
          {VALUES.map((v) => (
            <article key={v.title} className="rounded-2xl border border-slate-200 p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                <v.icon className="h-5 w-5" />
              </span>
              <h2 className="mt-5 text-lg font-semibold">{v.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{v.desc}</p>
            </article>
          ))}
        </section>

        <section className="bg-slate-50 border-y border-slate-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="section-title">Talk to us</h2>
              <p className="section-lead">Questions about plans, setup or moving from another software? We're happy to help.</p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link href="/register" className="btn-primary btn-lg">Get Started <ArrowRight className="h-4 w-4" /></Link>
                <Link href="/contact" className="btn-secondary btn-lg">Contact Us</Link>
              </div>
            </div>
            <ul className="space-y-4 text-sm">
              <li className="flex items-start gap-3 rounded-xl bg-white border border-slate-200 p-4">
                <MapPin className="h-5 w-5 text-blue-600 shrink-0" />
                <span><span className="block font-semibold">{LEGAL.legalName}</span>{LEGAL.address}</span>
              </li>
              <li>
                <a href={`tel:+${LEGAL.phoneDigits}`} className="flex items-center gap-3 rounded-xl bg-white border border-slate-200 p-4 hover:border-blue-300">
                  <Phone className="h-5 w-5 text-blue-600" /> {LEGAL.phone}
                </a>
              </li>
              <li>
                <a href={`mailto:${LEGAL.email}`} className="flex items-center gap-3 rounded-xl bg-white border border-slate-200 p-4 hover:border-blue-300">
                  <Mail className="h-5 w-5 text-blue-600" /> {LEGAL.email}
                </a>
              </li>
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
