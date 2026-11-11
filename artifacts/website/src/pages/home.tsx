import { useState } from "react";
import { Link } from "wouter";
import { useListPortalPlans, useListPortalFaqs } from "@workspace/api-client-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ReceiptText, Package, ShoppingCart, Calculator, Factory, Users, UserCog,
  BarChart3, Building2, Cloud, ShieldCheck, ArrowRight, Check, Boxes,
  Truck, Store, Warehouse, Briefcase, KeyRound, LineChart, Sparkles,
  UserPlus, Settings2, LayoutDashboard, BadgeIndianRupee, Layers,
} from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import {
  AppFrame, DashboardPreview, FloatingInvoiceCard, FloatingStockCard, SHOWCASE,
} from "@/components/site/product-previews";
import { usePageMeta } from "@/lib/seo";
import { useReveal } from "@/lib/use-reveal";
import { cn } from "@/lib/utils";

const MODULES = [
  { icon: ShoppingCart, title: "Sales Management", desc: "Quotations, invoices, sales returns and customer orders from one fast billing screen." },
  { icon: Truck, title: "Purchase Management", desc: "Supplier bills, purchase returns, dues by days pending, and supplier settlement." },
  { icon: Boxes, title: "Inventory Management", desc: "Live stock, item register, stock adjustment and low-stock alerts." },
  { icon: Calculator, title: "Accounting & Finance", desc: "Cash book, bank reconciliation, ledgers, expenses and Khatabook." },
  { icon: Factory, title: "Manufacturing", desc: "Bill of materials, production and auto-manufacturing with material costing." },
  { icon: ReceiptText, title: "GST Billing & Invoicing", desc: "GST and non-GST invoices with HSN, CGST/SGST/IGST and GSTR-1 data." },
  { icon: Users, title: "Customer Management", desc: "Customer ledger, outstanding, inactive-customer follow-up and GSTIN auto-fill." },
  { icon: UserCog, title: "Employee & Salesman", desc: "Salesman orders and collections, commission, and worker records." },
  { icon: BarChart3, title: "Reports & Analytics", desc: "Profit & loss, sales, purchase, GST and item-wise reports on demand." },
] as const;

const WHY = [
  { icon: Layers, title: "All-in-One Platform", desc: "Billing, stock, purchases, accounts and manufacturing share one set of data." },
  { icon: Building2, title: "Multi-Company", desc: "Run more than one business from a single login." },
  { icon: Package, title: "Real-Time Inventory", desc: "Every sale, purchase and production updates stock instantly." },
  { icon: BadgeIndianRupee, title: "GST-Ready Billing", desc: "Tax worked out per line, ready for your GST returns." },
  { icon: LineChart, title: "Easy Reporting", desc: "The numbers you need, without exporting to spreadsheets." },
  { icon: KeyRound, title: "Role-Based Access", desc: "Admin, accountant, salesman and store roles see only their work." },
  { icon: Cloud, title: "Cloud-Based", desc: "Use it on laptop or phone, at the shop or on the road." },
  { icon: ShieldCheck, title: "Secure Data", desc: "Each company's data kept separate, with backup and restore." },
] as const;

const INDUSTRIES = [
  { icon: Factory, title: "Manufacturers", desc: "BOM, production and raw-material stock linked to your sales." },
  { icon: Truck, title: "Distributors", desc: "Salesman orders, dispatch and collections across many customers." },
  { icon: Warehouse, title: "Wholesalers", desc: "Bulk billing, price lists and customer-wise outstanding." },
  { icon: Briefcase, title: "Traders", desc: "Buy, sell and track margins with clean GST records." },
  { icon: Store, title: "Retail Businesses", desc: "Quick counter billing, stock alerts and daily cash book." },
  { icon: Building2, title: "Small & Medium Enterprises", desc: "One affordable system that grows with your team." },
] as const;

const STEPS = [
  { icon: UserPlus, title: "Create your business account", desc: "Register online in a few minutes and choose your plan." },
  { icon: Settings2, title: "Set up products, customers and stock", desc: "Add your items, parties and opening stock — or import them." },
  { icon: LayoutDashboard, title: "Run your business from one dashboard", desc: "Bill, buy, track stock and see reports in one place." },
] as const;

const TRUST = ["GST Ready", "Cloud Based", "Multi-Company", "Role-Based Access", "Made for India"] as const;

function SectionHeading({ eyebrow, title, lead, center = true }: { eyebrow: string; title: string; lead?: string; center?: boolean }) {
  return (
    <div className={cn("max-w-2xl reveal", center && "mx-auto text-center")}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="section-title mt-4">{title}</h2>
      {lead && <p className="section-lead">{lead}</p>}
    </div>
  );
}

function Showcase() {
  const [active, setActive] = useState<string>(SHOWCASE[0].key);
  const item = SHOWCASE.find((s) => s.key === active) ?? SHOWCASE[0];
  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-12 lg:items-start">
      <div role="tablist" aria-label="Product screens" className="lg:col-span-4 flex lg:flex-col gap-2 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0 pb-1">
        {SHOWCASE.map((s) => {
          const on = s.key === active;
          return (
            <button
              key={s.key}
              role="tab"
              id={`tab-${s.key}`}
              aria-selected={on}
              aria-controls="showcase-panel"
              onClick={() => setActive(s.key)}
              className={cn(
                "shrink-0 text-left rounded-xl border px-4 py-3 transition-all",
                on ? "border-blue-200 bg-white shadow-md shadow-blue-900/5" : "border-transparent hover:bg-white/70",
              )}
            >
              <span className="flex items-center gap-3">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500")}>
                  <s.icon className="h-[18px] w-[18px]" />
                </span>
                <span className={cn("font-semibold text-sm whitespace-nowrap", on ? "text-slate-900" : "text-slate-600")}>{s.label}</span>
              </span>
              <span className={cn("hidden lg:block text-[13px] leading-relaxed text-slate-500 overflow-hidden transition-all", on ? "mt-2 max-h-24" : "max-h-0")}>
                {s.blurb}
              </span>
            </button>
          );
        })}
      </div>
      <div className="lg:col-span-8" id="showcase-panel" role="tabpanel" aria-labelledby={`tab-${item.key}`}>
        <p className="lg:hidden mb-3 text-sm text-slate-600">{item.blurb}</p>
        <AppFrame url={item.url}>
          <div key={item.key} className="p-4 sm:p-5 animate-in fade-in duration-300">
            <item.Screen />
          </div>
        </AppFrame>
      </div>
    </div>
  );
}

export default function SiteHome() {
  usePageMeta(
    "SHRADHA ERP — Run Your Entire Business From One Powerful ERP",
    "Cloud ERP for Indian businesses: GST billing, sales, purchases, inventory, accounting and manufacturing in one platform. Start your free trial.",
  );
  useReveal();
  const { data: plans = [] } = useListPortalPlans();
  const { data: faqs = [] } = useListPortalFaqs();
  const pricingPlans = plans.filter((p) => p.slug !== "enterprise");
  const enterprisePlan = plans.find((p) => p.slug === "enterprise");

  return (
    <div className="min-h-screen bg-white text-slate-900 overflow-x-hidden">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-gradient-to-b from-[#f4f7ff] via-white to-white">
          <div className="hero-grid absolute inset-0 -z-10" aria-hidden="true" />
          <div className="absolute -top-40 right-[-10%] -z-10 h-[520px] w-[520px] rounded-full bg-blue-400/20 blur-3xl" aria-hidden="true" />
          <div className="absolute top-40 left-[-15%] -z-10 h-[380px] w-[380px] rounded-full bg-indigo-300/20 blur-3xl" aria-hidden="true" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-12 pb-16 sm:pt-20 sm:pb-24 grid gap-14 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-5">
              <span className="eyebrow"><Sparkles className="h-3.5 w-3.5" /> Complete Business ERP for India</span>
              <h1 className="mt-5 text-[2.35rem] leading-[1.08] sm:text-5xl lg:text-[3.4rem] font-extrabold tracking-tight text-[#0b1b3f]">
                Run Your Entire Business.{" "}
                <span className="bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent">From One Powerful ERP.</span>
              </h1>
              <p className="mt-6 text-lg text-slate-600 leading-relaxed max-w-xl">
                Manage Sales, Purchase, Inventory, Accounting, Manufacturing and Business Operations — All in One Smart Platform.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link href="/register" className="btn-primary btn-lg">
                  Start Your Business Journey <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#features" className="btn-secondary btn-lg">Explore Features</a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-slate-600">
                {TRUST.map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <Check className="h-4 w-4 text-blue-600" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-7 relative">
              <div className="absolute inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-blue-600/20 to-indigo-400/10 blur-2xl" aria-hidden="true" />
              <DashboardPreview />
              <FloatingInvoiceCard className="hidden sm:block absolute -left-6 xl:-left-12 -bottom-8 float-slow" />
              <FloatingStockCard className="hidden md:block absolute -right-4 xl:-right-8 -top-6 float-slower" />
            </div>
          </div>
        </section>

        {/* Modules */}
        <section id="features" className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <SectionHeading
              eyebrow="Business Management"
              title="Everything Your Business Needs. All in One Place."
              lead="Nine connected modules that share the same data — so a bill updates your stock, your books and your reports at once."
            />
            <div className="mt-14 grid gap-3 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {MODULES.map((m) => (
                <article
                  key={m.title}
                  className="reveal group relative flex gap-4 sm:block rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl hover:shadow-blue-900/5"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 ring-1 ring-blue-100 transition-colors group-hover:bg-blue-600 group-hover:text-white">
                    <m.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="sm:mt-5 font-semibold text-slate-900">{m.title}</h3>
                    <p className="mt-1 sm:mt-2 text-sm leading-relaxed text-slate-600">{m.desc}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Product tour */}
        <section id="showcase" className="py-20 sm:py-28 bg-slate-50 border-y border-slate-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <SectionHeading
              eyebrow="Product Tour"
              title="See How SHRADHA ERP Works"
              lead="A look at the screens you will use every day. Previews show sample data."
            />
            <Showcase />
          </div>
        </section>

        {/* Why */}
        <section className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionHeading
                center={false}
                eyebrow="Why SHRADHA ERP"
                title="Built for How Indian Businesses Work"
                lead="Simple enough for the counter, complete enough for the whole business."
              />
              <div className="mt-8 reveal">
                <Link href="/register" className="btn-primary">Start Free Trial <ArrowRight className="h-4 w-4" /></Link>
              </div>
            </div>
            <div className="lg:col-span-8 grid gap-x-8 gap-y-8 sm:grid-cols-2">
              {WHY.map((w) => (
                <div key={w.title} className="reveal flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0b1b3f] text-white">
                    <w.icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-900">{w.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">{w.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Industries */}
        <section id="solutions" className="py-20 sm:py-28 bg-[#0b1b3f] text-white relative overflow-hidden">
          <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-blue-600/25 blur-3xl" aria-hidden="true" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 relative">
            <div className="max-w-2xl mx-auto text-center reveal">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-blue-200">
                Solutions
              </span>
              <h2 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight">Industries We Serve</h2>
              <p className="mt-4 text-base sm:text-lg text-slate-300 leading-relaxed">
                From the factory floor to the retail counter — one ERP that fits the way you trade.
              </p>
            </div>
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {INDUSTRIES.map((ind) => (
                <div key={ind.title} className="reveal rounded-2xl border border-white/10 bg-white/[0.04] p-6 transition-colors hover:bg-white/[0.08] hover:border-white/20">
                  <ind.icon className="h-6 w-6 text-blue-300" />
                  <h3 className="mt-4 font-semibold">{ind.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{ind.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 sm:py-28">
          <div className="max-w-7xl mx-auto px-4 sm:px-6">
            <SectionHeading eyebrow="How It Works" title="Up and Running in Three Steps" />
            <ol className="mt-14 grid gap-6 md:grid-cols-3 relative">
              <div className="hidden md:block absolute top-7 left-[16%] right-[16%] h-px bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" aria-hidden="true" />
              {STEPS.map((s, i) => (
                <li key={s.title} className="reveal relative text-center px-4">
                  <span className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-blue-600 ring-1 ring-blue-100 shadow-lg shadow-blue-900/5">
                    <s.icon className="h-6 w-6" />
                    <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">{i + 1}</span>
                  </span>
                  <h3 className="mt-5 font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 max-w-xs mx-auto">{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Pricing preview */}
        {pricingPlans.length > 0 && (
          <section id="pricing" className="py-20 sm:py-28 bg-slate-50 border-y border-slate-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6">
              <SectionHeading eyebrow="Pricing" title="Simple, Transparent Pricing" lead="Start free. Upgrade any time. Prices exclude 18% GST." />
              <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {pricingPlans.map((p) => {
                  const popular = p.slug === "business";
                  return (
                    <div
                      key={p.slug}
                      className={cn(
                        "reveal relative flex flex-col rounded-2xl border bg-white p-6",
                        popular ? "border-blue-500 shadow-xl shadow-blue-900/10" : "border-slate-200",
                      )}
                    >
                      {popular && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white">Most Popular</span>
                      )}
                      <h3 className="font-semibold text-lg">{p.name}</h3>
                      <p className="mt-1 text-xs text-slate-500 min-h-8">{p.tagline}</p>
                      <div className="mt-4 text-3xl font-bold tracking-tight">
                        ₹{p.priceMonthly.toLocaleString("en-IN")}<span className="text-sm font-normal text-slate-500">/mo</span>
                      </div>
                      <ul className="mt-5 space-y-2 text-sm text-slate-600 flex-1">
                        {p.features.slice(0, 4).map((f) => (
                          <li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" /> {f}</li>
                        ))}
                      </ul>
                      <Link href={`/register?plan=${p.slug}`} className={cn("mt-6 w-full", popular ? "btn-primary" : "btn-secondary")}>
                        {p.trialDays > 0 ? "Start Free Trial" : "Subscribe Now"}
                      </Link>
                    </div>
                  );
                })}
                {enterprisePlan && (
                  <div className="reveal flex flex-col rounded-2xl bg-[#0b1b3f] p-6 text-white">
                    <h3 className="font-semibold text-lg">{enterprisePlan.name}</h3>
                    <p className="mt-1 text-xs text-slate-300 min-h-8">{enterprisePlan.tagline}</p>
                    <div className="mt-4 text-2xl font-bold">Custom Pricing</div>
                    <ul className="mt-5 space-y-2 text-sm text-slate-300 flex-1">
                      {enterprisePlan.features.slice(0, 4).map((f) => (
                        <li key={f} className="flex items-start gap-2"><Check className="h-4 w-4 text-blue-300 shrink-0 mt-0.5" /> {f}</li>
                      ))}
                    </ul>
                    <Link href="/contact" className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">
                      Contact Sales
                    </Link>
                  </div>
                )}
              </div>
              <div className="mt-10 text-center">
                <Link href="/pricing" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700">
                  Compare all plans <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* FAQ */}
        {faqs.length > 0 && (
          <section id="faq" className="py-20 sm:py-28">
            <div className="max-w-3xl mx-auto px-4 sm:px-6">
              <SectionHeading eyebrow="FAQ" title="Frequently Asked Questions" />
              <Accordion type="single" collapsible className="mt-10">
                {faqs.map((f) => (
                  <AccordionItem key={f.id} value={String(f.id)}>
                    <AccordionTrigger className="text-left font-semibold">{f.question}</AccordionTrigger>
                    <AccordionContent className="text-slate-600 leading-relaxed">{f.answer}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="px-4 sm:px-6 pb-20 sm:pb-28">
          <div className="reveal relative max-w-6xl mx-auto overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b1b3f] via-[#13306e] to-blue-700 px-6 py-14 sm:px-14 sm:py-20 text-center">
            <div className="hero-grid absolute inset-0 opacity-40" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Ready to Make Your Business Smarter?</h2>
              <p className="mt-4 text-base sm:text-lg text-blue-100 max-w-2xl mx-auto">
                Bring your entire business operation under one roof with SHRADHA ERP.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                <Link href="/register" className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 text-[15px] font-semibold text-[#0b1b3f] hover:bg-blue-50 transition-colors">
                  Get Started <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 px-6 py-3 text-[15px] font-semibold text-white hover:bg-white/10 transition-colors">
                  Contact Us
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
