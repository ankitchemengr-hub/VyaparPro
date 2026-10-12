import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateEntity, getListEntitiesQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Camera, ImageUp, ScanLine, Sparkles, CheckCircle2, AlertTriangle, Loader2, ChevronsUpDown,
  Check, UserPlus, RotateCcw, FileText, Brain, Link2, X,
} from "lucide-react";

// ─────────────────────────── types ───────────────────────────

export type ScanKind = "purchase" | "sale";

type ExtractedItem = {
  name: string; hsn: string; qty: number; unit: string;
  rate: number; discountPct: number; taxPct: number; amount: number;
};
type ExtractedBill = {
  party: { name: string; gstin: string; mobile: string; address: string; state: string };
  billNo: string; billDate: string; isGstBill: boolean; placeOfSupply: string;
  items: ExtractedItem[];
  totals: { taxable: number; cgst: number; sgst: number; igst: number; freight: number; roundOff: number; grandTotal: number };
  confidence: "high" | "medium" | "low";
  warnings: string[];
};
type Suggestion = { id: number; name: string; score: number };
type ScanResponse = {
  bill: ExtractedBill;
  party: {
    matched: { id: number; name: string; gstin: string | null; mobile: string | null; state: string | null } | null;
    matchedBy: "gstin" | "mobile" | "name" | null;
    suggestions: Suggestion[];
  };
  items: { productId: number | null; matchedBy: "learned" | "name" | "code" | null; score: number; suggestions: Suggestion[] }[];
};

// What the page gets back when the user taps "Fill the form".
export type ScanApplyResult = {
  partyId: number | null;
  // The full entity row for partyId (includes one just created in the dialog).
  party: any | null;
  billNo: string;
  billDate: string; // YYYY-MM-DD or ""
  isGstBill: boolean;
  placeOfSupply: string;
  freight: number;
  lines: { productId: number; rawName: string; qty: number; unit: string; rate: number; discountPct: number; taxPct: number }[];
  file: File;
};

type Row = ExtractedItem & {
  productId: number | null;
  matchedBy: ScanResponse["items"][number]["matchedBy"];
  suggestions: Suggestion[];
  skip: boolean;
};

// ─────────────────────────── file prep ───────────────────────────

const MAX_PDF_BYTES = 7 * 1024 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Phone photos are 4–12 MB; the model reads a 2000px JPEG just as well, and
// it uploads in a second instead of ten.
async function prepareFile(file: File): Promise<{ data: string; mediaType: string }> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error("PDF is larger than 7 MB — scan a single page photo instead.");
    return { data: await blobToBase64(file), mediaType: "application/pdf" };
  }
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo or a PDF of the bill.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    throw new Error("This image format can't be read here. Take the photo with the Camera button, or use JPG/PNG.");
  }
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", 0.85),
  );
  return { data: await blobToBase64(blob), mediaType: "image/jpeg" };
}

// ─────────────────────────── helpers ───────────────────────────

const money = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function lineTaxable(r: Row) {
  return r.qty * r.rate * (1 - (r.discountPct || 0) / 100);
}

// A total "matches" within ₹1 or 0.5%, whichever is larger — bills round
// per line, we round once.
function close(a: number, b: number) {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
}

const SCAN_STEPS = [
  { icon: ScanLine, text: "Reading the bill…" },
  { icon: Brain, text: "Understanding items, rates and GST…" },
  { icon: Link2, text: "Matching party and products…" },
  { icon: Sparkles, text: "Checking totals…" },
];

// ─────────────────────────── component ───────────────────────────

export function BillScanDialog({
  open, onOpenChange, kind, products, parties, onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: ScanKind;
  products: any[];
  parties: any[];
  onApply: (result: ScanApplyResult) => void;
}) {
  const { toast } = useToast();
  const [stage, setStage] = useState<"pick" | "scanning" | "review">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [partyId, setPartyId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(false);
  // Parties created from inside this dialog — the page's list may not have refetched yet.
  const [createdParties, setCreatedParties] = useState<any[]>([]);
  const allParties = useMemo(
    () => [...createdParties, ...parties.filter((p) => !createdParties.some((c) => c.id === p.id))],
    [createdParties, parties],
  );
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const partyWord = kind === "purchase" ? "Supplier" : "Customer";

  useEffect(() => {
    if (!open) {
      // Reset on close so the next scan starts clean.
      setStage("pick"); setFile(null); setError(null); setScan(null); setRows([]); setPartyId(null); setZoom(false); setCreatedParties([]);
      setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
    }
  }, [open]);

  useEffect(() => {
    if (stage !== "scanning") return;
    setStepIdx(0);
    const t = setInterval(() => setStepIdx((i) => Math.min(i + 1, SCAN_STEPS.length - 1)), 2600);
    return () => clearInterval(t);
  }, [stage]);

  const startScan = async (f: File) => {
    setError(null);
    setFile(f);
    setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return f.type.startsWith("image/") ? URL.createObjectURL(f) : null; });
    setStage("scanning");
    try {
      const { data, mediaType } = await prepareFile(f);
      const res = await fetch("/api/bill-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, mediaType, data }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Scan failed (${res.status})`);
      const s = body as ScanResponse;
      setScan(s);
      setPartyId(s.party.matched?.id ?? null);
      setRows(s.bill.items.map((it, i) => ({
        ...it,
        productId: s.items[i]?.productId ?? null,
        matchedBy: s.items[i]?.matchedBy ?? null,
        suggestions: s.items[i]?.suggestions ?? [],
        skip: false,
      })));
      setStage("review");
    } catch (e: any) {
      setError(e?.message ?? "Scan failed");
      setStage("pick");
    }
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) startScan(f);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) startScan(f);
  };

  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  // Live totals check — recomputed as the user fixes qty/rate/GST.
  const check = useMemo(() => {
    if (!scan) return null;
    const active = rows.filter((r) => !r.skip);
    const taxable = active.reduce((s, r) => s + lineTaxable(r), 0);
    const tax = scan.bill.isGstBill ? active.reduce((s, r) => s + lineTaxable(r) * (r.taxPct || 0) / 100, 0) : 0;
    const t = scan.bill.totals;
    const billTax = t.cgst + t.sgst + t.igst;
    const grand = taxable + tax + t.freight;
    return {
      taxable: { ours: taxable, bill: t.taxable, ok: t.taxable === 0 || close(taxable, t.taxable) },
      tax: { ours: tax, bill: billTax, ok: !scan.bill.isGstBill || billTax === 0 || close(tax, billTax) },
      grand: { ours: Math.round(grand), bill: t.grandTotal, ok: t.grandTotal === 0 || close(grand, t.grandTotal) },
    };
  }, [rows, scan]);

  const unmapped = rows.filter((r) => !r.skip && r.productId == null).length;
  const allTotalsOk = !!check && check.taxable.ok && check.tax.ok && check.grand.ok;
  const activeCount = rows.filter((r) => !r.skip).length;

  const apply = () => {
    if (!scan || !file) return;
    const lines = rows
      .filter((r) => !r.skip && r.productId != null)
      .map((r) => ({
        productId: r.productId!, rawName: r.name, qty: r.qty, unit: r.unit,
        rate: r.rate, discountPct: r.discountPct, taxPct: scan.bill.isGstBill ? r.taxPct : 0,
      }));
    // Remember the user's item choices for this party, so next time they map themselves.
    const learned = rows
      .filter((r) => !r.skip && r.productId != null && r.matchedBy !== "learned" && r.matchedBy !== "code")
      .map((r) => ({ rawName: r.name, productId: r.productId! }));
    if (learned.length > 0) {
      fetch("/api/bill-scan/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, partyId, entries: learned }),
      }).catch(() => { /* non-critical */ });
    }
    onApply({
      partyId,
      party: partyId != null ? allParties.find((p) => p.id === partyId) ?? null : null,
      billNo: scan.bill.billNo,
      billDate: /^\d{4}-\d{2}-\d{2}$/.test(scan.bill.billDate) ? scan.bill.billDate : "",
      isGstBill: scan.bill.isGstBill,
      placeOfSupply: scan.bill.placeOfSupply,
      freight: scan.bill.totals.freight,
      lines,
      file,
    });
    toast({ title: "Bill filled in", description: "Check once and press Save — stock and ledger update on save." });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("p-0 gap-0 overflow-hidden", stage === "review" ? "max-w-6xl" : "max-w-lg")}>
        <style>{SCAN_CSS}</style>
        <div className="bill-scan-header px-5 py-4 text-white">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="flex items-center gap-2 text-white">
              <Sparkles className="w-5 h-5" />
              Scan {kind === "purchase" ? "Purchase" : "Sale"} Bill
            </DialogTitle>
            <DialogDescription className="text-white/80">
              {stage === "review"
                ? "Check what was read. Fix anything in red, then fill the form."
                : "Photo of the bill → items, party and totals filled in automatically."}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── Pick ── */}
        {stage === "pick" && (
          <div className="p-5 space-y-4" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => cameraRef.current?.click()}
                className="bill-scan-tile group" data-testid="button-scan-camera">
                <span className="bill-scan-tile-icon"><Camera className="w-7 h-7" /></span>
                <span className="font-semibold">Camera</span>
                <span className="text-xs text-muted-foreground">Take a photo now</span>
              </button>
              <button type="button" onClick={() => galleryRef.current?.click()}
                className="bill-scan-tile group" data-testid="button-scan-upload">
                <span className="bill-scan-tile-icon"><ImageUp className="w-7 h-7" /></span>
                <span className="font-semibold">Gallery / PDF</span>
                <span className="text-xs text-muted-foreground">Pick a saved file</span>
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChosen} />
            <input ref={galleryRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFileChosen} />
            <p className="hidden sm:block text-center text-xs text-muted-foreground">…or drop a bill image / PDF here</p>
            {error && (
              <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </div>
            )}
            <ul className="text-xs text-muted-foreground space-y-1">
              <li>• Lay the bill flat, in good light, whole page in frame.</li>
              <li>• Printed, handwritten, Hindi or Marathi bills all work.</li>
              <li>• Nothing is saved until you press Save on the form.</li>
            </ul>
          </div>
        )}

        {/* ── Scanning ── */}
        {stage === "scanning" && (
          <div className="p-5 space-y-5">
            <div className="bill-scan-stage">
              {previewUrl
                ? <img src={previewUrl} alt="Bill" className="w-full h-full object-contain" />
                : <div className="w-full h-full flex items-center justify-center"><FileText className="w-16 h-16 text-muted-foreground" /></div>}
              <div className="bill-scan-beam" />
              <div className="bill-scan-grid" />
            </div>
            <ol className="space-y-2">
              {SCAN_STEPS.map((s, i) => {
                const Icon = s.icon;
                const state = i < stepIdx ? "done" : i === stepIdx ? "active" : "todo";
                return (
                  <li key={i} className={cn("flex items-center gap-2 text-sm transition-opacity",
                    state === "todo" && "opacity-40")}>
                    {state === "done" ? <CheckCircle2 className="w-4 h-4 text-green-600" />
                      : state === "active" ? <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      : <Icon className="w-4 h-4" />}
                    {s.text}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* ── Review ── */}
        {stage === "review" && scan && check && (
          <div className="grid lg:grid-cols-[260px_1fr] max-h-[80vh] overflow-y-auto">
            {/* Left: the bill itself */}
            <div className="border-b lg:border-b-0 lg:border-r bg-muted/30 p-4 space-y-3">
              {previewUrl ? (
                <button type="button" onClick={() => setZoom(true)} className="block w-full rounded-md overflow-hidden border bg-background">
                  <img src={previewUrl} alt="Bill" className="w-full max-h-72 object-contain" />
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-md border bg-background p-3 text-sm">
                  <FileText className="w-5 h-5" /> {file?.name}
                </div>
              )}
              <ConfidenceBadge level={scan.bill.confidence} />
              {scan.bill.warnings.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                  {scan.bill.warnings.map((w, i) => (
                    <li key={i} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</li>
                  ))}
                </ul>
              )}
              <Button variant="outline" size="sm" className="w-full" onClick={() => setStage("pick")}>
                <RotateCcw className="w-4 h-4 mr-1.5" /> Scan another photo
              </Button>
            </div>

            {/* Right: what we understood */}
            <div className="p-4 space-y-4 min-w-0">
              <PartyCard
                kind={kind}
                partyWord={partyWord}
                scanned={scan.bill.party}
                match={scan.party}
                parties={allParties}
                partyId={partyId}
                onPartyId={setPartyId}
                onCreated={(entity) => { setCreatedParties((prev) => [entity, ...prev]); setPartyId(entity.id); }}
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Meta label="Bill No." value={scan.bill.billNo || "—"} />
                <Meta label="Date" value={scan.bill.billDate || "—"} />
                <Meta label="Type" value={scan.bill.isGstBill ? "GST bill" : "Non-GST bill"} />
                <Meta label="Place of supply" value={scan.bill.placeOfSupply || "—"} />
              </div>

              {/* Items */}
              <div className="rounded-lg border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-medium">{rows.length} item{rows.length === 1 ? "" : "s"} read</span>
                  {unmapped > 0
                    ? <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">{unmapped} need a product</Badge>
                    : <Badge className="bg-green-600 text-white border-transparent">All matched</Badge>}
                </div>
                <div className="divide-y">
                  {rows.map((r, i) => (
                    <div key={i} className={cn("p-3 space-y-2", r.skip && "opacity-50")}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs text-muted-foreground">On bill</div>
                          <div className="font-medium break-words">{r.name}{r.hsn ? <span className="text-xs text-muted-foreground"> · HSN {r.hsn}</span> : null}</div>
                        </div>
                        <Button variant="ghost" size="sm" className="shrink-0 h-7 px-2 text-xs"
                          onClick={() => updateRow(i, { skip: !r.skip })}>
                          {r.skip ? "Include" : <><X className="w-3.5 h-3.5 mr-1" />Skip</>}
                        </Button>
                      </div>
                      {!r.skip && (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <ProductPicker products={products} value={r.productId}
                              onChange={(id) => updateRow(i, { productId: id, matchedBy: null })} />
                            <MatchBadge row={r} />
                          </div>
                          {r.productId == null && r.suggestions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              <span className="text-xs text-muted-foreground self-center">Did you mean:</span>
                              {r.suggestions.map((s) => (
                                <button key={s.id} type="button"
                                  className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
                                  onClick={() => updateRow(i, { productId: s.id })}>
                                  {s.name}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="grid grid-cols-4 gap-2">
                            <NumField label="Qty" value={r.qty} onChange={(v) => updateRow(i, { qty: v })} />
                            <NumField label="Rate" value={r.rate} onChange={(v) => updateRow(i, { rate: v })} />
                            <NumField label="Disc %" value={r.discountPct} onChange={(v) => updateRow(i, { discountPct: v })} />
                            {scan.bill.isGstBill
                              ? <NumField label="GST %" value={r.taxPct} onChange={(v) => updateRow(i, { taxPct: v })} />
                              : <div className="text-right"><div className="text-[11px] text-muted-foreground">Amount</div><div className="text-sm tabular-nums pt-1.5">{money(lineTaxable(r))}</div></div>}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals check */}
              <div className={cn("rounded-lg border p-3", allTotalsOk ? "border-green-500/40 bg-green-500/5" : "border-destructive/40 bg-destructive/5")}>
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  {allTotalsOk
                    ? <><CheckCircle2 className="w-4 h-4 text-green-600" /> Totals match the bill</>
                    : <><AlertTriangle className="w-4 h-4 text-destructive" /> Totals don't match — check qty / rate / GST above</>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <TotalCell label="Taxable" {...check.taxable} />
                  <TotalCell label="GST" {...check.tax} />
                  <TotalCell label="Grand total" {...check.grand} />
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-1">
                {unmapped > 0 && (
                  <span className="text-xs text-amber-700 dark:text-amber-400 sm:mr-auto">
                    Pick a product for every item, or skip it.
                  </span>
                )}
                <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={apply} disabled={unmapped > 0 || activeCount === 0} data-testid="button-scan-apply"
                  className="bill-scan-cta">
                  <Check className="w-4 h-4 mr-1.5" /> Fill the form
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>

      {zoom && previewUrl && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setZoom(false)}>
          <img src={previewUrl} alt="Bill" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </Dialog>
  );
}

// ─────────────────────────── sub-components ───────────────────────────

function PartyCard({
  kind, partyWord, scanned, match, parties, partyId, onPartyId, onCreated,
}: {
  kind: ScanKind;
  partyWord: string;
  scanned: ExtractedBill["party"];
  match: ScanResponse["party"];
  parties: any[];
  partyId: number | null;
  onPartyId: (id: number | null) => void;
  onCreated: (entity: any) => void;
}) {
  const [creating, setCreating] = useState(false);
  const selected = parties.find((p) => p.id === partyId) ?? (match.matched?.id === partyId ? match.matched : null);

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">{partyWord} on bill</div>
          <div className="font-semibold break-words">{scanned.name || "—"}</div>
          <div className="text-xs text-muted-foreground">
            {[scanned.gstin && `GSTIN ${scanned.gstin}`, scanned.mobile, scanned.state].filter(Boolean).join(" · ")}
          </div>
        </div>
        {selected && partyId === match.matched?.id && match.matchedBy && (
          <Badge className="bg-green-600 text-white border-transparent shrink-0">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Matched by {match.matchedBy === "gstin" ? "GSTIN" : match.matchedBy}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <EntityPicker parties={parties} value={partyId} onChange={onPartyId} placeholder={`Choose ${partyWord.toLowerCase()}`} />
        {!selected && (
          <Button variant="outline" size="sm" onClick={() => setCreating((v) => !v)}>
            <UserPlus className="w-4 h-4 mr-1.5" /> New {partyWord.toLowerCase()}
          </Button>
        )}
        {!selected && kind === "sale" && (
          <span className="text-xs text-muted-foreground">Leave empty for a cash sale.</span>
        )}
      </div>

      {!selected && match.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs text-muted-foreground self-center">Did you mean:</span>
          {match.suggestions.map((s) => (
            <button key={s.id} type="button" className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-accent"
              onClick={() => onPartyId(s.id)}>{s.name}</button>
          ))}
        </div>
      )}

      {creating && !selected && (
        <NewPartyForm
          kind={kind}
          scanned={scanned}
          onCreated={(entity) => { onCreated(entity); setCreating(false); }}
        />
      )}
    </div>
  );
}

function NewPartyForm({ kind, scanned, onCreated }: {
  kind: ScanKind; scanned: ExtractedBill["party"]; onCreated: (entity: any) => void;
}) {
  const createEntity = useCreateEntity();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(scanned.name);
  const [mobile, setMobile] = useState(scanned.mobile.replace(/\D/g, "").slice(-10));
  const [gstin, setGstin] = useState(scanned.gstin.toUpperCase());
  const [state, setState] = useState(scanned.state || "Maharashtra");

  const save = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (!/^\d{10}$/.test(mobile)) { toast({ title: "Enter a 10-digit mobile number", variant: "destructive" }); return; }
    try {
      const created: any = await createEntity.mutateAsync({
        data: {
          type: kind === "purchase" ? "vendor" : "customer",
          name: name.trim(), mobile,
          gstin: gstin.trim() || undefined,
          state: state.trim() || undefined,
          address: scanned.address.trim() || undefined,
        } as any,
      });
      await queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
      toast({ title: `${created.name} added` });
      onCreated(created);
    } catch (err: any) {
      let desc = err?.message ?? "Server error";
      try { const b = err?.response ? await err.response.json() : null; if (b?.error) desc = String(b.error).slice(0, 300); } catch {}
      toast({ title: "Could not add", description: desc, variant: "destructive" });
    }
  };

  return (
    <div className="grid gap-2 sm:grid-cols-4 rounded-md bg-muted/40 p-3">
      <div className="sm:col-span-2 space-y-1"><Label className="text-xs">Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1"><Label className="text-xs">Mobile</Label><Input inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} /></div>
      <div className="space-y-1"><Label className="text-xs">GSTIN</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} /></div>
      <div className="sm:col-span-2 space-y-1"><Label className="text-xs">State</Label><Input value={state} onChange={(e) => setState(e.target.value)} /></div>
      <div className="sm:col-span-2 flex items-end justify-end">
        <Button size="sm" onClick={save} disabled={createEntity.isPending}>
          {createEntity.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1.5" />}
          Save {kind === "purchase" ? "supplier" : "customer"}
        </Button>
      </div>
    </div>
  );
}

function SearchPicker({ items, value, onChange, placeholder, emptyText }: {
  items: { id: number; label: string; sub?: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = items.find((i) => i.id === value);
  const ql = q.trim().toLowerCase();
  const filtered = (ql ? items.filter((i) => i.label.toLowerCase().includes(ql) || i.sub?.toLowerCase().includes(ql)) : items).slice(0, 80);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" size="sm"
          className={cn("min-w-[200px] max-w-full justify-between font-normal", !selected && "border-amber-500 text-amber-700 dark:text-amber-400")}>
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={q} onValueChange={setQ} />
          <CommandList className="max-h-64">
            {filtered.length === 0 && <CommandEmpty className="py-2 px-3 text-sm text-muted-foreground">{emptyText}</CommandEmpty>}
            <CommandGroup>
              {filtered.map((i) => (
                <CommandItem key={i.id} value={String(i.id)} onSelect={() => { onChange(i.id); setOpen(false); setQ(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === i.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{i.label}</span>
                  {i.sub && <span className="ml-auto pl-2 text-xs text-muted-foreground truncate">{i.sub}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ProductPicker({ products, value, onChange }: { products: any[]; value: number | null; onChange: (id: number | null) => void }) {
  const items = useMemo(() => products.map((p) => ({ id: p.id, label: p.name, sub: p.itemCode })), [products]);
  return <SearchPicker items={items} value={value} onChange={onChange} placeholder="Pick product" emptyText="No product found — add it on the Inventory page." />;
}

function EntityPicker({ parties, value, onChange, placeholder }: { parties: any[]; value: number | null; onChange: (id: number | null) => void; placeholder: string }) {
  const items = useMemo(() => parties.map((p) => ({ id: p.id, label: p.name, sub: p.mobile })), [parties]);
  return <SearchPicker items={items} value={value} onChange={onChange} placeholder={placeholder} emptyText="Not found — add as new." />;
}

function MatchBadge({ row }: { row: Row }) {
  if (row.productId == null) return <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">Choose product</Badge>;
  if (row.matchedBy === "learned") return <Badge variant="secondary"><Brain className="w-3 h-3 mr-1" />Remembered</Badge>;
  if (row.matchedBy === "code") return <Badge variant="secondary">Item code</Badge>;
  if (row.matchedBy === "name") return <Badge variant="secondary">Auto-matched</Badge>;
  return <Badge variant="secondary"><Check className="w-3 h-3 mr-1" />Selected</Badge>;
}

function ConfidenceBadge({ level }: { level: ExtractedBill["confidence"] }) {
  const map = {
    high: { cls: "bg-green-600 text-white border-transparent", text: "Clear read" },
    medium: { cls: "bg-amber-500 text-white border-transparent", text: "Mostly clear — double-check" },
    low: { cls: "bg-destructive text-white border-transparent", text: "Hard to read — check carefully" },
  }[level];
  return <Badge className={cn("w-full justify-center py-1", map.cls)}>{map.text}</Badge>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <Input type="number" inputMode="decimal" step="any" className="h-8 text-right tabular-nums px-2"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </div>
  );
}

function TotalCell({ label, ours, bill, ok }: { label: string; ours: number; bill: number; ok: boolean }) {
  return (
    <div className="rounded-md bg-background/70 border px-2 py-1.5">
      <div className="flex items-center justify-between text-muted-foreground">
        {label}
        {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
      </div>
      <div className="tabular-nums font-medium">{money(ours)}</div>
      <div className="tabular-nums text-muted-foreground">Bill: {bill ? money(bill) : "—"}</div>
    </div>
  );
}

// Trigger button used on the Purchases and Billing pages.
export function ScanBillButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <>
      <style>{SCAN_CSS}</style>
      <Button type="button" onClick={onClick} className={cn("bill-scan-cta", className)} data-testid="button-scan-bill">
        <Camera className="w-4 h-4 mr-2" /> Scan Bill
        <Sparkles className="w-3.5 h-3.5 ml-1.5 opacity-80" />
      </Button>
    </>
  );
}

const SCAN_CSS = `
.bill-scan-header { background: linear-gradient(120deg, hsl(250 70% 50%), hsl(200 85% 45%) 60%, hsl(170 70% 40%)); }
.bill-scan-cta { background: linear-gradient(120deg, hsl(250 70% 52%), hsl(200 85% 45%)); color: white; border: 0; box-shadow: 0 4px 14px -4px hsl(230 80% 50% / .55); }
.bill-scan-cta:hover { filter: brightness(1.08); }
.bill-scan-cta:disabled { filter: grayscale(.6); box-shadow: none; }
.bill-scan-tile { display:flex; flex-direction:column; align-items:center; gap:.35rem; padding:1.25rem .75rem; border-radius:.9rem;
  border:1px dashed hsl(var(--border)); background:hsl(var(--muted)/.35); transition: transform .15s, border-color .15s, background .15s; }
.bill-scan-tile:hover { transform: translateY(-2px); border-color: hsl(220 80% 55%); background: hsl(220 80% 55% / .07); }
.bill-scan-tile-icon { display:grid; place-items:center; width:3.25rem; height:3.25rem; border-radius:999px; color:white;
  background: linear-gradient(135deg, hsl(250 70% 55%), hsl(190 85% 45%)); box-shadow: 0 6px 18px -6px hsl(230 80% 50% / .7); }
.bill-scan-stage { position:relative; height: 300px; border-radius:.75rem; overflow:hidden; background:hsl(var(--muted)); border:1px solid hsl(var(--border)); }
.bill-scan-beam { position:absolute; left:0; right:0; height:70px; top:-70px;
  background: linear-gradient(180deg, transparent, hsl(190 95% 50% / .35) 70%, hsl(190 95% 60% / .95) 98%, transparent);
  animation: billScanBeam 2.2s cubic-bezier(.45,0,.55,1) infinite; }
.bill-scan-grid { position:absolute; inset:0; pointer-events:none; opacity:.18;
  background-image: linear-gradient(hsl(190 90% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(190 90% 50%) 1px, transparent 1px);
  background-size: 22px 22px; }
@keyframes billScanBeam { 0% { top:-70px } 100% { top:100% } }
@media (prefers-reduced-motion: reduce) { .bill-scan-beam { animation: none; top: 40%; } }
`;
