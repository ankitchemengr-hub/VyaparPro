import { Link } from "wouter";

export function SiteFooter() {
  return (
    <footer className="bg-slate-900 text-slate-300">
      <div className="max-w-6xl mx-auto px-4 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <div className="text-white font-bold text-lg">SHRADHA ERP</div>
          <p className="mt-2 text-slate-400">Everything you need to run your business.</p>
        </div>
        <div>
          <div className="text-white font-medium mb-2">Product</div>
          <div className="space-y-1.5">
            <a href="/#features" className="block hover:text-white">Features</a>
            <Link href="/pricing" className="block hover:text-white">Pricing</Link>
            <Link href="/register" className="block hover:text-white">Free Trial</Link>
          </div>
        </div>
        <div>
          <div className="text-white font-medium mb-2">Company</div>
          <div className="space-y-1.5">
            <Link href="/contact" className="block hover:text-white">Contact Us</Link>
            <Link href="/contact" className="block hover:text-white">Book a Demo</Link>
          </div>
        </div>
        <div>
          <div className="text-white font-medium mb-2">Account</div>
          <div className="space-y-1.5">
            <Link href="/login" className="block hover:text-white">Customer Login</Link>
            <Link href="/register" className="block hover:text-white">Create Account</Link>
          </div>
        </div>
      </div>
      <div className="border-t border-slate-800 py-4 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} SHRADHA ERP. All rights reserved.
      </div>
    </footer>
  );
}
