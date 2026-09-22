import { Link } from "wouter";
import { useListPortalPlans, useListPortalFaqs } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ReceiptText, Package, ShoppingCart, Calculator, Factory, Users, Truck,
  UserCog, BarChart3, Building2, UserCircle2, DatabaseBackup, Cloud,
  ShieldCheck, ArrowRight, Play, Check,
} from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

const FEATURES = [
  { icon: ReceiptText, title: "GST Billing", desc: "GST & Non-GST invoices, e-way bills, and tax reports in one place." },
  { icon: ShoppingCart, title: "Sales Management", desc: "Quotations, orders, and invoices with a fast, keyboard-friendly billing screen." },
  { icon: Package, title: "Purchase Management", desc: "Vendor bills, purchase returns, and automatic price updates." },
  { icon: DatabaseBackup, title: "Inventory", desc: "Real-time stock, low-stock alerts, and multi-unit tracking." },
  { icon: Calculator, title: "Accounting", desc: "Cash book, ledgers, and expense tracking built in." },
  { icon: Factory, title: "Manufacturing", desc: "Bill of materials, production batches, and recipe-based costing." },
  { icon: UserCircle2, title: "Customer Management", desc: "Full ledger, khatabook, and inactive-customer follow-ups." },
  { icon: Building2, title: "Supplier Management", desc: "Vendor bills, payables, and purchase history at a glance." },
  { icon: UserCog, title: "Salesman Management", desc: "Field orders, commissions, and cash collection tracking." },
  { icon: BarChart3, title: "Reports", desc: "Profit & loss, GST, sales, and item-wise reports on demand." },
  { icon: Users, title: "Multi-User", desc: "Role-based access for admins, accountants, salesmen, and store staff." },
  { icon: Truck, title: "Multi-Company", desc: "Run more than one business from a single account." },
] as const;

const INDUSTRIES = [
  "Retail", "Wholesale", "Distribution", "Manufacturing", "Lubricants & Oil",
  "Automobile", "Hardware", "Electrical", "Chemical", "FMCG", "Pharma", "Service Businesses",
] as const;

const STEPS = [
  { n: "1", title: "Register", desc: "Create your SHRADHA ERP account in minutes." },
  { n: "2", title: "Choose Plan", desc: "Select the subscription that fits your business." },
  { n: "3", title: "Make Payment", desc: "Complete secure online payment." },
  { n: "4", title: "Start Using ERP", desc: "Get access to your account and start managing your business." },
] as const;

export default function SiteHome() {
  const { data: plans = [] } = useListPortalPlans();
  const { data: faqs = [] } = useListPortalFaqs();
  const pricingPlans = plans.filter((p) => p.slug !== "enterprise");
  const enterprisePlan = plans.find((p) => p.slug === "enterprise");

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />

      {/* Hero */}
      <section className="bg-gradient-to-b from-blue-50 to-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-16 sm:py-24 grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 mb-4">Complete Business Management, Billing &amp; GST ERP</Badge>
            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900">
              Powerful ERP for Your <span className="text-blue-600">Complete Business</span>
            </h1>
            <p className="mt-4 text-lg text-slate-600 max-w-xl">
              Manage billing, GST, sales, purchases, inventory, accounting and manufacturing with SHRADHA ERP.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register">
                <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                  Start Free Trial <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link href="/pricing">
                <Button size="lg" variant="outline">View Pricing</Button>
              </Link>
              <Link href="/contact">
                <Button size="lg" variant="ghost">
                  <Play className="w-4 h-4 mr-2" /> Watch Demo
                </Button>
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
              {["GST Ready", "Cloud Based", "Multi-Company", "Multi-User", "Secure Data", "24/7 Access"].map((b) => (
                <span key={b} className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-teal-600" /> {b}</span>
              ))}
            </div>
          </div>

          {/* Visual dashboard mockup — representational only, not functional */}
          <Card className="shadow-xl border-slate-200">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-700">Business Overview</span>
                <Badge variant="outline" className="text-[10px]">Live preview</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Sales (Month)", value: "₹4,82,600", tone: "text-teal-600" },
                  { label: "Purchase (Month)", value: "₹2,10,340", tone: "text-blue-600" },
                  { label: "Outstanding", value: "₹96,250", tone: "text-orange-600" },
                  { label: "GST Payable", value: "₹34,120", tone: "text-slate-700" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border p-3 bg-slate-50">
                    <div className="text-[11px] text-slate-500">{s.label}</div>
                    <div className={`text-lg font-bold ${s.tone}`}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-[11px] text-slate-500 mb-2">Recent Invoices</div>
                {["INV/2026/09/142 — ₹12,450", "INV/2026/09/141 — ₹8,900", "INV/2026/09/140 — ₹22,300"].map((r) => (
                  <div key={r} className="text-xs py-1 border-b last:border-0 text-slate-600">{r}</div>
                ))}
              </div>
              <div className="rounded-lg border p-3 bg-teal-50">
                <div className="text-[11px] text-teal-700">Profit (Month)</div>
                <div className="text-xl font-bold text-teal-700">₹78,940</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center">How SHRADHA ERP Works</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">{s.n}</div>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{s.desc}</p>
              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-6 left-[60%] w-full h-px bg-slate-200" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="bg-slate-50 border-y">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center">Everything Your Business Needs</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <Card key={f.title} className="border-slate-200">
                <CardContent className="p-5">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-3">
                    <f.icon className="w-5 h-5" />
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-slate-500">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Industries */}
      <section id="solutions" className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-center">One ERP. Multiple Industries.</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {INDUSTRIES.map((ind) => (
            <span key={ind} className="px-4 py-2 rounded-full border border-slate-200 bg-white text-sm text-slate-700 shadow-sm">
              {ind}
            </span>
          ))}
        </div>
      </section>

      {/* Pricing preview */}
      <section id="pricing" className="bg-slate-50 border-y">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center">Simple, Transparent Pricing</h2>
          <p className="text-center text-slate-500 mt-2">Start free. Upgrade any time.</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {pricingPlans.map((p) => (
              <Card key={p.slug} className="border-slate-200 flex flex-col">
                <CardContent className="p-6 flex flex-col flex-1">
                  <h3 className="font-semibold text-lg">{p.name}</h3>
                  <p className="text-xs text-slate-500 mt-1 min-h-8">{p.tagline}</p>
                  <div className="mt-4 text-3xl font-bold">₹{p.priceMonthly.toLocaleString("en-IN")}<span className="text-sm font-normal text-slate-500">/mo</span></div>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-600 flex-1">
                    {p.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex items-start gap-1.5"><Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" /> {f}</li>
                    ))}
                  </ul>
                  <Link href={`/register?plan=${p.slug}`} className="mt-5">
                    <Button className="w-full bg-blue-600 hover:bg-blue-700">
                      {p.trialDays > 0 ? "Start Free Trial" : "Subscribe Now"}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
            {enterprisePlan && (
              <Card className="border-slate-200 flex flex-col bg-slate-900 text-white">
                <CardContent className="p-6 flex flex-col flex-1">
                  <h3 className="font-semibold text-lg">{enterprisePlan.name}</h3>
                  <p className="text-xs text-slate-300 mt-1 min-h-8">{enterprisePlan.tagline}</p>
                  <div className="mt-4 text-2xl font-bold">Custom Pricing</div>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-300 flex-1">
                    {enterprisePlan.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex items-start gap-1.5"><Check className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" /> {f}</li>
                    ))}
                  </ul>
                  <Link href="/contact" className="mt-5">
                    <Button className="w-full bg-white text-slate-900 hover:bg-slate-100">Contact Sales</Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="text-center mt-8">
            <Link href="/pricing" className="text-blue-600 text-sm font-medium hover:underline">Compare all plans &rarr;</Link>
          </div>
        </div>
      </section>

      {/* FAQ */}
      {faqs.length > 0 && (
        <section id="faq" className="max-w-3xl mx-auto px-4 py-16">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-8">Frequently Asked Questions</h2>
          <Accordion type="single" collapsible>
            {faqs.map((f) => (
              <AccordionItem key={f.id} value={String(f.id)}>
                <AccordionTrigger className="text-left">{f.question}</AccordionTrigger>
                <AccordionContent className="text-slate-600">{f.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      {/* CTA */}
      <section className="bg-blue-600">
        <div className="max-w-4xl mx-auto px-4 py-14 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Ready to run your business better?</h2>
          <p className="mt-2 text-blue-100">Start your free trial today — no credit card required.</p>
          <Link href="/register">
            <Button size="lg" className="mt-6 bg-white text-blue-700 hover:bg-blue-50">
              Start Free Trial <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
