// Coded previews of SHRADHA ERP screens for the marketing site. They follow
// the real app's screens and labels but show sample data only — never a
// customer's — and say so on screen.
import {
  LayoutDashboard, ReceiptText, Package, ShoppingCart, BarChart3, Users, LayoutGrid,
  TrendingUp, AlertTriangle, CheckCircle2, IndianRupee, Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

export function SampleTag({ className }: { className?: string }) {
  return (
    <span className={cn("rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500", className)}>
      Sample data
    </span>
  );
}

// Browser-window frame around a preview.
export function AppFrame({ children, className, url = "app.shradhaerp.com" }: { children: React.ReactNode; className?: string; url?: string }) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.25)] overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
        </span>
        <span className="mx-auto truncate rounded-md bg-white border border-slate-200 px-3 py-0.5 text-[11px] text-slate-500">{url}</span>
        <span className="w-10" />
      </div>
      {children}
    </div>
  );
}

const MONTHS = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
const SALES = [38, 44, 41, 52, 58, 66];
const PURCHASES = [24, 29, 26, 31, 35, 38];

function SalesChart({ height = 120 }: { height?: number }) {
  const w = 300;
  const max = 70;
  const x = (i: number) => 16 + (i * (w - 32)) / (MONTHS.length - 1);
  const y = (v: number) => height - 18 - (v / max) * (height - 30);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area = `${line(SALES)} L${x(SALES.length - 1)},${height - 18} L${x(0)},${height - 18} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full h-auto" role="img" aria-label="Sales and purchases over six months (sample data)">
      <defs>
        <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2563eb" stopOpacity="0.22" />
          <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="16" x2={w - 16} y1={12 + f * (height - 30)} y2={12 + f * (height - 30)} stroke="#e2e8f0" strokeDasharray="3 4" />
      ))}
      <path d={area} fill="url(#sales-fill)" />
      <path d={line(SALES)} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={line(PURCHASES)} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
      {SALES.map((v, i) => i === SALES.length - 1 && <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke="#2563eb" strokeWidth="2.5" />)}
      {MONTHS.map((m, i) => (
        <text key={m} x={x(i)} y={height - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{m}</text>
      ))}
    </svg>
  );
}

function Kpi({ label, value, delta, tone }: { label: string; value: string; delta?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="text-[10.5px] font-medium text-slate-500">{label}</div>
      <div className={cn("mt-1 text-[15px] sm:text-base font-bold tracking-tight", tone)}>{value}</div>
      {delta && <div className="mt-0.5 text-[10px] font-medium text-emerald-600">{delta}</div>}
    </div>
  );
}

const SIDEBAR = [LayoutDashboard, ReceiptText, ShoppingCart, Package, Users, BarChart3];

// Hero: the dashboard an owner lands on.
export function DashboardPreview() {
  return (
    <AppFrame>
      <div className="flex">
        <div className="hidden sm:flex flex-col items-center gap-3 border-r border-slate-100 bg-slate-50/60 px-2.5 py-4" aria-hidden="true">
          {SIDEBAR.map((Icon, i) => (
            <span key={i} className={cn("flex h-8 w-8 items-center justify-center rounded-lg", i === 0 ? "bg-blue-600 text-white" : "text-slate-400")}>
              <Icon className="h-4 w-4" />
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0 p-3 sm:p-4 space-y-3 bg-slate-50/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">Business Overview</div>
              <div className="text-[10.5px] text-slate-500">November 2026</div>
            </div>
            <SampleTag />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Kpi label="Total Sales" value={inr(482600)} delta="+12.4% vs Oct" tone="text-slate-900" />
            <Kpi label="Total Purchases" value={inr(210340)} tone="text-slate-900" />
            <Kpi label="Stock Value" value={inr(615900)} tone="text-blue-700" />
            <Kpi label="To Collect" value={inr(96250)} tone="text-amber-600" />
          </div>
          <div className="grid gap-2 lg:grid-cols-5">
            <div className="lg:col-span-3 rounded-xl border border-slate-100 bg-white p-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-800">Revenue Analytics</div>
                <div className="flex items-center gap-3 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-blue-600" />Sales</span>
                  <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded bg-slate-400" />Purchases</span>
                </div>
              </div>
              <SalesChart />
            </div>
            <div className="lg:col-span-2 rounded-xl border border-slate-100 bg-white p-3">
              <div className="text-xs font-semibold text-slate-800">Recent Transactions</div>
              <ul className="mt-2 divide-y divide-slate-100 text-[11px]">
                {[
                  { t: "INV/26-27/0142", p: "Sai Traders", a: 12450, in: true },
                  { t: "Payment In", p: "Om Distributors", a: 25000, in: true },
                  { t: "PUR/26-27/0088", p: "Patil Industries", a: 48300, in: false },
                  { t: "INV/26-27/0141", p: "Shree Agencies", a: 8900, in: true },
                ].map((r) => (
                  <li key={r.t} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-700">{r.t}</span>
                      <span className="block truncate text-slate-400">{r.p}</span>
                    </span>
                    <span className={cn("shrink-0 font-semibold", r.in ? "text-emerald-600" : "text-slate-700")}>
                      {r.in ? "+" : "−"}{inr(r.a)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AppFrame>
  );
}

// Small floating cards around the hero preview.
export function FloatingInvoiceCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white/95 backdrop-blur p-3 shadow-xl w-56", className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-800">GST Invoice saved</div>
          <div className="text-[10.5px] text-slate-500 truncate">INV/26-27/0143 · {inr(14160)}</div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-slate-500">
        <span>CGST 9%: {inr(1080)}</span>
        <span>SGST 9%: {inr(1080)}</span>
      </div>
    </div>
  );
}

export function FloatingStockCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-slate-200 bg-white/95 backdrop-blur p-3 shadow-xl w-52", className)}>
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><AlertTriangle className="h-4 w-4" /></span>
        <div>
          <div className="text-xs font-semibold text-slate-800">Low stock alert</div>
          <div className="text-[10.5px] text-slate-500">3 items below minimum</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full w-1/4 rounded-full bg-amber-500" /></div>
    </div>
  );
}

/* ---------- Product tour screens ---------- */

function ScreenHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-sm font-bold text-slate-900">{title}</div>
        <div className="text-[11px] text-slate-500">{sub}</div>
      </div>
      <SampleTag />
    </div>
  );
}

function Table({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ("l" | "r")[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-100">
      <table className="w-full text-[11.5px]">
        <thead className="bg-slate-50 text-slate-500">
          <tr>{head.map((h, i) => <th key={h} className={cn("px-3 py-2 font-medium whitespace-nowrap", align?.[i] === "r" ? "text-right" : "text-left")}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((c, ci) => <td key={ci} className={cn("px-3 py-2 whitespace-nowrap text-slate-700", align?.[ci] === "r" ? "text-right" : "")}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const chip = (text: string, tone: "green" | "amber" | "red" | "blue") => (
  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", {
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    blue: "bg-blue-50 text-blue-700",
  }[tone])}>{text}</span>
);

function SalesScreen() {
  const days = [42, 55, 38, 61, 70, 48, 66];
  return (
    <div className="space-y-3">
      <ScreenHeader title="Sales Dashboard" sub="This week" />
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Today" value={inr(38450)} tone="text-slate-900" />
        <Kpi label="This Week" value={inr(212700)} tone="text-slate-900" />
        <Kpi label="Bills" value="64" tone="text-blue-700" />
      </div>
      <div className="rounded-xl border border-slate-100 p-3">
        <div className="text-xs font-semibold text-slate-800 mb-3">Daily sales</div>
        <div className="flex items-end gap-2 h-28" aria-hidden="true">
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className={cn("w-full rounded-t-md", i === 4 ? "bg-blue-600" : "bg-blue-200")} style={{ height: `${d * 1.4}px` }} />
              <span className="text-[9px] text-slate-400">{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
            </div>
          ))}
        </div>
      </div>
      <Table
        head={["Top customers", "Bills", "Amount"]}
        align={["l", "r", "r"]}
        rows={[["Sai Traders", "12", inr(84200)], ["Om Distributors", "9", inr(61850)], ["Shree Agencies", "7", inr(40300)]]}
      />
    </div>
  );
}

function InventoryScreen() {
  return (
    <div className="space-y-3">
      <ScreenHeader title="Inventory" sub="Live stock across all items" />
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Items" value="248" tone="text-slate-900" />
        <Kpi label="Stock Value" value={inr(615900)} tone="text-blue-700" />
        <Kpi label="Low Stock" value="3" tone="text-amber-600" />
      </div>
      <Table
        head={["Item", "Stock", "Rate", "Value", "Status"]}
        align={["l", "r", "r", "r", "l"]}
        rows={[
          ["Engine Oil 20W-40 (1 L)", "320 QTY", inr(285), inr(91200), chip("In stock", "green")],
          ["Gear Oil 90 (5 L)", "18 QTY", inr(1240), inr(22320), chip("Low", "amber")],
          ["Coolant Green (1 L)", "142 QTY", inr(160), inr(22720), chip("In stock", "green")],
          ["Grease MP3 (500 g)", "0 QTY", inr(190), inr(0), chip("Out", "red")],
        ]}
      />
    </div>
  );
}

function InvoiceScreen() {
  return (
    <div className="space-y-3">
      <ScreenHeader title="Tax Invoice" sub="INV/26-27/0143 · 11 Nov 2026" />
      <div className="grid grid-cols-2 gap-3 text-[11px]">
        <div className="rounded-lg bg-slate-50 p-2.5">
          <div className="font-semibold text-slate-800">Your Business Name</div>
          <div className="text-slate-500">GSTIN 27XXXXX0000X1Z5</div>
          <div className="text-slate-500">Maharashtra</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2.5">
          <div className="text-slate-500">Bill to</div>
          <div className="font-semibold text-slate-800">Sai Traders</div>
          <div className="text-slate-500">GSTIN 27YYYYY1111Y1Z2</div>
        </div>
      </div>
      <Table
        head={["Item", "HSN", "Qty", "Rate", "Amount"]}
        align={["l", "l", "r", "r", "r"]}
        rows={[
          ["Engine Oil 20W-40", "27101980", "24", inr(285), inr(6840)],
          ["Coolant Green", "38200000", "30", inr(160), inr(4800)],
        ]}
      />
      <div className="ml-auto w-full sm:w-60 space-y-1 text-[11.5px]">
        {[["Taxable value", inr(11640)], ["CGST 9%", inr(1047.6)], ["SGST 9%", inr(1047.6)]].map(([k, v]) => (
          <div key={k} className="flex justify-between text-slate-600"><span>{k}</span><span>{v}</span></div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-1.5 text-sm font-bold text-slate-900"><span>Grand Total</span><span>{inr(13735)}</span></div>
      </div>
    </div>
  );
}

function PurchaseScreen() {
  return (
    <div className="space-y-3">
      <ScreenHeader title="Purchases" sub="Supplier bills and what is due" />
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="This Month" value={inr(210340)} tone="text-slate-900" />
        <Kpi label="Paid" value={inr(152000)} tone="text-emerald-600" />
        <Kpi label="Due" value={inr(58340)} tone="text-red-600" />
      </div>
      <Table
        head={["Bill", "Supplier", "Amount", "Due"]}
        align={["l", "l", "r", "l"]}
        rows={[
          ["PUR/26-27/0088", "Patil Industries", inr(48300), chip("Due · 12 days", "amber")],
          ["PUR/26-27/0087", "Kulkarni Chemicals", inr(10040), chip("Due · 4 days", "amber")],
          ["PUR/26-27/0086", "Deshmukh Packaging", inr(22800), chip("Clear", "green")],
          ["PUR/26-27/0085", "Patil Industries", inr(36500), chip("Clear", "green")],
        ]}
      />
    </div>
  );
}

function CatalogScreen() {
  const items = [
    { n: "Engine Oil 20W-40", s: "1 L", p: 285 },
    { n: "Gear Oil 90", s: "5 L", p: 1240 },
    { n: "Coolant Green", s: "1 L", p: 160 },
    { n: "Grease MP3", s: "500 g", p: 190 },
    { n: "Brake Fluid DOT 4", s: "250 ml", p: 145 },
    { n: "Chain Lube", s: "150 ml", p: 210 },
  ];
  return (
    <div className="space-y-3">
      <ScreenHeader title="Product Catalog" sub="Share with customers to take orders" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map((it, i) => (
          <div key={it.n} className="rounded-xl border border-slate-100 p-2.5">
            <div className={cn("h-14 rounded-lg flex items-center justify-center", ["bg-blue-50", "bg-indigo-50", "bg-sky-50"][i % 3])}>
              <Package className="h-6 w-6 text-blue-500/70" />
            </div>
            <div className="mt-2 text-[11.5px] font-semibold text-slate-800 truncate">{it.n}</div>
            <div className="flex items-center justify-between text-[10.5px]">
              <span className="text-slate-500">{it.s}</span>
              <span className="font-bold text-slate-900">{inr(it.p)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyticsScreen() {
  return (
    <div className="space-y-3">
      <ScreenHeader title="Reports" sub="Profit & Loss · November 2026" />
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Revenue" value={inr(482600)} tone="text-slate-900" />
        <Kpi label="Expenses" value={inr(41200)} tone="text-slate-900" />
        <Kpi label="Net Profit" value={inr(78940)} tone="text-emerald-600" />
      </div>
      <div className="rounded-xl border border-slate-100 p-3">
        <div className="text-xs font-semibold text-slate-800">Sales vs purchases</div>
        <SalesChart height={110} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {[
          { i: IndianRupee, k: "GST collected", v: inr(73600) },
          { i: Wallet, k: "GST paid (ITC)", v: inr(32100) },
          { i: TrendingUp, k: "Gross margin", v: "21.4%" },
          { i: Users, k: "Active customers", v: "186" },
        ].map((m) => (
          <div key={m.k} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2">
            <m.i className="h-4 w-4 text-blue-600 shrink-0" />
            <span className="text-slate-500 flex-1 min-w-0 truncate">{m.k}</span>
            <span className="font-semibold text-slate-800">{m.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const SHOWCASE = [
  { key: "sales", label: "Sales Dashboard", icon: LayoutDashboard, url: "app.shradhaerp.com/dashboard", Screen: SalesScreen,
    blurb: "See today's, this week's and this month's sales at a glance, with your top customers." },
  { key: "inventory", label: "Inventory", icon: Package, url: "app.shradhaerp.com/inventory", Screen: InventoryScreen,
    blurb: "Live stock for every item, its value, and alerts before you run out." },
  { key: "invoice", label: "GST Invoice", icon: ReceiptText, url: "app.shradhaerp.com/billing", Screen: InvoiceScreen,
    blurb: "GST-ready tax invoices with HSN, CGST/SGST or IGST worked out for you." },
  { key: "purchase", label: "Purchases", icon: ShoppingCart, url: "app.shradhaerp.com/purchases", Screen: PurchaseScreen,
    blurb: "Supplier bills, what's paid and what's due — with how many days each bill has been pending." },
  { key: "catalog", label: "Product Catalog", icon: LayoutGrid, url: "app.shradhaerp.com/catalog", Screen: CatalogScreen,
    blurb: "A clean catalog of your products and prices that customers and salesmen can order from." },
  { key: "analytics", label: "Business Analytics", icon: BarChart3, url: "app.shradhaerp.com/reports", Screen: AnalyticsScreen,
    blurb: "Profit & loss, GST and sales reports, ready whenever you need them." },
] as const;
