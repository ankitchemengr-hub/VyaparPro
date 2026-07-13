// Template chooser popup: size tabs (All / A4 / A5), template list, scaled
// live preview of the highlighted template, Select to apply. Stacks to a
// single column on narrow screens; the preview scales to fit its own
// container width dynamically rather than a fixed desktop-tuned constant, so
// it never forces the dialog wider than the viewport.

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check } from "lucide-react";
import { TEMPLATES, getTemplate } from "./registry";
import { computeTotals } from "./helpers";
import type { ProductMaps, PrintSettings, PaperSize } from "./types";

interface InvoiceTemplateSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: any;
  maps: ProductMaps;
  settings: PrintSettings;
  value: string;
  onSelect: (templateId: string) => void;
}

// Real on-screen sheet width (px) per paper/orientation — this is the
// preview's true, unscaled layout size; `scale` below shrinks it to fit.
function sheetWidth(paper: PaperSize, orientation: string): number {
  if (orientation === "landscape") return paper === "A4" ? 1123 : 794;
  return paper === "A4" ? 794 : 559;
}

// Scales the fixed-width preview sheet down to fit whatever width its
// container actually has, recalculating on resize (dialog open, orientation
// change, window resize) instead of using desktop-tuned constants that
// overflow narrow phone screens.
function useFitScale(naturalWidth: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const recalc = () => {
      const available = container.clientWidth - 32; // p-4 on both sides
      if (!available || !naturalWidth) return;
      setScale(Math.min(0.6, available / naturalWidth));
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(container);
    return () => ro.disconnect();
  }, [naturalWidth]);

  return { containerRef, scale };
}

export function InvoiceTemplateSelector({
  open,
  onOpenChange,
  invoice,
  maps,
  settings,
  value,
  onSelect,
}: InvoiceTemplateSelectorProps) {
  const [filter, setFilter] = useState<"all" | PaperSize>("all");
  const [previewId, setPreviewId] = useState(value);

  // Re-sync the highlighted preview whenever the dialog opens or the current
  // value changes externally, so it never shows a stale selection.
  useEffect(() => {
    if (open) setPreviewId(value);
  }, [open, value]);

  const list = TEMPLATES.filter((t) => filter === "all" || t.paper === filter);
  const meta = getTemplate(previewId);
  const Preview = meta.component;
  const computed = computeTotals(invoice, maps);
  const width = sheetWidth(meta.paper, meta.orientation);
  const { containerRef, scale } = useFitScale(width);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[calc(100%-2rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle>Choose Invoice Template</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 border-b pb-2">
          {(["all", "A4", "A5"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "ghost"}
              size="sm"
              onClick={() => setFilter(f)}
              data-testid={`tab-size-${f}`}
            >
              {f === "all" ? "All" : f}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 min-w-0">
          <ScrollArea className="h-[180px] lg:h-[460px]">
            <div className="space-y-2 pr-2">
              {list.map((t) => {
                const active = t.id === previewId;
                return (
                  <button
                    key={t.id}
                    onClick={() => setPreviewId(t.id)}
                    data-testid={`template-option-${t.id}`}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{t.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {t.paper}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                    {t.id === value && (
                      <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
                        <Check className="h-3 w-3" /> Current
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          <div
            ref={containerRef}
            className="h-[280px] lg:h-[460px] min-w-0 overflow-auto rounded-lg border bg-muted/30 p-4"
          >
            <div
              style={{
                width,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
              className="bg-white shadow-sm"
            >
              <Preview invoice={invoice} maps={maps} settings={settings} computed={computed} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-template">
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSelect(previewId);
              onOpenChange(false);
            }}
            data-testid="button-select-template"
          >
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
