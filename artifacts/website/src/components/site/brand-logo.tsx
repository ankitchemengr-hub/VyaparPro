import { cn } from "@/lib/utils";

// The SHRADHA ERP mark: a navy tile with a bold "S".
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("w-9 h-9 shrink-0", className)} aria-hidden="true">
      <defs>
        <linearGradient id="brand-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#brand-tile)" />
      <path d="M12 11h16v4.5H16.5v2H28V29H12v-4.5h11.5v-2H12z" fill="#fff" />
      <circle cx="30.5" cy="9.5" r="2.2" fill="#93c5fd" />
    </svg>
  );
}

export function BrandLogo({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="leading-none">
        <span className={cn("block font-extrabold tracking-tight text-[17px]", light ? "text-white" : "text-slate-900")}>
          SHRADHA <span className={light ? "text-blue-300" : "text-blue-600"}>ERP</span>
        </span>
        <span className={cn("block text-[10px] font-medium tracking-wide mt-1", light ? "text-slate-400" : "text-slate-500")}>
          Business Management Platform
        </span>
      </span>
    </span>
  );
}
