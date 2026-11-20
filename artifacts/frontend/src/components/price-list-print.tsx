// Price List → Print / Share: choose which columns go on the printed list —
// e.g. only Item + Retail ₹ for a retail customer, Item + Wholesale ₹ for a
// wholesale customer, or every rate including Purchase ₹ for your own check.
// Prints from a hidden iframe (Save as PDF from the print dialog to share), or
// shares a plain-text list on WhatsApp.

import React, { useMemo, useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, MessageCircle, AlertTriangle } from "lucide-react";

export interface PrintableProduct {
  id: number;
  name: string;
  group: string | null;
  brand: string | null;
  itemCode: string | null;
  unit: string | null;
  hsnCode: string | null;
  taxRate: number | null;
  purchasePrice: number;
  wholesalePrice: number;
  retailPrice: number;
  nonGstPrice: number | null;
  mrp?: number | null;
}

type ColKey = "itemCode" | "group" | "brand" | "unit" | "hsn" | "gst" | "mrp" | "purchase" | "wholesale" | "retail" | "nonGst";

const COLS: { key: ColKey; label: string; money?: boolean; internal?: boolean }[] = [
  { key: "itemCode", label: "Item code" },
  { key: "group", label: "Group" },
  { key: "brand", label: "Brand" },
  { key: "unit", label: "Unit" },
  { key: "hsn", label: "HSN" },
  { key: "gst", label: "GST %" },
  { key: "mrp", label: "MRP", money: true },
  { key: "purchase", label: "Purchase", money: true, internal: true },
  { key: "wholesale", label: "Wholesale", money: true },
  { key: "retail", label: "Retail", money: true },
  { key: "nonGst", label: "Non-GST", money: true },
];

const PRESETS: { key: string; label: string; hint: string; cols: ColKey[]; title: string }[] = [
  { key: "retail", label: "Retail customer", hint: "Item + Retail price", cols: ["unit", "retail"], title: "Retail Price List" },
  { key: "wholesale", label: "Wholesale customer", hint: "Item + Wholesale price", cols: ["unit", "wholesale"], title: "Wholesale Price List" },
  { key: "nonGst", label: "Non-GST customer", hint: "Item + Non-GST price", cols: ["unit", "nonGst"], title: "Price List" },
  { key: "internal", label: "My check (all rates)", hint: "Purchase, Wholesale, Retail, Non-GST", cols: ["itemCode", "unit", "gst", "purchase", "wholesale", "retail", "nonGst"], title: "Price List — internal" },
];

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) || Number(n) === 0 ? "—" : `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function cell(p: PrintableProduct, k: ColKey): string {
  switch (k) {
    case "itemCode": return p.itemCode ?? "";
    case "group": return p.group ?? "";
    case "brand": return p.brand ?? "";
    case "unit": return p.unit ?? "";
    case "hsn": return p.hsnCode ?? "";
    case "gst": return p.taxRate != null ? `${p.taxRate}%` : "";
    case "mrp": return money(p.mrp);
    case "purchase": return money(p.purchasePrice);
    case "wholesale": return money(p.wholesalePrice);
    case "retail": return money(p.retailPrice);
    case "nonGst": return money(p.nonGstPrice);
  }
}

export function PriceListPrintDialog({ open, onOpenChange, products, scopeLabel, unsaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  products: PrintableProduct[];
  scopeLabel: string;
  unsaved: boolean;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [preset, setPreset] = useState("retail");
  const [cols, setCols] = useState<Set<ColKey>>(new Set(PRESETS[0].cols));
  const [title, setTitle] = useState(PRESETS[0].title);
  const [byGroup, setByGroup] = useState(true);
  const [note, setNote] = useState("");

  const choose = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)!;
    setPreset(key);
    setCols(new Set(p.cols));
    setTitle(p.title);
  };
  const toggle = (k: ColKey) => {
    setPreset("custom");
    setCols((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  };
  const chosen = COLS.filter((c) => cols.has(c.key));
  const internal = cols.has("purchase");
  const companyName = (user as any)?.company?.name ?? "";
  const companyLogo = (user as any)?.company?.logo ?? null;
  const today = format(new Date(), "dd MMM yyyy");

  const sorted = useMemo(() => [...products].sort((a, b) =>
    (byGroup ? (a.group ?? "").localeCompare(b.group ?? "") : 0) || a.name.localeCompare(b.name)), [products, byGroup]);
  const groups = useMemo(() => {
    const m = new Map<string, PrintableProduct[]>();
    for (const p of sorted) {
      const g = byGroup ? (p.group || "Other") : "";
      m.set(g, [...(m.get(g) ?? []), p]);
    }
    return [...m];
  }, [sorted, byGroup]);

  const print = () => {
    const head = `<tr><th class="n">#</th><th>Item</th>${chosen.map((c) => `<th class="${c.money ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr>`;
    let i = 0;
    const body = groups.map(([g, list]) => {
      const gRow = g ? `<tr class="g"><td colspan="${chosen.length + 2}">${esc(g)}</td></tr>` : "";
      return gRow + list.map((p) => `<tr><td class="n">${++i}</td><td>${esc(p.name)}</td>${chosen.map((c) => `<td class="${c.money ? "r" : ""}">${esc(cell(p, c.key))}</td>`).join("")}</tr>`).join("");
    }).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      @page { size: A4; margin: 12mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; }
      .top { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
      .top img { height: 42px; }
      h1 { font-size: 18px; margin: 0; } h2 { font-size: 13px; margin: 2px 0 0; font-weight: normal; }
      .meta { font-size: 10px; color: #555; margin-bottom: 6px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: left; vertical-align: top; }
      th { background: #f0f0f0; } .r { text-align: right; white-space: nowrap; } .n { width: 22px; text-align: right; color: #666; }
      tr.g td { background: #e8eefc; font-weight: bold; }
      thead { display: table-header-group; } tr { page-break-inside: avoid; }
      .note { margin-top: 8px; font-size: 10px; color: #444; }
      .warn { color: #b00; font-weight: bold; }
    </style></head><body>
      <div class="top">${companyLogo ? `<img src="${esc(companyLogo)}" alt="">` : ""}<div><h1>${esc(companyName)}</h1><h2>${esc(title)}</h2></div></div>
      <div class="meta">Rates as on ${esc(today)} · ${sorted.length} item${sorted.length === 1 ? "" : "s"}${internal ? ' · <span class="warn">INTERNAL — contains purchase price</span>' : ""}</div>
      <table><thead>${head}</thead><tbody>${body}</tbody></table>
      ${note ? `<div class="note">${esc(note)}</div>` : ""}
    </body></html>`;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    const go = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    // Wait for the logo (if any) before printing.
    const img = doc.querySelector("img");
    if (img && !img.complete) { img.onload = go; img.onerror = go; } else setTimeout(go, 50);
  };

  const shareText = () => {
    const money1 = chosen.filter((c) => c.money);
    const lines = [`*${companyName ? `${companyName} — ` : ""}${title}*`, `Rates as on ${today}`, ""];
    for (const [g, list] of groups) {
      if (g) lines.push(`*${g}*`);
      for (const p of list) {
        const prices = money1.map((c) => (money1.length > 1 ? `${c.label} ${cell(p, c.key)}` : cell(p, c.key))).join(" | ");
        lines.push(`• ${p.name}${p.unit && cols.has("unit") ? ` (${p.unit})` : ""} — ${prices}`);
      }
      if (g) lines.push("");
    }
    if (note) lines.push(note);
    const text = lines.join("\n");
    if (text.length > 6000) {
      void navigator.clipboard?.writeText(text);
      toast({ title: "List copied", description: "Too long for a WhatsApp link — paste it in WhatsApp, or print / save as PDF instead." });
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Printer className="w-5 h-5" /> Print / share price list</DialogTitle>
          <DialogDescription>{scopeLabel} — {products.length} item{products.length === 1 ? "" : "s"}. Choose what the customer should see.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => choose(p.key)}
                className={`text-left rounded-lg border p-2.5 transition-colors ${preset === p.key ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:bg-accent"}`}
                data-testid={`preset-print-${p.key}`}
              >
                <div className="text-sm font-medium">{p.label}</div>
                <div className="text-xs text-muted-foreground">{p.hint}</div>
              </button>
            ))}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Columns (Item name is always printed)</Label>
            <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2">
              {COLS.map((c) => (
                <label key={c.key} className={`flex items-center gap-2 text-sm ${c.internal ? "text-red-700 dark:text-red-400" : ""}`}>
                  <Checkbox checked={cols.has(c.key)} onCheckedChange={() => toggle(c.key)} data-testid={`check-print-col-${c.key}`} />
                  {c.label}{c.money ? " ₹" : ""}
                </label>
              ))}
            </div>
          </div>

          {internal && (
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 p-2 text-xs text-red-800 dark:text-red-300 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> Purchase price is on this list — keep it for yourself, don't send it to a customer.
            </div>
          )}

          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>Heading</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Note at the bottom (optional)</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Rates subject to change · GST extra on wholesale" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={byGroup} onCheckedChange={(v) => setByGroup(!!v)} /> Group by product group
            </label>
          </div>

          {unsaved && (
            <p className="text-xs text-amber-700">You have unsaved price changes — the list uses the saved prices. Save first to print the new ones.</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={shareText} disabled={products.length === 0} data-testid="button-share-pricelist-whatsapp">
            <MessageCircle className="w-4 h-4 mr-1" /> WhatsApp text
          </Button>
          <Button onClick={print} disabled={products.length === 0} data-testid="button-print-pricelist">
            <Printer className="w-4 h-4 mr-1" /> Print / PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
