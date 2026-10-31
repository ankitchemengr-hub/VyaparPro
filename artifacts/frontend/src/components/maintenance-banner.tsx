// The planned-maintenance strip at the top of every ERP screen (login
// included). Set from Platform Console → Notices; see api-server
// lib/platform-notices.ts. A viewer can hide it until the next notice.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wrench, X } from "lucide-react";

interface BannerNotice { id: number; title: string; message: string; startsAt: string; endsAt: string }

const DISMISS_KEY = "maintenance-banner-dismissed";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

function readDismissed(): number | null {
  try {
    const v = localStorage.getItem(DISMISS_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function MaintenanceBanner() {
  const [dismissed, setDismissed] = useState<number | null>(readDismissed);
  const { data } = useQuery({
    queryKey: ["/api/system/notice-banner"],
    queryFn: async () => {
      const res = await fetch("/api/system/notice-banner", { credentials: "include" });
      if (!res.ok) return null;
      return ((await res.json()) as { notice: BannerNotice | null }).notice;
    },
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });

  if (!data || dismissed === data.id) return null;
  const live = new Date(data.startsAt).getTime() <= Date.now();

  const hide = () => {
    setDismissed(data.id);
    try { localStorage.setItem(DISMISS_KEY, String(data.id)); } catch { /* private mode */ }
  };

  return (
    <div role="status" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 print:hidden" data-testid="maintenance-banner">
      <Wrench className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{live ? "Maintenance in progress" : data.title || "Scheduled maintenance"}:</span>{" "}
        {fmt(data.startsAt)} – {fmt(data.endsAt)}. The ERP may be unavailable during this time; your data is safe.
        {data.message && <span className="block text-xs opacity-80 whitespace-pre-line">{data.message}</span>}
      </div>
      <button type="button" onClick={hide} aria-label="Hide notice" className="rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
