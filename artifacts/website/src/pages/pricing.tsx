import { Link } from "wouter";
import { useListPortalPlans } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

export default function SitePricing() {
  const { data: plans = [], isLoading } = useListPortalPlans();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h1 className="text-3xl sm:text-4xl font-bold text-center">Plans for every stage of your business</h1>
        <p className="text-center text-slate-500 mt-3">All plans include GST billing, inventory, and free updates. Cancel any time.</p>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-blue-600" /></div>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => {
              const isCustom = p.priceMonthly === 0 && p.trialDays === 0;
              return (
                <Card key={p.slug} className={p.slug === "business" ? "border-blue-500 border-2 shadow-lg relative" : "border-slate-200"}>
                  {p.slug === "business" && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[11px] font-semibold px-3 py-1 rounded-full">
                      Most Popular
                    </div>
                  )}
                  <CardContent className="p-6 flex flex-col h-full">
                    <h3 className="font-semibold text-lg">{p.name}</h3>
                    <p className="text-xs text-slate-500 mt-1 min-h-8">{p.tagline}</p>
                    <div className="mt-4">
                      {isCustom ? (
                        <div className="text-2xl font-bold">Custom Pricing</div>
                      ) : (
                        <div className="text-3xl font-bold">₹{p.priceMonthly.toLocaleString("en-IN")}<span className="text-sm font-normal text-slate-500">/mo</span></div>
                      )}
                      {p.trialDays > 0 && <p className="text-xs text-teal-600 mt-1">{p.trialDays}-day free trial</p>}
                    </div>
                    <ul className="mt-5 space-y-2 text-sm text-slate-600 flex-1">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-1.5"><Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" /> {f}</li>
                      ))}
                    </ul>
                    <div className="mt-3 text-xs text-slate-400">
                      {p.maxUsers ? `Up to ${p.maxUsers} users` : "Unlimited users"} · {p.maxCompanies ? `${p.maxCompanies} compan${p.maxCompanies === 1 ? "y" : "ies"}` : "Unlimited companies"}
                    </div>
                    {isCustom ? (
                      <Link href="/contact" className="mt-5">
                        <Button className="w-full" variant="outline">Contact Sales</Button>
                      </Link>
                    ) : (
                      <Link href={`/register?plan=${p.slug}`} className="mt-5">
                        <Button className="w-full bg-blue-600 hover:bg-blue-700">
                          {p.trialDays > 0 ? "Start Free Trial" : "Subscribe Now"}
                        </Button>
                      </Link>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>
      <SiteFooter />
    </div>
  );
}
