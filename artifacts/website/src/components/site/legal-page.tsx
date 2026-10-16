import type { ReactNode } from "react";
import { Link } from "wouter";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { LEGAL, LEGAL_HAS_PLACEHOLDERS } from "@/lib/legal";

export type LegalSection = { id: string; title: string; body: ReactNode };

const OTHER_PAGES = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund-policy", label: "Refund & Cancellation Policy" },
];

// Shared frame for the three legal pages: title, last-updated date, a short
// contents list, the sections, and the business contact block Razorpay looks for.
export function LegalPage({ path, title, intro, sections }: {
  path: string;
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <SiteHeader />
      <main className="max-w-3xl mx-auto px-4 py-12">
        {LEGAL_HAS_PLACEHOLDERS && (
          <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Draft — business details in [square brackets] still need to be filled in (artifacts/website/src/lib/legal.ts).
          </div>
        )}

        <h1 className="text-3xl sm:text-4xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {LEGAL.lastUpdated}</p>
        <div className="mt-6 text-slate-700 leading-relaxed">{intro}</div>

        <nav className="mt-8 rounded-lg bg-slate-50 border p-4 text-sm">
          <div className="font-semibold mb-2">Contents</div>
          <ol className="list-decimal pl-5 space-y-1 text-blue-700">
            {sections.map((s) => (
              <li key={s.id}><a href={`#${s.id}`} className="hover:underline">{s.title}</a></li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="text-xl font-semibold">{i + 1}. {s.title}</h2>
              <div className="mt-3 space-y-3 text-slate-700 leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5">
                {s.body}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-lg border p-5 text-sm text-slate-700" id="contact">
          <h2 className="text-lg font-semibold text-slate-900">Contact us</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
            <dt className="text-slate-500">Business</dt><dd>{LEGAL.legalName} ({LEGAL.brand})</dd>
            <dt className="text-slate-500">Address</dt><dd>{LEGAL.address}</dd>
            <dt className="text-slate-500">Email</dt><dd>{LEGAL.email}</dd>
            <dt className="text-slate-500">Phone</dt><dd>{LEGAL.phone}</dd>
            <dt className="text-slate-500">GSTIN</dt><dd>{LEGAL.gstin}</dd>
          </dl>
        </section>

        <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {OTHER_PAGES.filter((p) => p.href !== path).map((p) => (
            <Link key={p.href} href={p.href} className="text-blue-700 hover:underline">{p.label}</Link>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
