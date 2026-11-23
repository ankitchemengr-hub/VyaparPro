// Settings → Barcode Generator. Prints barcode / QR stickers for products on
// the label sheets sold in the market (A4 sticker sheets and thermal rolls):
// pick the sheet, pick products and how many of each, choose what goes on the
// sticker, check the preview, print. Labels are drawn in millimetres with
// inline styles only, so the same markup prints exactly in the print frame.

import React from "react";
import { QRCodeSVG } from "qrcode.react";
import { useListProducts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Barcode, QrCode, Printer, Trash2, ChevronDown, AlertTriangle } from "lucide-react";
import { canEncodeCode128, code128Modules } from "@/lib/code128";

type SheetSize = {
  id: string;
  label: string;
  kind: "sheet" | "roll";
  w: number; h: number; // one sticker, mm
  cols: number; rows: number;
  top: number; left: number; // page margin to the first sticker, mm
  gapX: number; gapY: number;
};

// Common sticker sheets (A4, 210 × 297 mm) and thermal rolls. Margins follow
// the standard layouts; brands differ slightly, which the offset fixes.
const SHEETS: SheetSize[] = [
  { id: "a4-65", label: "A4 · 65 stickers (38.1 × 21.2 mm)", kind: "sheet", w: 38.1, h: 21.2, cols: 5, rows: 13, top: 10.7, left: 4.65, gapX: 2.5, gapY: 0 },
  { id: "a4-48", label: "A4 · 48 stickers (48 × 24 mm)", kind: "sheet", w: 48, h: 24, cols: 4, rows: 12, top: 4.5, left: 9, gapX: 0, gapY: 0 },
  { id: "a4-40", label: "A4 · 40 stickers (52.5 × 29.7 mm)", kind: "sheet", w: 52.5, h: 29.7, cols: 4, rows: 10, top: 0, left: 0, gapX: 0, gapY: 0 },
  { id: "a4-24", label: "A4 · 24 stickers (63.5 × 33.9 mm)", kind: "sheet", w: 63.5, h: 33.9, cols: 3, rows: 8, top: 12.9, left: 7.25, gapX: 2.5, gapY: 0 },
  { id: "a4-24b", label: "A4 · 24 stickers (70 × 37 mm)", kind: "sheet", w: 70, h: 37, cols: 3, rows: 8, top: 0.5, left: 0, gapX: 0, gapY: 0 },
  { id: "a4-21", label: "A4 · 21 stickers (63.5 × 38.1 mm)", kind: "sheet", w: 63.5, h: 38.1, cols: 3, rows: 7, top: 15.15, left: 7.25, gapX: 2.5, gapY: 0 },
  { id: "a4-16", label: "A4 · 16 stickers (99.1 × 33.9 mm)", kind: "sheet", w: 99.1, h: 33.9, cols: 2, rows: 8, top: 12.9, left: 4.65, gapX: 2.5, gapY: 0 },
  { id: "a4-14", label: "A4 · 14 stickers (99.1 × 38.1 mm)", kind: "sheet", w: 99.1, h: 38.1, cols: 2, rows: 7, top: 15.15, left: 4.65, gapX: 2.5, gapY: 0 },
  { id: "a4-12", label: "A4 · 12 stickers (63.5 × 72 mm)", kind: "sheet", w: 63.5, h: 72, cols: 3, rows: 4, top: 4.5, left: 7.25, gapX: 2.5, gapY: 0 },
  { id: "a4-10", label: "A4 · 10 stickers (99.1 × 57 mm)", kind: "sheet", w: 99.1, h: 57, cols: 2, rows: 5, top: 6, left: 4.65, gapX: 2.5, gapY: 0 },
  { id: "a4-8", label: "A4 · 8 stickers (99.1 × 67.7 mm)", kind: "sheet", w: 99.1, h: 67.7, cols: 2, rows: 4, top: 13.1, left: 4.65, gapX: 2.5, gapY: 0 },
  { id: "roll-50x25", label: "Thermal roll · 50 × 25 mm", kind: "roll", w: 50, h: 25, cols: 1, rows: 1, top: 0, left: 0, gapX: 0, gapY: 0 },
  { id: "roll-38x25", label: "Thermal roll · 38 × 25 mm", kind: "roll", w: 38, h: 25, cols: 1, rows: 1, top: 0, left: 0, gapX: 0, gapY: 0 },
  { id: "roll-2x50x25", label: "Thermal roll · 2 across, 50 × 25 mm", kind: "roll", w: 50, h: 25, cols: 2, rows: 1, top: 0, left: 1, gapX: 2, gapY: 0 },
  { id: "roll-100x50", label: "Thermal roll · 100 × 50 mm", kind: "roll", w: 100, h: 50, cols: 1, rows: 1, top: 0, left: 0, gapX: 0, gapY: 0 },
];
const CUSTOM_DEFAULT: SheetSize = { id: "custom", label: "Custom size", kind: "sheet", w: 50, h: 25, cols: 4, rows: 11, top: 10, left: 5, gapX: 0, gapY: 0 };

const A4_W = 210;
const A4_H = 297;
const MM_PX = 96 / 25.4;
const MAX_LABELS = 2000;
// Narrowest bar most scanners still read reliably.
const MIN_MODULE_MM = 0.17;

type Settings = {
  sheetId: string;
  custom: SheetSize;
  codeType: "barcode" | "qr";
  qrContent: "code" | "details";
  showName: boolean;
  showMrp: boolean;
  showPrice: boolean;
  showCodeText: boolean;
  extra: [string, string, string];
  offsetX: number;
  offsetY: number;
};
const DEFAULT_SETTINGS: Settings = {
  sheetId: "a4-65",
  custom: CUSTOM_DEFAULT,
  codeType: "barcode",
  qrContent: "code",
  showName: true,
  showMrp: true,
  showPrice: false,
  showCodeText: true,
  extra: ["", "", ""],
  offsetX: 0,
  offsetY: 0,
};
const STORAGE_KEY = "barcode-generator-v1";

type Row = {
  key: number;
  productId: number;
  name: string;
  mrp: number;
  price: number;
  stock: number;
  code: string;
  qty: number;
  serial: boolean;
};

type LabelData = { name: string; mrp: number; price: number; code: string };

const rupee = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// "BAT0007" + 3 → "BAT0010": the trailing number counts up, keeping its width.
export function nthSerial(start: string, n: number): string {
  const m = start.match(/^(.*?)(\d+)$/);
  if (!m) return n === 0 ? start : `${start}-${n + 1}`;
  const next = String(Number(m[2]) + n);
  return m[1] + next.padStart(m[2].length, "0");
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch { /* private mode etc. — defaults are fine */ }
  return DEFAULT_SETTINGS;
}

function pageSize(s: SheetSize): { w: number; h: number } {
  if (s.kind === "roll") return { w: s.left * 2 + s.cols * s.w + (s.cols - 1) * s.gapX, h: s.h };
  return { w: A4_W, h: A4_H };
}

function BarcodeSvg({ code, heightMm }: { code: string; heightMm: number }) {
  const modules = code128Modules(code);
  const quiet = 10;
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (modules[j] === "1") j++;
    bars.push(<rect key={i} x={i + quiet} y={0} width={j - i} height={1} />);
    i = j;
  }
  return (
    <svg
      viewBox={`0 0 ${modules.length + quiet * 2} 1`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      style={{ width: "100%", height: `${heightMm}mm`, display: "block" }}
      fill="#000"
    >
      {bars}
    </svg>
  );
}

function qrText(d: LabelData, s: Settings): string {
  if (s.qrContent === "code") return d.code;
  return [
    d.name,
    d.mrp > 0 ? `MRP ${rupee(d.mrp)}` : "",
    d.price > 0 ? `Price ${rupee(d.price)}` : "",
    `Code ${d.code}`,
    ...s.extra,
  ].filter((x) => x.trim()).join("\n");
}

// One sticker, drawn in mm with inline styles (also used in the print frame).
function LabelBox({ d, s, w, h }: { d: LabelData; s: Settings; w: number; h: number }) {
  const font = Math.max(5, Math.min(10, h * 0.27)); // pt
  const lineMm = font * 0.3528 * 1.2;
  const pad = Math.min(1.5, h * 0.06);
  const priceLine = [s.showMrp && d.mrp > 0 ? `MRP ${rupee(d.mrp)}` : "", s.showPrice && d.price > 0 ? `Price ${rupee(d.price)}` : ""]
    .filter(Boolean).join("  ");
  const extras = s.extra.filter((x) => x.trim());
  const text: React.CSSProperties = { fontSize: `${font}pt`, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  if (s.codeType === "qr") {
    const side = Math.min(h - pad * 2, w * 0.45);
    return (
      <div style={{ width: `${w}mm`, height: `${h}mm`, padding: `${pad}mm`, boxSizing: "border-box", display: "flex", gap: `${pad}mm`, alignItems: "center", overflow: "hidden", fontFamily: "Arial, sans-serif", color: "#000" }}>
        <QRCodeSVG value={qrText(d, s) || " "} level="M" marginSize={0} style={{ width: `${side}mm`, height: `${side}mm`, flex: "none" }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {s.showName && <div style={{ ...text, fontWeight: 700, whiteSpace: "normal", maxHeight: `${lineMm * 2}mm` }}>{d.name}</div>}
          {priceLine && <div style={{ ...text, fontWeight: 700 }}>{priceLine}</div>}
          {s.showCodeText && <div style={{ ...text, fontFamily: "monospace" }}>{d.code}</div>}
          {extras.map((x, i) => <div key={i} style={text}>{x}</div>)}
        </div>
      </div>
    );
  }

  const lines = (s.showName ? 1 : 0) + (priceLine ? 1 : 0) + (s.showCodeText ? 1 : 0) + extras.length;
  const barH = Math.max(h * 0.3, h - pad * 2 - lines * lineMm);
  return (
    <div style={{ width: `${w}mm`, height: `${h}mm`, padding: `${pad}mm`, boxSizing: "border-box", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", fontFamily: "Arial, sans-serif", color: "#000", textAlign: "center" }}>
      {s.showName && <div style={{ ...text, fontWeight: 700, maxWidth: "100%" }}>{d.name}</div>}
      <BarcodeSvg code={d.code} heightMm={barH} />
      {s.showCodeText && <div style={{ ...text, fontFamily: "monospace", maxWidth: "100%" }}>{d.code}</div>}
      {priceLine && <div style={{ ...text, fontWeight: 700, maxWidth: "100%" }}>{priceLine}</div>}
      {extras.map((x, i) => <div key={i} style={{ ...text, maxWidth: "100%" }}>{x}</div>)}
    </div>
  );
}

// Pages of stickers. `skip` leaves the first cells of the first sheet empty
// (stickers already used); `onPickStart` makes cells clickable in the preview.
function Pages({ labels, s, size, skip, preview, onPickStart, maxPages }: {
  labels: LabelData[]; s: Settings; size: SheetSize; skip: number;
  preview?: boolean; onPickStart?: (pos: number) => void; maxPages?: number;
}) {
  const page = pageSize(size);
  const perPage = size.cols * size.rows;
  const cells = [...Array(skip).fill(null), ...labels] as (LabelData | null)[];
  const pageCount = Math.max(1, Math.ceil(cells.length / perPage));
  const pages = Array.from({ length: Math.min(pageCount, maxPages ?? pageCount) }, (_, p) => cells.slice(p * perPage, (p + 1) * perPage));
  return (
    <>
      {pages.map((pageCells, p) => (
        <div
          key={p}
          className="label-page"
          style={{ position: "relative", width: `${page.w}mm`, height: `${page.h}mm`, overflow: "hidden", background: "#fff", boxSizing: "border-box", pageBreakAfter: "always", breakAfter: "page" }}
        >
          {Array.from({ length: perPage }, (_, i) => {
            const d = pageCells[i];
            const col = i % size.cols;
            const row = Math.floor(i / size.cols);
            const left = size.left + col * (size.w + size.gapX) + s.offsetX;
            const top = size.top + row * (size.h + size.gapY) + s.offsetY;
            const outline = preview ? { outline: "1px dashed #cbd5e1", outlineOffset: "-1px" } : {};
            const pickable = preview && p === 0 && size.kind === "sheet" && onPickStart;
            return (
              <div
                key={i}
                onClick={pickable ? () => onPickStart(i + 1) : undefined}
                title={pickable ? `Start printing from sticker ${i + 1}` : undefined}
                style={{ position: "absolute", left: `${left}mm`, top: `${top}mm`, width: `${size.w}mm`, height: `${size.h}mm`, cursor: pickable ? "pointer" : undefined, background: preview && !d && p === 0 && i < skip ? "#f1f5f9" : undefined, ...outline }}
              >
                {d && <LabelBox d={d} s={s} w={size.w} h={size.h} />}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function printHtml(html: string, page: { w: number; h: number }) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow!.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Barcode stickers</title><style>
    @page { size: ${page.w}mm ${page.h}mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .label-page:last-child { page-break-after: auto !important; break-after: auto !important; }
  </style></head><body>${html}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 1000);
  }, 300);
}

const GUIDE: { q: string; a: string }[] = [
  {
    q: "What number goes in the barcode?",
    a: "By default the product's Item Code. Keep it short (letters and digits) so it fits small stickers and scans easily. Any code can be typed in the Code box before printing.",
  },
  {
    q: "The product already has a company barcode (fixed barcode)",
    a: "Packed goods usually carry the maker's barcode (EAN, 13 digits, e.g. 8901234567890). You don't need to print a new sticker: type that number in the Code box if you want spare stickers, and keep the same number as the product's code so a scan finds it.",
  },
  {
    q: "One item, different barcodes",
    a: "The same item can come from different suppliers or packs, each with its own printed barcode. The answer is \"alternate barcodes\": one product keeps a list of barcodes, and scanning any of them finds the same item. Until then, print your own Item Code sticker and stick it on — one code per item.",
  },
  {
    q: "Same product, every piece a different number (batteries, inverters, mobiles)",
    a: "This is serial-number (or IMEI) tracking — every piece gets its own number for warranty. Tick \"Serial\" on the row: the stickers count up from the code you enter (BAT0001, BAT0002 …), one per piece. Many QR codes for one product are the same thing — one serial number per QR. Recording each serial at purchase and on the sale bill is a separate step (see below).",
  },
  {
    q: "Batch vs serial",
    a: "Batch = a lot of many pieces made together (same batch no., same expiry — oils, medicines). Serial = one number per piece (batteries). Batches are already tracked in stock; serials need their own entry at purchase.",
  },
  {
    q: "Barcode or QR code?",
    a: "Barcode: for the shop's scanner at billing — put only the code in it. QR code: holds more and any phone can read it — choose \"Code + details\" to include name, MRP, price and your extra lines (shop name, phone, Mfg/Expiry, warranty). For a customer-facing QR, use the extra lines for what the customer should see.",
  },
  {
    q: "What should a sticker show?",
    a: "Usual: product name, MRP (packed goods must show MRP), the code under the bars. Optional: sale price, Mfg / Expiry date, batch no., net quantity, shop name or phone — use the three extra lines.",
  },
  {
    q: "Stickers don't line up with the print",
    a: "Print on plain paper first and hold it over a sticker sheet. Move everything with Offset (mm): + moves right / down. In the print dialog choose Scale 100% / Actual size and Margins: None.",
  },
];

export function BarcodeGeneratorPanel() {
  const { data: products } = useListProducts();
  const [s, setS] = React.useState<Settings>(loadSettings);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [search, setSearch] = React.useState("");
  const [startPos, setStartPos] = React.useState(1);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const nextKey = React.useRef(1);
  const printRoot = React.useRef<HTMLDivElement>(null);
  const previewBox = React.useRef<HTMLDivElement>(null);
  const [previewW, setPreviewW] = React.useState(600);

  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
  }, [s]);
  React.useEffect(() => {
    const el = previewBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewW(el.clientWidth));
    ro.observe(el);
    setPreviewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));
  const size = s.sheetId === "custom" ? { ...s.custom, id: "custom" } : SHEETS.find((x) => x.id === s.sheetId) ?? SHEETS[0];
  const page = pageSize(size);
  const perPage = size.cols * size.rows;
  const skip = size.kind === "sheet" ? Math.min(Math.max(startPos, 1), perPage) - 1 : 0;

  const matches = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !products) return [];
    return products.filter((p) => p.name.toLowerCase().includes(q) || p.itemCode.toLowerCase().includes(q)).slice(0, 8);
  }, [search, products]);

  const addProduct = (p: NonNullable<typeof products>[number]) => {
    setRows((rs) => {
      const existing = rs.find((r) => r.productId === p.id);
      if (existing) return rs.map((r) => (r === existing ? { ...r, qty: r.qty + 1 } : r));
      return [...rs, {
        key: nextKey.current++, productId: p.id, name: p.printName || p.name, mrp: Number(p.mrp) || 0,
        price: Number(p.retailPrice) || 0, stock: Number(p.currentStock) || 0, code: p.itemCode, qty: 1, serial: false,
      }];
    });
    setSearch("");
  };
  const updateRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const labels: LabelData[] = [];
  for (const r of rows) {
    const code = r.code.trim();
    if (!code) continue;
    for (let i = 0; i < r.qty && labels.length < MAX_LABELS; i++) {
      labels.push({ name: r.name, mrp: r.mrp, price: r.price, code: r.serial ? nthSerial(code, i) : code });
    }
  }
  const totalAsked = rows.reduce((n, r) => n + (r.code.trim() ? r.qty : 0), 0);
  const badCodes = s.codeType === "barcode" ? rows.filter((r) => r.code.trim() && !canEncodeCode128(r.code.trim())) : [];
  const printable = labels.length > 0 && badCodes.length === 0;
  const pageCount = Math.ceil((skip + labels.length) / perPage) || 1;

  // Bars too thin for this sticker? Usable width ≈ sticker minus padding.
  const thinCodes = s.codeType === "barcode" && badCodes.length === 0
    ? [...new Set(labels.map((l) => l.code))].filter((c) => (size.w - 3) / (code128Modules(c).length + 20) < MIN_MODULE_MM)
    : [];

  const scale = Math.min(1, previewW / (page.w * MM_PX));

  const print = () => {
    if (!printRoot.current) return;
    printHtml(printRoot.current.innerHTML, page);
  };

  const num = (v: string, min = 0) => Math.max(min, Number(v) || 0);
  const customField = (k: keyof SheetSize, label: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step="0.1" value={String(s.custom[k])} onChange={(e) => set("custom", { ...s.custom, [k]: num(e.target.value, k === "cols" || k === "rows" ? 1 : 0) })} className="h-8" />
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Barcode className="h-5 w-5" /> Sticker size</CardTitle>
          <CardDescription>Choose the sticker sheet or thermal roll you have. Sizes are printed on the sheet packet.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={s.sheetId} onValueChange={(v) => { set("sheetId", v); setStartPos(1); }}>
            <SelectTrigger data-testid="select-sticker-size"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SHEETS.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}
              <SelectItem value="custom">Custom size…</SelectItem>
            </SelectContent>
          </Select>
          {s.sheetId === "custom" && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {customField("w", "Sticker width (mm)")}
              {customField("h", "Sticker height (mm)")}
              {customField("cols", "Across")}
              {customField("rows", "Down")}
              {customField("top", "Top margin (mm)")}
              {customField("left", "Left margin (mm)")}
              {customField("gapX", "Gap across (mm)")}
              {customField("gapY", "Gap down (mm)")}
              <div className="col-span-2 sm:col-span-4 flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" checked={s.custom.kind === "sheet"} onChange={() => set("custom", { ...s.custom, kind: "sheet" })} /> A4 sheet</label>
                <label className="flex items-center gap-2"><input type="radio" checked={s.custom.kind === "roll"} onChange={() => set("custom", { ...s.custom, kind: "roll" })} /> Thermal roll</label>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <div className="space-y-1">
              <Label className="text-xs">Offset right (mm)</Label>
              <Input type="number" step="0.5" value={String(s.offsetX)} onChange={(e) => set("offsetX", Number(e.target.value) || 0)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Offset down (mm)</Label>
              <Input type="number" step="0.5" value={String(s.offsetY)} onChange={(e) => set("offsetY", Number(e.target.value) || 0)} className="h-8" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Products</CardTitle>
          <CardDescription>Search a product, set the code and how many stickers. Tick Serial for a different number on every piece.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Input placeholder="Search product name or item code…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-barcode-product-search" />
            {matches.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover shadow-md divide-y max-h-72 overflow-y-auto">
                {matches.map((p) => (
                  <button key={p.id} type="button" onClick={() => addProduct(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="min-w-0 break-words">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.itemCode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No products added yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {rows.map((r) => (
                <div key={r.key} className="p-3 space-y-2" data-testid={`barcode-row-${r.productId}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm break-words">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.mrp > 0 && <>MRP {rupee(r.mrp)} · </>}Price {rupee(r.price)} · Stock {r.stock}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-1 flex-1 min-w-[10rem]">
                      <Label className="text-xs">{r.serial ? "First serial no." : "Code"}</Label>
                      <Input value={r.code} onChange={(e) => updateRow(r.key, { code: e.target.value })} className="h-8 font-mono" />
                    </div>
                    <div className="space-y-1 w-24">
                      <Label className="text-xs">Stickers</Label>
                      <Input type="number" min={1} value={String(r.qty)} onChange={(e) => updateRow(r.key, { qty: Math.min(MAX_LABELS, num(e.target.value, 1)) })} className="h-8" />
                    </div>
                    {r.stock > 0 && (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => updateRow(r.key, { qty: Math.min(MAX_LABELS, Math.ceil(r.stock)) })}>
                        = Stock
                      </Button>
                    )}
                    <label className="flex items-center gap-2 text-sm h-8">
                      <Checkbox className="!min-h-0" checked={r.serial} onCheckedChange={(v) => updateRow(r.key, { serial: v === true })} /> Serial
                    </label>
                  </div>
                  {r.serial && r.code.trim() && r.qty > 1 && (
                    <p className="text-xs text-muted-foreground font-mono">{nthSerial(r.code.trim(), 0)} → {nthSerial(r.code.trim(), r.qty - 1)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What to print</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant={s.codeType === "barcode" ? "default" : "outline"} size="sm" onClick={() => set("codeType", "barcode")} data-testid="button-code-barcode">
              <Barcode className="h-4 w-4 mr-1" /> Barcode
            </Button>
            <Button variant={s.codeType === "qr" ? "default" : "outline"} size="sm" onClick={() => set("codeType", "qr")} data-testid="button-code-qr">
              <QrCode className="h-4 w-4 mr-1" /> QR code
            </Button>
          </div>
          {s.codeType === "qr" && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={s.qrContent === "code"} onChange={() => set("qrContent", "code")} /> Code only (for billing scanner)</label>
              <label className="flex items-center gap-2"><input type="radio" checked={s.qrContent === "details"} onChange={() => set("qrContent", "details")} /> Code + details (customer's phone)</label>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <label className="flex items-center gap-2"><Checkbox className="!min-h-0" checked={s.showName} onCheckedChange={(v) => set("showName", v === true)} /> Product name</label>
            <label className="flex items-center gap-2"><Checkbox className="!min-h-0" checked={s.showMrp} onCheckedChange={(v) => set("showMrp", v === true)} /> MRP</label>
            <label className="flex items-center gap-2"><Checkbox className="!min-h-0" checked={s.showPrice} onCheckedChange={(v) => set("showPrice", v === true)} /> Sale price</label>
            <label className="flex items-center gap-2"><Checkbox className="!min-h-0" checked={s.showCodeText} onCheckedChange={(v) => set("showCodeText", v === true)} /> Code number</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {s.extra.map((x, i) => (
              <div key={i} className="space-y-1">
                <Label className="text-xs">Extra line {i + 1}</Label>
                <Input
                  value={x}
                  placeholder={["e.g. Mfg: 11/2026", "e.g. Shop name / phone", "e.g. Expiry / warranty"][i]}
                  onChange={(e) => { const extra = [...s.extra] as Settings["extra"]; extra[i] = e.target.value; set("extra", extra); }}
                  className="h-8"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {labels.length} sticker{labels.length === 1 ? "" : "s"} · {pageCount} {size.kind === "roll" ? "row" : "sheet"}{pageCount === 1 ? "" : "s"}
              {size.kind === "sheet" && <> · tap a sticker to start from there (for a half-used sheet)</>}
            </CardDescription>
          </div>
          <Button onClick={print} disabled={!printable} data-testid="button-print-barcodes">
            <Printer className="h-4 w-4 mr-1" /> Print
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {size.kind === "sheet" && (
            <div className="flex items-center gap-2 text-sm">
              <Label className="text-xs">Start at sticker</Label>
              <Input type="number" min={1} max={perPage} value={String(startPos)} onChange={(e) => setStartPos(Math.min(perPage, num(e.target.value, 1)))} className="h-8 w-20" />
              <span className="text-xs text-muted-foreground">of {perPage}</span>
            </div>
          )}
          {totalAsked > MAX_LABELS && <p className="text-sm text-amber-600">Only the first {MAX_LABELS} stickers are printed at a time.</p>}
          {badCodes.length > 0 && (
            <p className="text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              A barcode takes only English letters, digits and symbols. Change the code of: {badCodes.map((r) => r.name).join(", ")} — or print a QR code.
            </p>
          )}
          {thinCodes.length > 0 && (
            <p className="text-sm text-amber-600 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              Too long for this sticker; the bars will be too thin to scan: {thinCodes.slice(0, 5).join(", ")}. Use a shorter code, a wider sticker or a QR code.
            </p>
          )}
          <div ref={previewBox} className="w-full overflow-hidden rounded-md border bg-muted/40 p-2">
            {badCodes.length === 0 && (
              <div style={{ width: page.w * MM_PX * scale, height: page.h * MM_PX * scale * Math.min(pageCount, size.kind === "roll" ? 3 : 1) }}>
                <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${page.w}mm`, display: "flex", flexDirection: "column", gap: 0 }}>
                  <Pages labels={labels} s={s} size={size} skip={skip} preview onPickStart={setStartPos} maxPages={size.kind === "roll" ? 3 : 1} />
                </div>
              </div>
            )}
          </div>
          {pageCount > 1 && size.kind === "sheet" && <p className="text-xs text-muted-foreground">Showing sheet 1 of {pageCount}.</p>}
          {/* Unscaled copy of every page; its HTML is what gets printed. */}
          <div ref={printRoot} aria-hidden style={{ position: "fixed", left: -100000, top: 0 }}>
            {printable && <Pages labels={labels} s={s} size={size} skip={skip} />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => setGuideOpen((v) => !v)}>
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            Barcode guide — fixed barcodes, serial numbers, QR
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${guideOpen ? "rotate-180" : ""}`} />
          </CardTitle>
        </CardHeader>
        {guideOpen && (
          <CardContent className="space-y-3">
            {GUIDE.map((g) => (
              <div key={g.q}>
                <div className="font-medium text-sm">{g.q}</div>
                <p className="text-sm text-muted-foreground">{g.a}</p>
              </div>
            ))}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
