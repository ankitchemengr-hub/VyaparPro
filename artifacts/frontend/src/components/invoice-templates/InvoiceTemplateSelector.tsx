// Template chooser popup: size tabs (All / A4 / A5), template list on the left,
// scaled live preview of the highlighted template on the right, Select to apply.

import { useEffect, useState } from "react";
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

// On-screen preview width (px) per paper/orientation, for the scaled preview.
function sheetWidth(paper: PaperSize, orientation: string): number {
  if (orientation === "landscape") return paper === "A4" ? 1123 : 794;
  return paper === "A4" ? 794 : 559;
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
  const scale = meta.orientation === "landscape" ? 0.42 : 0.55;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
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

        <div className="grid grid-cols-[260px_1fr] gap-4">
          <ScrollArea className="h-[460px] pr-2">
            <div className="space-y-2">
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

          <div className="h-[460px] overflow-auto rounded-lg border bg-muted/30 p-4">
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
