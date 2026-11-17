// Small "i" in a card's top-right corner. Its explanation shows on mouse
// hover, or on tap / click (phones have no hover); clicking the "i" never
// opens the card itself. Put the card in `relative` positioning.
import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function InfoTip({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const show = () => { keep(); setOpen(true); };
  const hideSoon = () => { keep(); closeTimer.current = setTimeout(() => setOpen(false), 150); };
  if (!text) return null;

  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label="What is this?"
          className={cn(
            "absolute top-1.5 right-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full",
            "text-muted-foreground/70 hover:text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary print:hidden",
            className,
          )}
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onClick={(e) => { stop(e); keep(); setOpen((o) => !o); }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { stop(e); setOpen((o) => !o); } }}
          data-testid="info-tip"
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-64 p-3 text-xs leading-snug"
        onMouseEnter={keep}
        onMouseLeave={hideSoon}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}
