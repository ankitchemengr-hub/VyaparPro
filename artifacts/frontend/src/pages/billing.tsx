import { Fragment, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListProducts,
  useCreateInvoice,
  useUpdateInvoice,
  useGetInvoice,
  useListEntities,
  useGetEntity,
  useGetPrintSettings,
  useLookupEntityByMobile,
  useCreateEntity,
  useUpdateEntity,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getLookupEntityByMobileQueryKey,
  getListEntitiesQueryKey,
} from "@workspace/api-client-react";
import { InvoiceTemplateRenderer } from "@/components/invoice-templates/InvoiceTemplateRenderer";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Trash2, Printer, Save, CheckCircle, Loader2, User, Phone, MapPin,
  ArrowLeft, ArrowRight, Search, Plus, Minus, Pencil, UserPlus, Share2, History, AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { playWarningBeep } from "@/lib/notification-sound";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { shareInvoiceImage } from "@/lib/share-invoice";
import { usePrintTitle } from "@/lib/print-with-title";
import { useRoleFeature, FEATURE_BILLING_RATE_EDIT } from "@/lib/permissions";

type QtyMode = "unit" | "box";

const GST_INVOICE_TYPES = new Set(["gst", "proforma_invoice"]);
function isGstInvoiceType(t: string) { return GST_INVOICE_TYPES.has(t); }

// Retail customers always get retailPrice, on both GST and Non-GST invoices.
// The product's dedicated "Non-GST Price" field is a wholesale-only cash-bill
// rate — it only kicks in for wholesale customers on a Non-GST invoice.
//
// "mrp_based" products (an additive Pricing Mode, opt-in per product) skip
// all of the above and derive the rate live from mrp * (1 - discount%),
// picking the discount column for this customer tier / GST status. Nothing
// here changes for "direct" (the default, and every pre-existing product) —
// that branch is untouched, byte-for-byte the same logic as before this mode
// existed. The GST/tax engine itself is never touched either way: this only
// changes what `rate` gets handed to it, exactly like a Direct Rate product's
// flat retailPrice/wholesalePrice always has.
function getBaseRate(p: any, customer: any, invoiceType: string): number {
  const isWholesale = customer?.pricingTier === "wholesale";
  const isGst = isGstInvoiceType(invoiceType);

  if (p.pricingMode === "mrp_based") {
    const mrp = Number(p.mrp) || 0;
    if (mrp > 0) {
      const discountPct = Number(
        isWholesale
          ? (isGst ? p.wholesaleDiscountPct : p.wholesaleNonGstDiscountPct)
          : (isGst ? p.retailDiscountPct : p.retailNonGstDiscountPct)
      ) || 0;
      const rate = mrp * (1 - discountPct / 100);
      if (rate > 0) return rate;
    }
    // Misconfigured mrp_based product (no mrp yet) — fall through to the
    // direct-rate fields below rather than billing at ₹0.
  }

  const wholesalePrice = Number(p.wholesalePrice) || 0;
  const retailPrice = Number(p.retailPrice) || 0;
  if (!isWholesale) return retailPrice || wholesalePrice;
  const nonGstPrice = Number((p as any).nonGstPrice) || 0;
  if (!isGst && nonGstPrice > 0) return nonGstPrice;
  return wholesalePrice || retailPrice;
}

const DOC_TYPE_OPTIONS = [
  { value: "invoice", label: "Invoice" },
  { value: "quotation", label: "Quotation" },
  { value: "proforma_invoice", label: "Proforma Invoice" },
  { value: "bill_of_supply", label: "Bill of Supply" },
  { value: "delivery_challan", label: "Delivery Challan" },
  { value: "sale_order", label: "Sale Order" },
];

type BillingItem = {
  productId: number;
  name: string;
  unit: string;
  qty: number;
  qtyMode: QtyMode;
  unitsPerBox: number;
  rate: number;
  mrp: number;
  taxPct: number;
  discountPct: number;
  discountAmt: number;
  amount: number;
  litersPerBox: number;
  packagingUnit: string;
  // Free-text note for this line item (size/model/serial no., etc.) —
  // printed on the invoice under the item name, separate from the
  // product's own catalog name/description.
  description: string;
  // Set when the rate was typed by hand, picked from price history, or loaded
  // from a saved invoice — such a rate is kept when the product
  // list refreshes. Unset = straight from the price list, so it follows rate
  // updates made elsewhere (Purchases, Price List, Inventory).
  rateEdited?: boolean;
  // Cost recorded on the saved invoice line (purchase rate / BOM cost at the
  // time of that sale). When editing an old bill, the at/below-cost check
  // compares against this — not today's cost, which may have gone up since.
  savedCost?: { cost: number; source: CostSource; gstPct: number } | null;
};

function resolvePack(p: any): number {
  const u = Number(p?.unitsPerBox ?? 0);
  if (u > 0) return u;
  const l = Number(p?.litersPerBox ?? 0);
  return l > 0 ? l : 0;
}

function billedUnits(i: { qty: number; qtyMode: QtyMode; unitsPerBox: number }): number {
  if (i.qtyMode === "box" && i.unitsPerBox > 0) return i.qty * i.unitsPerBox;
  return i.qty;
}

function lineLiters(i: { qty: number; qtyMode: QtyMode; unit: string; unitsPerBox: number; litersPerBox: number }): number {
  const units = billedUnits(i);
  if (i.litersPerBox > 0) return units * i.litersPerBox;
  const u = String(i.unit ?? "").toLowerCase();
  if (["ltr", "l", "liter", "litre", "liters", "litres"].includes(u)) return units;
  return 0;
}

const fmtHistDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
};

type SaleHistory = {
  forCustomer: boolean;
  rows: { date: string; invoiceNo: string; party: string | null; qty: number; unit: string | null; rate: number }[];
};

// Opens right under a line while its Rate field has focus: what THIS customer
// paid for this item on their last 3 bills (date, qty, rate). Only this
// customer's own rates — never other customers' or purchase prices. Read-only
// and never focusable, so Enter keeps moving through the line exactly as
// before. Blinks twice when it appears so it gets noticed.
function RateHistoryPanel({ productId, customerId, customerName, excludeInvoiceId, unit }: {
  productId: number;
  customerId: number | null;
  customerName: string | null;
  excludeInvoiceId: number | null;
  unit: string;
}) {
  const { data, isLoading, isError } = useQuery<SaleHistory>({
    queryKey: ["/api/products/sale-history", productId, customerId ?? 0, excludeInvoiceId ?? 0],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (customerId) qs.set("customerId", String(customerId));
      if (excludeInvoiceId) qs.set("excludeInvoiceId", String(excludeInvoiceId));
      const r = await fetch(`/api/products/${productId}/sale-history?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load sale history");
      return r.json();
    },
    staleTime: 60_000,
    enabled: !!customerId,
  });

  const title = !customerId
    ? "Past rates"
    : data && data.rows.length > 0
      ? `${customerName ?? "This customer"} — last ${data.rows.length === 1 ? "bill" : `${data.rows.length} bills`}`
      : `${customerName ?? "This customer"} — past rates`;

  return (
    <div
      className="rate-hist-panel rounded-lg border-2 border-primary/50 bg-primary/5 px-3 py-2 text-left max-w-md ml-auto"
      // Never steal focus from the Rate field if it's clicked.
      onMouseDown={(e) => e.preventDefault()}
      data-testid={`rate-history-${productId}`}
    >
      <style>{RATE_HIST_CSS}</style>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-primary mb-1">
        <History className="w-3.5 h-3.5" /> {title}
      </div>
      {!customerId ? (
        <div className="text-xs text-muted-foreground py-1">Select the customer to see their past rates.</div>
      ) : isLoading ? (
        <div className="text-xs text-muted-foreground py-1">Loading…</div>
      ) : isError ? (
        <div className="text-xs text-muted-foreground py-1">Couldn't load history.</div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-xs text-muted-foreground py-1">First time for this customer — no previous rate.</div>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className={i === 0 ? "font-semibold" : "text-muted-foreground"}>
                <td className="py-0.5 pr-3 whitespace-nowrap">{fmtHistDate(r.date)}</td>
                <td className="py-0.5 pr-3 text-right whitespace-nowrap">{r.qty.toLocaleString("en-IN")} {r.unit ?? unit}</td>
                <td className="py-0.5 text-right whitespace-nowrap text-foreground">₹{r.rate.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const RATE_HIST_CSS = `
.rate-hist-panel { animation: rateHistIn .18s ease-out, rateHistBlink .55s ease-in-out .2s 2; }
@keyframes rateHistIn { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
@keyframes rateHistBlink { 0%,100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0) } 50% { box-shadow: 0 0 0 5px hsl(var(--primary) / .35) } }
@media (prefers-reduced-motion: reduce) { .rate-hist-panel { animation: none } }
`;

// Red line under a Rate field whose net rate is at/below the product's
// purchase price — the always-visible half of the cost warning (the beep +
// toast fire once on blur, and the popup on save).
type CostSource = "mfg" | "purchase" | "saved";
// `cost` already includes the purchase GST when the invoice is non-GST
// (`withGst`), since that GST can't be claimed back on a non-GST sale.
type CostWarning = { kind: "below" | "equal"; cost: number; net: number; source: CostSource; withGst?: boolean };
const COST_LABEL: Record<CostSource, string> = { mfg: "Mfg cost", purchase: "Purchase rate", saved: "Cost at sale time" };

// Amber line under a Rate field a non-admin set below the price-list rate.
function ListRateHint({ w, testId }: { w: { list: number; net: number } | null; testId: string }) {
  if (!w) return null;
  return (
    <div className="text-[10px] leading-tight text-amber-700 dark:text-amber-400 mt-0.5" data-testid={testId}>
      Below list ₹{w.list.toLocaleString()}
    </div>
  );
}

function CostWarningHint({ w, testId }: { w: CostWarning | null; testId: string }) {
  if (!w) return null;
  const label = `${w.source === "mfg" ? "Mfg cost" : w.source === "saved" ? "Cost" : "Purchase"}${w.withGst ? " + GST" : ""}`;
  return (
    <div className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] font-semibold leading-tight text-red-600" data-testid={testId}>
      <AlertTriangle className="w-3 h-3 shrink-0" />
      {w.kind === "below"
        ? `Loss! ${label} ₹${w.cost.toLocaleString()}`
        : `= ${label} ₹${w.cost.toLocaleString()}`}
    </div>
  );
}

// Stock on hand beside each product in the billing search dropdown, so the
// biller sees how many are left before adding the line. Red at zero or
// negative, amber at/below the product's low-stock threshold.
function StockPill({ product, active }: { product: { currentStock: number; unit: string; minStockThreshold?: number | null }; active: boolean }) {
  const stock = Number(product.currentStock) || 0;
  const min = product.minStockThreshold != null ? Number(product.minStockThreshold) : null;
  const tone = stock <= 0
    ? "bg-red-600 text-white"
    : min != null && stock <= min
      ? "bg-amber-500 text-white"
      : active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300";
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-semibold tabular-nums whitespace-nowrap ${tone}`} data-testid={`stock-pill-${(product as any).id}`}>
      Stock: {stock.toLocaleString()} {product.unit}
    </span>
  );
}

function parseSearch(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    cart: params.get("cart"),
    customer: params.get("customer"),
    edit: params.get("edit"),
    invoiceType: params.get("invoiceType"),
  };
}

export default function Billing() {
  const [, setLocation] = useLocation();
  const { user, hasRole } = useAuth();
  const allowsFeature = useRoleFeature();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = parseSearch(window.location.search);
  const editId = params.edit ? Number(params.edit) : null;
  const isEditMode = editId !== null && !Number.isNaN(editId);

  // ── All useState hooks ──
  const [customer, setCustomer] = useState<any>(() => {
    try { return params.customer ? JSON.parse(decodeURIComponent(params.customer)) : null; } catch { return null; }
  });
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showCustomerEdit, setShowCustomerEdit] = useState(false);
  const [docType, setDocType] = useState<string>("invoice");
  const [invoiceSubtype, setInvoiceSubtype] = useState<"gst" | "non_gst">(
    () => (params.invoiceType === "gst" ? "gst" : "non_gst")
  );
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [placeOfSupply, setPlaceOfSupply] = useState(customer?.state || "Maharashtra");
  const [items, setItems] = useState<BillingItem[]>([]);
  const [freight, setFreight] = useState(0);
  // Flat discount entered after Grand Total — subtracted from it, and
  // mirrored server-side as a reporting-only "Discount" expense (no Cash
  // Book account is touched, since no real cash left the business).
  const [billDiscount, setBillDiscount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [salesmanId, setSalesmanId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  // Which product row in the search dropdown is keyboard-highlighted; Enter
  // adds it. Reset to the top whenever the query or open state changes.
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const [savedInvoice, setSavedInvoice] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const savedSheetRef = useRef<HTMLDivElement>(null);
  const [prefilled, setPrefilled] = useState(false);
  // The invoice-type + customer-pricing-tier combination the line rates were
  // last priced for. The price-list rate sync below reprices only when this
  // actually changes (the user toggles GST/Non-GST or picks a customer on a
  // different tier). Prefill sets it to the values it loads, so
  // loading a saved invoice never reprices the rates the user saved.
  const pricingKeyRef = useRef<string | null>(null);
  // Keyboard shortcuts call through this ref instead of `handleSave` directly
  // — `handleSave` isn't defined until after the early-return role guards
  // below, and hooks (this effect included) must run unconditionally before
  // those guards, so the effect can't close over it directly.
  const handleSaveRef = useRef<() => void>(() => {});
  // Which line's Rate field has focus — that line shows the customer's past
  // rates for the item right underneath it.
  const [rateFocusIdx, setRateFocusIdx] = useState<number | null>(null);
  // "Rate at/below purchase price" warning popup shown on save, and the last
  // net rate each row was already warned about (so leaving the Rate field
  // again without changing it doesn't beep a second time).
  const [costAlertOpen, setCostAlertOpen] = useState(false);
  const warnedRatesRef = useRef<Map<number, string>>(new Map());
  // Same idea for the below-price-list warning (keyed by product → net rate).
  const warnedListRef = useRef<Map<number, number>>(new Map());
  // Phone flow: below the md breakpoint the page is split into Customer →
  // Items → Review steps instead of one long scroll. Desktop ignores this and
  // shows everything at once. Arriving with a cart (from Catalog) or editing a
  // saved bill already has the customer, so it opens straight on Items.
  const [mobileStep, setMobileStep] = useState<1 | 2 | 3>(() => (params.cart || isEditMode ? 2 : 1));
  // Which phone item card is expanded to show Rate / Disc / Tax / description.
  const [openItemIdx, setOpenItemIdx] = useState<number | null>(null);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  const [showGstBreakup, setShowGstBreakup] = useState(false);

  // ── All data hooks ──
  // Always refetch on open (not served from a stale cache) so a rate updated
  // a moment ago on Purchases / Price List / Inventory is what gets billed.
  const { data: products } = useListProducts({ forSale: true }, { query: { refetchOnMount: "always" } as any });
  const { data: salesmanEntities } = useListEntities({ type: "salesman" } as any);
  const { data: existingInvoice } = useGetInvoice(editId as number, { query: { enabled: isEditMode } as any });
  // Invoices don't store the customer's pricing tier, only a name/GSTIN
  // snapshot — fetched separately so editing an invoice for a wholesale
  // customer doesn't silently default the tier (and rate) back to retail.
  const { data: existingCustomerEntity } = useGetEntity(existingInvoice?.customerId as number, {
    query: { enabled: isEditMode && !!existingInvoice?.customerId } as any,
  });

  // Print / "Save as PDF" names the file after document.title — pin it to the
  // invoice no. whenever a printable invoice is on screen (just-saved screen,
  // or the edit view's Print button).
  usePrintTitle(
    savedInvoice ? String(savedInvoice.invoiceNo)
      : existingInvoice ? String(existingInvoice.invoiceNo)
      : null,
  );
  const { data: printSettingsData } = useGetPrintSettings();
  const logo = useCompanyLogo();
  const printSettings = { ...(printSettingsData ?? FALLBACK_PRINT_SETTINGS), logo };
  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();

  const invoiceType = docType === "invoice" ? invoiceSubtype : docType;

  const printMaps = {
    lpbByProduct: new Map<number, number>((products ?? []).map((p: any) => [p.id, Number(p.litersPerBox ?? 0) || 0])),
    upbByProduct: new Map<number, number>((products ?? []).map((p: any) => [p.id, Number(p.unitsPerBox ?? 0) || 0])),
  };

  // ── All useEffect hooks ──
  useEffect(() => {
    if (customer?.assignedSalesmanId) {
      setSalesmanId(Number(customer.assignedSalesmanId));
    } else {
      setSalesmanId(null);
    }
  }, [customer?.id]);

  // When the product list itself refreshes (e.g. a sale rate was just
  // updated after a purchase), lines whose rate came straight from the price
  // list follow the new rate. Hand-typed rates and rates loaded from a saved
  // invoice (rateEdited) are never touched.
  useEffect(() => {
    if (!products || items.length === 0) return;
    setItems((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.rateEdited) return item;
        const p = products.find((x: any) => x.id === item.productId);
        if (!p) return item;
        const newRate = getBaseRate(p, customer, invoiceType);
        if (Math.abs(newRate - item.rate) < 0.0001) return item;
        changed = true;
        const amount = Math.round(billedUnits(item) * newRate * (1 + item.taxPct / 100) * 100) / 100;
        return { ...item, rate: newRate, mrp: Number(p.mrp ?? item.mrp), amount };
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // Deliberately NOT keyed on `products` (that's the effect above this one, which only
  // touches price-list rates): the product list also carries stock, so it
  // refetches whenever stock moved elsewhere — repricing every line on that
  // used to stomp saved rates a moment after an edit form opened and wipe
  // hand-typed rates on a new invoice when the window regained focus.
  const pricingKey = `${invoiceType}|${customer?.pricingTier ?? ""}`;
  useEffect(() => {
  const prevKey = pricingKeyRef.current;
  pricingKeyRef.current = pricingKey;
  if (prevKey === null || prevKey === pricingKey) return;
  if (!products || items.length === 0) return;
  setItems((prev) => prev.map((item) => {
    const p = products.find((x: any) => x.id === item.productId);
    if (!p) return item;
    const newRate = getBaseRate(p, customer, invoiceType);
    const taxPct = isGstInvoiceType(invoiceType) ? (Number(p.taxRate) || 18) : 0;
    const amount = Math.round(billedUnits(item) * newRate * (1 + taxPct / 100) * 100) / 100;
    return { ...item, rate: newRate, taxPct, amount };
  }));
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [pricingKey]);

  useEffect(() => {
    if (!isEditMode || !existingInvoice || prefilled) return;
    // Wait for the customer's real pricing tier before prefilling — otherwise
    // it would default to "retail" and, combined with the rate-sync effect
    // above, silently reprice a wholesale customer's items if the invoice
    // type is later toggled while editing.
    if (existingInvoice.customerId && !existingCustomerEntity) return;
    // Products give each line its box size / litres — wait for them too.
    if (!products) return;
    const et = existingInvoice.invoiceType as string;
    if (et === "gst" || et === "non_gst") { setDocType("invoice"); setInvoiceSubtype(et); }
    else { setDocType(et); }
    setInvoiceDate(String(existingInvoice.invoiceDate).slice(0, 10));
    setPlaceOfSupply(existingInvoice.placeOfSupply || "Maharashtra");
    setFreight(Number(existingInvoice.freight ?? 0));
    setBillDiscount(Number(existingInvoice.billDiscount ?? 0));
    if (existingInvoice.customerId || existingInvoice.customerName) {
      setCustomer({
        id: existingInvoice.customerId, name: existingInvoice.customerName,
        gstin: existingInvoice.customerGstin, address: existingInvoice.billingAddress,
        state: existingInvoice.placeOfSupply,
        pricingTier: existingCustomerEntity?.pricingTier ?? "retail",
        outstandingBalance: 0,
      });
    }
    // Mark the saved type/tier as already priced so the sync above leaves the
    // saved rates alone.
    const prefillTier = (existingInvoice.customerId || existingInvoice.customerName)
      ? (existingCustomerEntity?.pricingTier ?? "retail")
      : customer?.pricingTier;
    pricingKeyRef.current = `${et}|${prefillTier ?? ""}`;
    setItems((existingInvoice.items ?? []).map((it: any) => {
      const prod = (products ?? []).find((x: any) => x.id === it.productId);
      return {
        productId: it.productId, name: it.productName, unit: it.unit,
        qty: Number(it.qty), qtyMode: "unit" as QtyMode, unitsPerBox: resolvePack(prod),
        rate: Number(it.rate), mrp: Number(it.mrp), taxPct: Number(it.taxPct),
        // Editing a saved invoice — keep its recorded rates; the history
        // auto-fill must not silently reprice existing lines.
        rateEdited: true,
        savedCost: it.costPrice != null && Number(it.costPrice) > 0
          ? { cost: Number(it.costPrice), source: "saved" as CostSource, gstPct: Number(it.costGstPct ?? 0) || 0 }
          : null,
        discountPct: Number(it.discountPct), discountAmt: Number(it.discountAmt),
        amount: Number(it.amount), litersPerBox: Number(prod?.litersPerBox ?? 0) || 0,
        packagingUnit: prod?.packagingUnit?.trim() || "Box",
        description: it.description ?? "",
      };
    }));
    setPrefilled(true);
  }, [isEditMode, existingInvoice, existingCustomerEntity, prefilled, products]);

  useEffect(() => {
    if (!params.cart || !products) return;
    try {
      const cartItems: { productId: number; qty: number }[] = JSON.parse(decodeURIComponent(params.cart));
      const billing: BillingItem[] = cartItems.map(({ productId, qty }) => {
        const p = products.find((x) => x.id === productId);
        if (!p) return null;
        const rate = getBaseRate(p, customer, invoiceType);
        const taxPct = isGstInvoiceType(invoiceType) ? (p.taxRate ?? 18) : 0;
        const amount = qty * Number(rate) * (1 + taxPct / 100);
        return {
          productId: p.id, name: p.name, unit: p.unit ?? "QTY", qty,
          qtyMode: "unit" as QtyMode, unitsPerBox: resolvePack(p),
          rate: Number(rate ?? 0), mrp: Number(p.mrp ?? 0),
          taxPct: isGstInvoiceType(invoiceType) ? (p.taxRate ?? 18) : 0,
          discountPct: 0, discountAmt: 0,
          amount: Math.round(amount * 100) / 100,
          litersPerBox: Number((p as any).litersPerBox ?? 0) || 0,
          packagingUnit: (p as any).packagingUnit?.trim() || "Box",
          description: "",
        } as BillingItem;
      }).filter(Boolean) as BillingItem[];
      setItems(billing);
    } catch { /* ignore */ }
  }, [products, params.cart]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const focusProductSearch = () => {
    setSearchOpen(true);
    searchRef.current?.querySelector("input")?.focus();
  };

  // Desktop-only keyboard shortcuts (Ctrl/Cmd+S save; "/" or Alt+N focus the
  // product search; Alt+C change customer; Esc close the search) — gated on
  // the same md breakpoint the rest of this page uses, so touch devices never
  // see a "/" keypress hijacked from a text field.
  useEffect(() => {
    const isDesktop = () => window.matchMedia("(min-width: 768px)").matches;
    const handler = (e: KeyboardEvent) => {
      if (!isDesktop()) return;
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveRef.current();
        return;
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") {
        e.preventDefault();
        focusProductSearch();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyC") {
        e.preventDefault();
        setShowCustomerSearch(true);
        return;
      }
      if (e.key === "/" && !isEditable) {
        e.preventDefault();
        focusProductSearch();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Keep the dropdown highlight on the first match as the query changes.
  useEffect(() => { setSearchActiveIdx(0); }, [productSearch, searchOpen]);

  // Keep the keyboard-highlighted product row scrolled into view.
  useEffect(() => {
    if (!searchOpen) return;
    searchRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [searchActiveIdx, searchOpen]);

  // ── Guard — after ALL hooks ──
  // Store can create invoices directly (no catalog/order detour), same as
  // admin, but editing an existing invoice by id stays admin-only — store
  // has no ownership check here and could otherwise open/edit any invoice.
  if (!hasRole(["admin", "store"])) {
    setLocation("/");
    return null;
  }
  if (isEditMode && !hasRole(["admin"])) {
    setLocation("/invoices");
    return null;
  }

  // ── Derived state ──
  const filteredProducts = productSearch.trim()
    ? (products ?? []).filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase().trim())).slice(0, 12)
    : (products ?? []).slice(0, 12);

  const updateItem = (idx: number, field: keyof BillingItem, value: any, extra?: Partial<BillingItem>) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value, ...extra };
      const base = billedUnits(item) * item.rate;
      const discAmt = item.discountAmt > 0 ? item.discountAmt : (base * item.discountPct / 100);
      const taxable = base - discAmt;
      const taxAmt = isGstInvoiceType(invoiceType) ? (taxable * item.taxPct / 100) : 0;
      item.amount = Math.round((taxable + taxAmt) * 100) / 100;
      updated[idx] = item;
      return updated;
    });
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setOpenItemIdx(null);
  };

  // Returns the row index the product landed on (existing row if it was
  // already in the cart, otherwise the newly appended row) — callers use
  // this to move keyboard focus straight into that row's Qty field.
  const addProduct = (p: any): number => {
    const existing = items.findIndex((i) => i.productId === p.id);
    if (existing >= 0) {
      updateItem(existing, "qty", items[existing].qty + 1);
      setProductSearch("");
      setSearchOpen(false);
      return existing;
    }
    const rate = getBaseRate(p, customer, invoiceType);
    const taxPct = isGstInvoiceType(invoiceType) ? (Number(p.taxRate) || 18) : 0;
    const amount = Number(rate ?? 0) * (1 + taxPct / 100);
    const newIdx = items.length;
    setItems((prev) => [...prev, {
      productId: p.id, name: p.name, unit: p.unit ?? "QTY", qty: 1,
      qtyMode: "unit" as QtyMode, unitsPerBox: resolvePack(p),
      rate: Number(rate ?? 0), mrp: Number(p.mrp ?? 0), taxPct,
      discountPct: 0, discountAmt: 0,
      amount: Math.round(amount * 100) / 100,
      litersPerBox: Number((p as any).litersPerBox ?? 0) || 0,
      packagingUnit: (p as any).packagingUnit?.trim() || "Box",
      description: "",
    }]);
    setProductSearch("");
    setSearchOpen(false);
    return newIdx;
  };

  // After picking a product (Enter or click), jump straight into that row's
  // Qty field so the whole add-item flow stays keyboard-only: search → pick
  // → qty → (Enter) rate → (Enter) back to search for the next product.
  const addProductAndFocusQty = (p: any) => {
    const idx = addProduct(p);
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(`[data-testid="input-qty-${idx}"]`);
      if (el) { el.focus(); el.select(); }
    });
  };

  // Enter in a line-item field jumps to the next editable field (qty → rate →
  // tax → disc), then the next row, then back to the product search — so a
  // whole invoice can be typed without touching the mouse. Alt+Delete removes
  // the row the cursor is in.
  const lineItemKeyDown = (e: React.KeyboardEvent, rowIdx: number, field: "qty" | "rate" | "tax" | "discount") => {
    if (e.altKey && e.key === "Delete") {
      e.preventDefault();
      removeItem(rowIdx);
      requestAnimationFrame(() => {
        const prev = document.querySelector<HTMLInputElement>(`[data-testid="input-qty-${Math.max(0, rowIdx - 1)}"]`);
        if (rowIdx > 0 && prev) prev.focus();
        else focusProductSearch();
      });
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const fields: Array<"qty" | "rate" | "tax" | "discount"> = ["qty", "rate", "tax", "discount"];
    for (let r = rowIdx; r < items.length; r++) {
      for (const f of fields) {
        if (r === rowIdx && fields.indexOf(f) <= fields.indexOf(field)) continue;
        const el = document.querySelector<HTMLInputElement>(`[data-testid="input-${f}-${r}"]`);
        if (el && !el.disabled) { el.focus(); el.select(); return; }
      }
    }
    focusProductSearch();
  };

  const subtotal = items.reduce((s, i) => {
    const base = billedUnits(i) * i.rate;
    const disc = i.discountAmt > 0 ? i.discountAmt : (base * i.discountPct / 100);
    return s + (base - disc);
  }, 0);
  const totalDiscount = items.reduce((s, i) => {
    const base = billedUnits(i) * i.rate;
    return s + (i.discountAmt > 0 ? i.discountAmt : (base * i.discountPct / 100));
  }, 0);
  const totalTax = isGstInvoiceType(invoiceType)
    ? items.reduce((s, i) => {
        const base = billedUnits(i) * i.rate;
        const disc = i.discountAmt > 0 ? i.discountAmt : (base * i.discountPct / 100);
        return s + ((base - disc) * i.taxPct / 100);
      }, 0) : 0;
  const isInterstate = placeOfSupply !== "Maharashtra";
  const cgst = invoiceType === "gst" && !isInterstate ? totalTax / 2 : 0;
  const sgst = invoiceType === "gst" && !isInterstate ? totalTax / 2 : 0;
  const igst = invoiceType === "gst" && isInterstate ? totalTax : 0;
  const preDiscountTotal = subtotal + totalTax + freight;
  // Clamped so a stray large entry can't send the customer's payable below
  // zero — the input itself still shows whatever the biller typed.
  const effectiveBillDiscount = Math.max(0, Math.min(billDiscount, preDiscountTotal));
  const grandTotal = preDiscountTotal - effectiveBillDiscount;
  const roundOff = Math.round(grandTotal) - grandTotal;
  const finalTotal = Math.round(grandTotal);

  // ── Selling below / at cost warning ──
  // Cost = live BOM (manufacturing) cost for products we make, else the
  // purchasePrice — the same figure the server snapshots as the line's
  // cost_price for profit reports (lib/bom-cost.ts effectiveUnitCost). Uses
  // the net rate per unit after the line discount, before GST (costs are pre-tax).
  const costByProduct = new Map<number, { cost: number; source: CostSource; gstPct: number }>((products ?? []).map((p: any) => {
    const mfg = Number(p.manufacturingCost) || 0;
    const gstPct = Number(p.purchaseGstPct) || 0;
    return [p.id, mfg > 0 ? { cost: mfg, source: "mfg", gstPct } : { cost: Number(p.purchasePrice) || 0, source: "purchase", gstPct }];
  }));
  const netUnitRate = (i: BillingItem) => {
    const units = billedUnits(i);
    if (!(units > 0)) return i.rate * (1 - i.discountPct / 100);
    const base = units * i.rate;
    const disc = i.discountAmt > 0 ? i.discountAmt : (base * i.discountPct / 100);
    return (base - disc) / units;
  };
  const costWarning = (i: BillingItem): CostWarning | null => {
    // A line from a saved invoice is judged by the cost at the time of that
    // sale; only new lines use today's purchase / BOM cost.
    const c = i.savedCost !== undefined ? i.savedCost : costByProduct.get(i.productId);
    if (!c || !(c.cost > 0)) return null; // no cost recorded — nothing to compare
    // Non-GST bill: the GST paid when buying this material can't be recovered,
    // so it is part of the cost (basic rate + its GST %). GST bill: basic rate.
    const withGst = !isGstInvoiceType(invoiceType) && c.gstPct > 0;
    const cost = Math.round(c.cost * (withGst ? 1 + c.gstPct / 100 : 1) * 100) / 100;
    const source = c.source;
    const net = Math.round(netUnitRate(i) * 100) / 100;
    if (net < cost - 0.005) return { kind: "below", cost, net, source, withGst };
    if (Math.abs(net - cost) <= 0.005) return { kind: "equal", cost, net, source, withGst };
    return null;
  };
  const costWarnings = items
    .map((item, idx) => ({ item, idx, w: costWarning(item) }))
    .filter((x): x is { item: BillingItem; idx: number; w: CostWarning } => x.w !== null);

  // Who may type in the Rate field: admin always; a store user only when the
  // admin turned on "Can change rate while billing" in User Accounts.
  const isAdminUser = user?.role === "admin";
  // Store user: allowed per user (User Accounts switch) or for the whole
  // store role (Settings > Permissions "Billing Rate Edit").
  const canEditRate = isAdminUser || (user?.role === "store" && ((user as any)?.canEditRate === true || allowsFeature(FEATURE_BILLING_RATE_EDIT)));
  // Non-admin billing a line below the price-list rate: beep on blur, ask on
  // save (never blocks), and the server marks the invoice "Below rate" for
  // the admin. Admin's own rates aren't second-guessed.
  const listRateWarning = (i: BillingItem): { list: number; net: number } | null => {
    if (isAdminUser) return null;
    const p = (products ?? []).find((x: any) => x.id === i.productId);
    if (!p) return null;
    const list = Math.round(getBaseRate(p, customer, invoiceType) * 100) / 100;
    const net = Math.round(netUnitRate(i) * 100) / 100;
    return list > 0 && net < list - 0.005 ? { list, net } : null;
  };
  const listWarnings = items
    .map((item, idx) => ({ item, idx, w: listRateWarning(item) }))
    .filter((x): x is { item: BillingItem; idx: number; w: { list: number; net: number } } => x.w !== null);

  // Side notification + beep the moment a rate (or discount) leaves the line
  // at/below cost — called when the field loses focus, so it fires once the
  // biller has finished typing rather than on every keystroke.
  const checkCostOnBlur = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    const lw = listRateWarning(item);
    if (lw && warnedListRef.current.get(item.productId) !== lw.net) {
      warnedListRef.current.set(item.productId, lw.net);
      playWarningBeep();
      toast({
        title: "⚠ Rate is BELOW the price list",
        description: `${item.name}: ₹${lw.net.toLocaleString()} — price list ₹${lw.list.toLocaleString()}. This bill will be marked for the admin.`,
        variant: "destructive",
      });
    } else if (!lw) {
      warnedListRef.current.delete(item.productId);
    }
    const w = costWarning(item);
    const key = w ? `${w.kind}:${w.net}` : "";
    if (warnedRatesRef.current.get(item.productId) === key) return;
    warnedRatesRef.current.set(item.productId, key);
    if (!w) return;
    playWarningBeep();
    const label = `${COST_LABEL[w.source]}${w.withGst ? " + GST" : ""}`;
    toast({
      title: w.kind === "below" ? `⚠ Rate is BELOW ${label.toLowerCase()}` : `⚠ Rate is SAME as ${label.toLowerCase()}`,
      description: `${item.name}: selling at ₹${w.net.toLocaleString()} — ${label.toLowerCase()} ₹${w.cost.toLocaleString()}. Please check the rate.`,
      variant: "destructive",
    });
  };

  const handleSave = () => {
    if (items.length === 0) {
      toast({ title: "No items", description: "Add at least one product before saving.", variant: "destructive" });
      return;
    }
    // Rates at/below cost: stop and ask first. The biller decides — "Save
    // anyway" in the popup goes ahead via saveInvoice().
    if (costWarnings.length > 0 || listWarnings.length > 0) {
      playWarningBeep();
      setCostAlertOpen(true);
      return;
    }
    saveInvoice();
  };

  const saveInvoice = () => {
    setCostAlertOpen(false);
    const payload = {
      invoiceType, invoiceDate, placeOfSupply,
      customerId: customer?.id ?? undefined,
      customerName: customer?.name ?? undefined,
      customerGstin: customer?.gstin ?? undefined,
      billingAddress: customer?.address ?? undefined,
      salesmanId: salesmanId ?? undefined,
      freight, roundOff, billDiscount: effectiveBillDiscount,
      items: items.map((i) => ({
        productId: i.productId, qty: billedUnits(i),
        ...(i.qtyMode === "box" && i.unitsPerBox > 0 ? { qtyBoxes: i.qty } : {}),
        ...(i.litersPerBox > 0 ? { litersPerBox: i.litersPerBox } : {}),
        unit: i.unit ?? "QTY", rate: i.rate ?? 0, mrp: i.mrp ?? 0,
        taxPct: isGstInvoiceType(invoiceType) ? i.taxPct : 0,
        discountPct: i.discountPct, discountAmt: i.discountAmt, cessPct: 0,
        ...(i.description?.trim() ? { description: i.description.trim() } : {}),
      })),
    };
    if (isEditMode && editId) {
      updateInvoice.mutate({ id: editId, data: payload as any }, {
        onSuccess: (invoice) => {
          queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(editId) });
          toast({ title: `Invoice ${invoice.invoiceNo} updated`, description: "Stock and customer ledger adjusted." });
          setLocation("/invoices");
        },
        onError: async (err: any) => {
          let desc = err?.message ?? "Update failed";
          try { const j = await err?.response?.json?.(); if (j?.error) desc = String(j.error).slice(0, 300); } catch {}
          toast({ title: "Failed to update invoice", description: desc, variant: "destructive" });
        },
      });
      return;
    }
    createInvoice.mutate({ data: payload as any }, {
      onSuccess: (invoice) => {
        queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
        setSaved(true);
        setSavedInvoice(invoice);
        if ((invoice.invoiceType as string) !== "quotation") {
          toast({ title: `Invoice ${invoice.invoiceNo} saved` });
        } else {
          toast({ title: `Quotation ${invoice.invoiceNo} saved`, description: "No stock or payment changes made." });
        }
      },
      onError: async (err: any) => {
        let desc = err?.message ?? "Save failed";
        try { const j = await err?.response?.json?.(); if (j?.error) desc = String(j.error).slice(0, 300); } catch {}
        toast({ title: "Failed to save invoice", description: desc, variant: "destructive" });
      },
    });
  };

  handleSaveRef.current = handleSave;

  const handleShareInvoice = async () => {
    if (!savedInvoice) return;
    const sheetEl = savedSheetRef.current?.querySelector(".invoice-sheet") as HTMLElement | null;
    if (!sheetEl) {
      toast({ title: "Could not find invoice to share", variant: "destructive" });
      return;
    }
    setSharing(true);
    try {
      const result = await shareInvoiceImage(sheetEl, {
        fileName: `Invoice-${String(savedInvoice.invoiceNo).replace(/\//g, "-")}.png`,
        title: `Invoice ${savedInvoice.invoiceNo}`,
        text: `Invoice ${savedInvoice.invoiceNo} — ₹${finalTotal.toLocaleString()}`,
      });
      if (result === "downloaded") {
        toast({ title: "Image downloaded", description: "Your browser doesn't support direct sharing — attach the downloaded image in WhatsApp manually." });
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ title: "Could not share invoice", description: err?.message ?? "Unknown error", variant: "destructive" });
      }
    } finally {
      setSharing(false);
    }
  };

  if (saved && savedInvoice) {
    return (
      <>
      <div className="max-w-3xl mx-auto py-8 space-y-6 print:hidden">
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-6 pb-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex items-start gap-4 flex-1 min-w-0">
                <CheckCircle className="w-10 h-10 text-green-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-xl font-bold">{savedInvoice.invoiceType === "quotation" ? "Quotation Saved" : "Invoice Saved"}</h2>
                    <Badge className="font-mono bg-green-600 text-white border-transparent">{savedInvoice.invoiceNo}</Badge>
                  </div>
                  {customer && (
                    <p className="text-sm text-muted-foreground mt-0.5 break-words">
                      Customer: <span className="text-foreground font-medium">{customer.name}</span>
                      {customer.mobile && <span className="ml-2 text-muted-foreground">({customer.mobile})</span>}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">{savedInvoice.invoiceType === "quotation" ? "Quotation Total" : "Invoice Total"}</span>
                      <div className="text-xl sm:text-2xl font-bold text-primary">₹{finalTotal.toLocaleString()}</div>
                    </div>
                    {savedInvoice.invoiceType !== "quotation" && customer && Number(customer.outstandingBalance) + finalTotal > 0 && (
                      <div>
                        <span className="text-muted-foreground">New Outstanding</span>
                        <div className="text-base sm:text-lg font-bold text-destructive">₹{(Number(customer.outstandingBalance) + finalTotal).toLocaleString()}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 sm:flex-none border-green-400 text-green-700 hover:bg-green-50"
                  onClick={handleShareInvoice}
                  disabled={sharing}
                  data-testid="button-share-invoice"
                >
                  {sharing ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Share2 className="w-4 h-4 mr-1.5" />}
                  Share
                </Button>
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-1.5" /> Print
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {savedInvoice.invoiceType === "quotation" && (
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <CheckCircle className="w-5 h-5 shrink-0 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-foreground">Quotation only — no stock or payment changes</p>
                  <p className="text-xs mt-0.5">Convert to a GST or Non-GST invoice when the order is confirmed.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:flex">
          <Button variant="outline" onClick={() => setLocation("/invoices")}>View All Invoices</Button>
          <Button onClick={() => setLocation("/catalog")}>New Order</Button>
        </div>
      </div>

      <div ref={savedSheetRef}>
        <InvoiceTemplateRenderer
          invoice={savedInvoice}
          settings={printSettings}
          maps={printMaps}
          templateId={printSettings.defaultTemplate}
        />
      </div>
      </>
    );
  }

  const isSaving = createInvoice.isPending || updateInvoice.isPending;
  const docLabel = docType === "invoice"
    ? (invoiceSubtype === "gst" ? "GST Invoice" : "Non-GST Invoice")
    : (DOC_TYPE_OPTIONS.find((o) => o.value === docType)?.label ?? "Invoice");
  // Phone steps: tailwind classes that hide a section unless its step is the
  // current one — md and up always shows it, so desktop is unchanged.
  const stepCls = (s: 1 | 2 | 3) => (mobileStep === s ? "" : "hidden md:block");
  const goToStep = (s: 1 | 2 | 3) => {
    setMobileStep(s);
    setSearchOpen(false);
    window.scrollTo({ top: 0 });
  };
  const exitBilling = () => setLocation(isEditMode ? "/invoices" : "/catalog");
  const totalQtyAll = items.reduce((s, i) => s + billedUnits(i), 0);
  const totalLtrAll = items.reduce((s, i) => s + lineLiters(i), 0);

  return (
    <>
    <div className="space-y-5 pb-28 md:pb-10 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="shrink-0"
            onClick={() => {
              // Phone: back steps through the flow first; desktop always leaves.
              if (mobileStep > 1 && !window.matchMedia("(min-width: 768px)").matches) goToStep((mobileStep - 1) as 1 | 2);
              else exitBilling();
            }}
            data-testid="button-back-catalog">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            {isEditMode ? `Edit Invoice ${existingInvoice?.invoiceNo ?? ""}` : "Create Invoice"}
          </h1>
          <Badge variant="secondary" className="md:hidden ml-auto">{docLabel}</Badge>
          {isEditMode && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400 whitespace-normal text-left max-w-full">
              Editing — stock &amp; customer balance will be re-adjusted on save
            </Badge>
          )}
        </div>
        <div className="hidden md:flex flex-wrap gap-2">
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger className="w-[150px] sm:w-[170px]" data-testid="select-doc-type"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPE_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {docType === "invoice" && (
            <Select value={invoiceSubtype} onValueChange={(v) => setInvoiceSubtype(v as "gst" | "non_gst")}>
              <SelectTrigger className="w-[100px] sm:w-[110px]" data-testid="select-invoice-subtype"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="gst">GST</SelectItem>
                <SelectItem value="non_gst">Non-GST</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button onClick={handleSave} disabled={createInvoice.isPending || updateInvoice.isPending || items.length === 0} data-testid="button-save-invoice">
            {(createInvoice.isPending || updateInvoice.isPending) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {isEditMode ? "Update" : ({ quotation: "Save Quotation", proforma_invoice: "Save Proforma", bill_of_supply: "Save Bill", delivery_challan: "Save Challan", sale_order: "Save Order" }[invoiceType] ?? "Save Invoice")}
            <kbd className="hidden md:inline-flex ml-2 items-center rounded border border-primary-foreground/30 px-1.5 py-0.5 text-[10px] font-mono opacity-70">Ctrl+S</kbd>
          </Button>
          {isEditMode && existingInvoice && (
            <Button variant="outline" onClick={() => window.print()} data-testid="button-print-invoice">
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
          )}
        </div>
      </div>

      {/* Phone step bar — tap a step to jump to it. */}
      <div className="md:hidden grid grid-cols-3 gap-2" data-testid="billing-mobile-steps">
        {(["Customer", "Items", "Review"] as const).map((label, i) => {
          const s = (i + 1) as 1 | 2 | 3;
          return (
            <button key={label} type="button" onClick={() => goToStep(s)}
              className="flex flex-col gap-1.5 text-left" aria-current={mobileStep === s ? "step" : undefined}
              data-testid={`button-mobile-step-${s}`}>
              <span className={`h-1 rounded-full ${s <= mobileStep ? "bg-primary" : "bg-muted"}`} />
              <span className={`text-[11px] font-semibold uppercase tracking-wide ${mobileStep === s ? "text-primary" : "text-muted-foreground"}`}>
                {s}. {label}{s === 2 && items.length > 0 ? ` (${items.length})` : ""}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className={`lg:col-span-2 space-y-5 ${mobileStep === 3 ? "hidden md:block" : ""}`}>
          {/* Phone step 1: document type as tap chips (desktop has the dropdowns in the header). */}
          {mobileStep === 1 && (
            <Card className="md:hidden">
              <CardContent className="pt-4 pb-4 space-y-3">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Document</Label>
                <div className="flex flex-wrap gap-2">
                  {DOC_TYPE_OPTIONS.map((opt) => (
                    <button key={opt.value} type="button" onClick={() => setDocType(opt.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${docType === opt.value ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`}
                      data-testid={`chip-doc-type-${opt.value}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {docType === "invoice" && (
                  <div className="grid grid-cols-2 rounded-md border overflow-hidden text-sm font-semibold">
                    {(["gst", "non_gst"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setInvoiceSubtype(v)}
                        className={`py-2 transition-colors ${invoiceSubtype === v ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                        data-testid={`seg-invoice-subtype-${v}`}>
                        {v === "gst" ? "GST" : "Non-GST"}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card className={stepCls(1)}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><User className="w-4 h-4 text-primary" /> Customer Details</CardTitle>
            </CardHeader>
            <CardContent>
              {customer ? (
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="font-semibold text-lg">{customer.name}</div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                      {customer.mobile && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.mobile}</span>}
                      {customer.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{customer.city}{customer.state ? `, ${customer.state}` : ""}</span>}
                    </div>
                    {customer.gstin && <div className="text-xs font-mono text-muted-foreground">GSTIN: {customer.gstin}</div>}
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <Badge variant="outline" className="capitalize text-[10px]">{customer.pricingTier} pricing</Badge>
                      {Number(customer.outstandingBalance) > 0 && <Badge variant="destructive" className="text-[10px]">Outstanding: ₹{Number(customer.outstandingBalance).toLocaleString()}</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {customer.id != null && (
                      <Button variant="outline" size="sm" onClick={() => setShowCustomerEdit(true)} className="text-xs" data-testid="button-edit-customer">
                        <Pencil className="w-3 h-3 mr-1.5" /> Edit
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => setShowCustomerSearch(true)} className="text-xs" data-testid="button-change-customer">Change</Button>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm flex items-center gap-2">
                  <User className="w-4 h-4" /> Walk-in / Cash customer
                  <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={() => setShowCustomerSearch(true)} data-testid="button-change-customer">Change</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className={stepCls(1)}>
            <CardContent className="pt-4 pb-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs">Invoice Date</Label>
                  <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} data-testid="input-invoice-date" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Place of Supply</Label>
                  <Input value={placeOfSupply} onChange={(e) => setPlaceOfSupply(e.target.value)} placeholder="e.g. Maharashtra" data-testid="input-place-supply" />
                </div>
                {/* Phone: Freight / Salesman are rarely needed, so they sit behind "More". */}
                {!(showMoreDetails || freight > 0) && (
                  <button type="button" onClick={() => setShowMoreDetails(true)}
                    className="md:hidden col-span-2 flex items-center justify-between rounded-md border border-dashed px-3 py-2 text-xs font-medium text-muted-foreground"
                    data-testid="button-more-details">
                    <span>{user?.role === "admin" ? "Freight, Salesman" : "Freight"}</span>
                    <span className="flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> More</span>
                  </button>
                )}
                <div className={`space-y-1 ${showMoreDetails || freight > 0 ? "" : "hidden md:block"}`}>
                  <Label className="text-xs">Freight (₹)</Label>
                  <NumberInput min={0} value={freight} onChange={(v) => setFreight(v)} data-testid="input-freight" />
                </div>
                {user?.role === "admin" && (
                  <div className={`space-y-1 ${showMoreDetails || freight > 0 ? "" : "hidden md:block"}`}>
                    <Label className="text-xs">Salesman (Commission)</Label>
                    <Select value={salesmanId ? String(salesmanId) : "__none__"} onValueChange={(v) => setSalesmanId(v === "__none__" ? null : Number(v))}>
                      <SelectTrigger className="h-9" data-testid="select-salesman"><SelectValue placeholder="No salesman" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No salesman</SelectItem>
                        {(salesmanEntities ?? []).map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className={stepCls(2)}>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base">Line Items</CardTitle>
              <span className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</span>
            </CardHeader>
            <div className="px-5 pb-3 relative" ref={searchRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)} placeholder="Search product to add..." className="pl-9 pr-14 h-9" data-testid="input-product-search"
                  role="combobox" aria-expanded={searchOpen} aria-controls="product-search-listbox" aria-autocomplete="list"
                  aria-activedescendant={searchOpen && filteredProducts[searchActiveIdx] ? `product-opt-${searchActiveIdx}` : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault(); setSearchOpen(true);
                      setSearchActiveIdx((i) => Math.min(i + 1, filteredProducts.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSearchActiveIdx((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      const pick = filteredProducts[searchActiveIdx];
                      if (pick) { e.preventDefault(); addProductAndFocusQty(pick); }
                    }
                  }} />
                <kbd className="hidden md:inline-flex absolute right-2.5 top-1/2 -translate-y-1/2 items-center rounded border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground pointer-events-none">/</kbd>
              </div>
              {searchOpen && (
                <div id="product-search-listbox" role="listbox" className="absolute z-50 left-5 right-5 top-full mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No products found.</div>
                  ) : filteredProducts.map((p, idx) => {
                    const alreadyAdded = items.some((i) => i.productId === p.id);
                    const active = idx === searchActiveIdx;
                    return (
                      <button key={p.id} type="button" id={`product-opt-${idx}`} role="option" aria-selected={active}
                        data-active={active}
                        onClick={() => addProductAndFocusQty(p)}
                        onMouseEnter={() => setSearchActiveIdx(idx)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 text-sm border-b last:border-0 ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                        data-testid={`product-option-${p.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className={`text-xs ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                            ₹{getBaseRate(p, customer, invoiceType).toLocaleString()}
                            {isGstInvoiceType(invoiceType) && p.taxRate ? ` · GST ${p.taxRate}%` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <StockPill product={p} active={active} />
                          {alreadyAdded && <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-primary/10 text-primary"}`}>Added</span>}
                          <Plus className={`w-4 h-4 ${active ? "text-primary-foreground" : "text-muted-foreground"}`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <CardContent className="p-0">
              {/* Desktop / tablet: dense table */}
              <div className="hidden md:block overflow-x-auto max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead className="w-[220px]">Product</TableHead>
                      <TableHead className="w-32 text-right">Qty</TableHead>
                      <TableHead className="w-16 text-right">LTR</TableHead>
                      <TableHead className="w-24 text-right">Rate (₹)</TableHead>
                      {isGstInvoiceType(invoiceType) && <TableHead className="w-16 text-right">Tax%</TableHead>}
                      <TableHead className="w-20 text-right">Disc%</TableHead>
                      <TableHead className="w-24 text-right font-semibold">Amount</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">No items — search above to add products</TableCell></TableRow>
                    ) : items.map((item, idx) => (
                      <Fragment key={idx}>
                      <TableRow data-testid={`billing-row-${idx}`}>
                        <TableCell>
                          <div className="font-medium text-sm leading-tight">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.unit}</div>
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(idx, "description", e.target.value)}
                            placeholder="Add description (optional)"
                            className="h-6 mt-1 text-xs px-1.5"
                            data-testid={`input-description-${idx}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <NumberInput min={1} step="any" value={item.qty}
                                onChange={(v) => updateItem(idx, "qty", v)}
                                onKeyDown={(e) => lineItemKeyDown(e, idx, "qty")}
                                className="w-14 text-right h-7 text-sm" data-testid={`input-qty-${idx}`} />
                              <Select value={item.qtyMode} onValueChange={(v) => updateItem(idx, "qtyMode", v as QtyMode)}>
                                <SelectTrigger className="h-7 w-[58px] px-2 text-xs" data-testid={`select-qty-mode-${idx}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unit">QTY</SelectItem>
                                  <SelectItem value="box" disabled={item.unitsPerBox <= 0}>{item.packagingUnit.toUpperCase()}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            {item.qtyMode === "box" && item.unitsPerBox > 0 && (
                              <span className="text-[10px] text-muted-foreground" data-testid={`hint-billed-units-${idx}`}>= {billedUnits(item).toLocaleString()} {item.unit}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm" data-testid={`cell-ltr-${idx}`}>
                          {(() => { const ltr = lineLiters(item); return ltr > 0 ? ltr.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"; })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <NumberInput min={0} value={item.rate}
                            onChange={(v) => updateItem(idx, "rate", v, { rateEdited: true })}
                            onKeyDown={(e) => lineItemKeyDown(e, idx, "rate")}
                            onFocus={() => setRateFocusIdx(idx)}
                            onBlur={() => { setRateFocusIdx((cur) => (cur === idx ? null : cur)); checkCostOnBlur(idx); }}
                            className={`w-24 text-right h-7 text-sm disabled:opacity-100 disabled:cursor-not-allowed ${costWarning(item) ? "border-red-500 bg-red-50 text-red-700 focus-visible:ring-red-500" : listRateWarning(item) ? "border-amber-500 bg-amber-50 text-amber-800 focus-visible:ring-amber-500" : ""}`}
                            data-testid={`input-rate-${idx}`} disabled={!canEditRate}
                            title={!canEditRate ? "Rate change not allowed for your login" : undefined} />
                          <CostWarningHint w={costWarning(item)} testId={`hint-cost-warning-${idx}`} />
                          <ListRateHint w={listRateWarning(item)} testId={`hint-list-rate-${idx}`} />
                        </TableCell>
                        {isGstInvoiceType(invoiceType) && (
                          <TableCell className="text-right">
                            <NumberInput min={0} max={28} value={item.taxPct}
                              onChange={(v) => updateItem(idx, "taxPct", v)}
                              onKeyDown={(e) => lineItemKeyDown(e, idx, "tax")}
                              className="w-16 text-right h-7 text-sm" data-testid={`input-tax-${idx}`} />
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <NumberInput min={0} max={100} value={item.discountPct}
                            onChange={(v) => updateItem(idx, "discountPct", v)}
                            onKeyDown={(e) => lineItemKeyDown(e, idx, "discount")}
                            onBlur={() => checkCostOnBlur(idx)}
                            className="w-20 text-right h-7 text-sm" data-testid={`input-discount-${idx}`} />
                        </TableCell>
                        <TableCell className="text-right font-bold text-sm">₹{item.amount.toLocaleString()}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => removeItem(idx)} data-testid={`button-remove-item-${idx}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {rateFocusIdx === idx && (
                        <TableRow className="hover:bg-transparent border-0">
                          <TableCell colSpan={isGstInvoiceType(invoiceType) ? 8 : 7} className="pt-0 pb-2">
                            <RateHistoryPanel
                              productId={item.productId}
                              customerId={customer?.id ?? null}
                              customerName={customer?.name ?? null}
                              excludeInvoiceId={isEditMode ? editId : null}
                              unit={item.unit}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: stacked cards — the table's 8 fixed-width columns
                  (~780px) never fit a phone screen, so each line item gets
                  its own labeled block instead of a cramped row. */}
              <div className="md:hidden divide-y">
                {items.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No items — search above to add products</div>
                ) : items.map((item, idx) => {
                  const open = openItemIdx === idx;
                  const ltr = lineLiters(item);
                  return (
                  <div key={idx} className={`p-3 space-y-2 ${open ? "bg-muted/30" : ""}`} data-testid={`billing-row-mobile-${idx}`}>
                    {/* Compact row: tap the name to open Rate / Disc / Tax / description. */}
                    <div className="flex items-start gap-2">
                      <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open}
                        onClick={() => setOpenItemIdx(open ? null : idx)} data-testid={`button-toggle-item-mobile-${idx}`}>
                        <div className="font-medium text-sm leading-tight">{item.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          ₹{item.rate.toLocaleString()} / {item.unit}
                          {isGstInvoiceType(invoiceType) && item.taxPct ? ` · GST ${item.taxPct}%` : ""}
                          {item.discountPct > 0 ? ` · ${item.discountPct}% off` : ""}
                          {ltr > 0 ? ` · ${ltr.toLocaleString(undefined, { maximumFractionDigits: 3 })} L` : ""}
                        </div>
                      </button>
                      <span className="font-bold text-sm tabular-nums shrink-0">₹{item.amount.toLocaleString()}</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0"
                        disabled={item.qty <= 1} onClick={() => updateItem(idx, "qty", Math.max(1, item.qty - 1))}
                        aria-label="Decrease quantity" data-testid={`button-qty-minus-mobile-${idx}`}>
                        <Minus className="w-3.5 h-3.5" />
                      </Button>
                      <NumberInput min={1} step="any" value={item.qty}
                        onChange={(v) => updateItem(idx, "qty", v)}
                        className="h-8 w-14 text-center text-sm px-1" data-testid={`input-qty-mobile-${idx}`} />
                      <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0"
                        onClick={() => updateItem(idx, "qty", item.qty + 1)}
                        aria-label="Increase quantity" data-testid={`button-qty-plus-mobile-${idx}`}>
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                      <Select value={item.qtyMode} onValueChange={(v) => updateItem(idx, "qtyMode", v as QtyMode)}>
                        <SelectTrigger className="h-8 w-[62px] px-2 text-xs shrink-0" data-testid={`select-qty-mode-mobile-${idx}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unit">QTY</SelectItem>
                          <SelectItem value="box" disabled={item.unitsPerBox <= 0}>{item.packagingUnit.toUpperCase()}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8 ml-auto shrink-0"
                        onClick={() => setOpenItemIdx(open ? null : idx)} aria-label={open ? "Hide item details" : "Show item details"}>
                        <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeItem(idx)} data-testid={`button-remove-item-mobile-${idx}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    {item.qtyMode === "box" && item.unitsPerBox > 0 && (
                      <span className="text-[10px] text-muted-foreground block" data-testid={`hint-billed-units-mobile-${idx}`}>= {billedUnits(item).toLocaleString()} {item.unit}</span>
                    )}
                    {/* Warnings stay visible even when the card is closed. */}
                    {!open && (costWarning(item) || listRateWarning(item)) && (
                      <div className="flex flex-col items-start">
                        <CostWarningHint w={costWarning(item)} testId={`hint-cost-warning-mobile-${idx}`} />
                        <ListRateHint w={listRateWarning(item)} testId={`hint-list-rate-mobile-${idx}`} />
                      </div>
                    )}

                    {open && (
                      <div className="space-y-2 pt-1">
                        <div className={`grid gap-2 ${isGstInvoiceType(invoiceType) ? "grid-cols-3" : "grid-cols-2"}`}>
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Rate (₹)</Label>
                            <NumberInput min={0} value={item.rate}
                              onChange={(v) => updateItem(idx, "rate", v, { rateEdited: true })}
                              onFocus={() => setRateFocusIdx(idx)}
                              onBlur={() => { setRateFocusIdx((cur) => (cur === idx ? null : cur)); checkCostOnBlur(idx); }}
                              className={`h-8 text-sm disabled:opacity-100 disabled:cursor-not-allowed ${costWarning(item) ? "border-red-500 bg-red-50 text-red-700 focus-visible:ring-red-500" : listRateWarning(item) ? "border-amber-500 bg-amber-50 text-amber-800 focus-visible:ring-amber-500" : ""}`}
                              data-testid={`input-rate-mobile-${idx}`} disabled={!canEditRate}
                              title={!canEditRate ? "Rate change not allowed for your login" : undefined} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[11px] text-muted-foreground">Disc%</Label>
                            <NumberInput min={0} max={100} value={item.discountPct}
                              onChange={(v) => updateItem(idx, "discountPct", v)}
                              onBlur={() => checkCostOnBlur(idx)}
                              className="h-8 text-sm" data-testid={`input-discount-mobile-${idx}`} />
                          </div>
                          {isGstInvoiceType(invoiceType) && (
                            <div className="space-y-1">
                              <Label className="text-[11px] text-muted-foreground">Tax%</Label>
                              <NumberInput min={0} max={28} value={item.taxPct}
                                onChange={(v) => updateItem(idx, "taxPct", v)}
                                className="h-8 text-sm" data-testid={`input-tax-mobile-${idx}`} />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-start">
                          <CostWarningHint w={costWarning(item)} testId={`hint-cost-warning-mobile-${idx}`} />
                          <ListRateHint w={listRateWarning(item)} testId={`hint-list-rate-mobile-${idx}`} />
                        </div>
                        {rateFocusIdx === idx && (
                          <RateHistoryPanel
                            productId={item.productId}
                            customerId={customer?.id ?? null}
                            customerName={customer?.name ?? null}
                            excludeInvoiceId={isEditMode ? editId : null}
                            unit={item.unit}
                          />
                        )}
                        <Input
                          value={item.description}
                          onChange={(e) => updateItem(idx, "description", e.target.value)}
                          placeholder="Add description (optional)"
                          className="h-8 text-xs"
                          data-testid={`input-description-mobile-${idx}`}
                        />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className={`space-y-5 ${stepCls(3)}`}>
          {/* Phone step 3: what's being billed, with a jump back to step 1. */}
          <Card className="md:hidden">
            <CardContent className="pt-4 pb-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{customer?.name ?? "Walk-in / Cash customer"}</div>
                <div className="text-xs text-muted-foreground">
                  {docLabel} · {invoiceDate.split("-").reverse().join("/")} · {items.length} item{items.length !== 1 ? "s" : ""}
                </div>
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => goToStep(1)} data-testid="button-review-edit-customer">Edit</Button>
                {isEditMode && existingInvoice && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => window.print()} data-testid="button-print-invoice-mobile">
                    <Printer className="w-3 h-3 mr-1" /> Print
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Invoice Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {(() => {
                const totalLtr = items.reduce((s, i) => s + lineLiters(i), 0);
                const totalQty = items.reduce((s, i) => s + billedUnits(i), 0);
                return (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Total Qty / Ltr</span>
                    <span className="tabular-nums">{totalQty.toLocaleString()} / {totalLtr > 0 ? totalLtr.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"}</span>
                  </div>
                );
              })()}
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>₹{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
              {totalDiscount > 0 && <div className="flex justify-between text-green-600"><span>Discount</span><span>- ₹{totalDiscount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
              {isGstInvoiceType(invoiceType) && (
                <>
                  <Separator />
                  {!isInterstate ? (
                    <>
                      <div className="flex justify-between text-muted-foreground"><span>CGST</span><span>₹{cgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                      <div className="flex justify-between text-muted-foreground"><span>SGST</span><span>₹{sgst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    </>
                  ) : (
                    <div className="flex justify-between text-muted-foreground"><span>IGST</span><span>₹{igst.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                  )}
                </>
              )}
              {freight > 0 && <div className="flex justify-between text-muted-foreground"><span>Freight</span><span>₹{freight.toLocaleString()}</span></div>}
              <Separator />
              <div className="flex justify-between font-medium"><span>Total</span><span>₹{preDiscountTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="input-bill-discount" className="text-muted-foreground shrink-0">Discount (₹)</Label>
                <NumberInput
                  id="input-bill-discount"
                  min={0}
                  value={billDiscount}
                  onChange={(v) => setBillDiscount(v)}
                  className="w-28 text-right"
                  data-testid="input-bill-discount"
                />
              </div>
              {effectiveBillDiscount > 0 && (
                <p className="text-[11px] text-muted-foreground -mt-1">Logged as an expense (category "Discount") — no Cash Book account is affected.</p>
              )}
              {Math.abs(roundOff) > 0.001 && <div className="flex justify-between text-muted-foreground text-xs"><span>Round Off</span><span>{roundOff > 0 ? "+" : ""}₹{roundOff.toFixed(2)}</span></div>}
              <Separator />
              <div className="flex justify-between font-bold text-lg"><span>Grand Total</span><span className="text-primary">₹{finalTotal.toLocaleString()}</span></div>
              {isGstInvoiceType(invoiceType) && totalTax > 0 && !showGstBreakup && (
                <button type="button" onClick={() => setShowGstBreakup(true)}
                  className="md:hidden w-full flex items-center justify-between rounded bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground"
                  data-testid="button-show-gst-breakup">
                  <span className="uppercase tracking-wide">GST Breakup</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              )}
              {isGstInvoiceType(invoiceType) && totalTax > 0 && (
                <div className={`bg-muted/50 rounded p-3 space-y-1 text-xs ${showGstBreakup ? "" : "hidden md:block"}`}>
                  <div className="font-medium mb-1 text-muted-foreground uppercase tracking-wide">GST Breakup</div>
                  {items.map((item, i) => {
                    if (!item.taxPct) return null;
                    const base = billedUnits(item) * item.rate;
                    const disc = item.discountAmt > 0 ? item.discountAmt : (base * item.discountPct / 100);
                    const tax = (base - disc) * item.taxPct / 100;
                    return (
                      <div key={i} className="flex justify-between text-muted-foreground">
                        <span className="truncate max-w-[120px]">{item.name} ({item.taxPct}%)</span>
                        <span>₹{tax.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Phone uses the sticky bar below instead. */}
          <div className="hidden md:flex flex-col gap-5">
            <Button className="w-full" size="lg" onClick={handleSave}
              disabled={isSaving || items.length === 0}
              data-testid="button-save-invoice-bottom">
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {isEditMode ? "Update Invoice" : "Save & Generate Invoice"}
            </Button>
            <Button variant="outline" className="w-full" onClick={exitBilling} data-testid="button-back-to-catalog">
              <ArrowLeft className="w-4 h-4 mr-2" /> {isEditMode ? "Back to Invoices" : "Back to Catalog"}
            </Button>
          </div>
        </div>
      </div>

      {/* Phone sticky bar: running total + the one action for this step. */}
      <div className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex items-center gap-3"
        data-testid="billing-mobile-bar">
        {mobileStep < 3 ? (
          <>
            <div className="min-w-0 leading-tight">
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {items.length} item{items.length !== 1 ? "s" : ""}
                {items.length > 0 ? ` · ${totalQtyAll.toLocaleString()} qty` : ""}
                {totalLtrAll > 0 ? ` · ${totalLtrAll.toLocaleString(undefined, { maximumFractionDigits: 3 })} L` : ""}
              </div>
              <div className="text-lg font-bold tabular-nums">₹{finalTotal.toLocaleString()}</div>
            </div>
            {mobileStep === 1 ? (
              <Button className="ml-auto" onClick={() => goToStep(2)} data-testid="button-mobile-next-items">
                {items.length > 0 ? "Items" : "Add Items"} <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            ) : (
              <Button className="ml-auto" onClick={() => goToStep(3)} disabled={items.length === 0} data-testid="button-mobile-next-review">
                Review <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="outline" onClick={() => goToStep(2)} data-testid="button-mobile-back-items">
              <ArrowLeft className="w-4 h-4 mr-1.5" /> Items
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={isSaving || items.length === 0} data-testid="button-save-invoice-mobile">
              {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {isEditMode ? "Update" : "Save"} · ₹{finalTotal.toLocaleString()}
            </Button>
          </>
        )}
      </div>
    </div>

    {isEditMode && existingInvoice && (
      <InvoiceTemplateRenderer
        invoice={existingInvoice}
        settings={printSettings}
        maps={printMaps}
        templateId={printSettings.defaultTemplate}
      />
    )}

    <CustomerSearchDialog
      open={showCustomerSearch}
      onOpenChange={setShowCustomerSearch}
      onSelect={(c) => {
        setCustomer(c);
        if (c?.state) setPlaceOfSupply(c.state);
        setShowCustomerSearch(false);
      }}
    />
    <CustomerEditDialog
      open={showCustomerEdit}
      onOpenChange={setShowCustomerEdit}
      customer={customer}
      onSaved={(updated) => {
        setCustomer(updated);
        if (updated?.state) setPlaceOfSupply(updated.state);
        setShowCustomerEdit(false);
      }}
    />
    {/* Save-time check: some lines are priced at/below purchase cost. The
        safe choice ("Go back & check") has focus, so an absent-minded Enter
        doesn't save the bill. */}
    <Dialog open={costAlertOpen} onOpenChange={setCostAlertOpen}>
      <DialogContent className="max-w-lg border-2 border-red-500" data-testid="dialog-cost-alert">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-6 h-6" /> Alert — please check this bill
          </DialogTitle>
          <DialogDescription>
            {costWarnings.length > 0
              ? <>{costWarnings.length === 1 ? "1 item is" : `${costWarnings.length} items are`} priced at or below cost
                (purchase rate, or manufacturing cost from the BOM for items you make). Is this a mistake?</>
              : <>{listWarnings.length === 1 ? "1 item is" : `${listWarnings.length} items are`} priced below the price list.
                If you save, this bill will be marked <b>Below rate</b> for the admin.</>}
          </DialogDescription>
        </DialogHeader>
        {costWarnings.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Item</th>
                <th className="text-right font-medium px-3 py-2">Selling</th>
                <th className="text-right font-medium px-3 py-2">Cost</th>
                <th className="text-right font-medium px-3 py-2">Loss/unit</th>
              </tr>
            </thead>
            <tbody>
              {costWarnings.map(({ item, idx, w }) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium leading-tight">{item.name}</div>
                    <div className="text-[11px] text-red-600">
                      {w.kind === "below" ? "Below" : "Same as"} {COST_LABEL[w.source].toLowerCase()}{w.withGst ? " + GST" : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">₹{w.net.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    ₹{w.cost.toLocaleString()}
                    <div className="text-[10px] text-muted-foreground">{COST_LABEL[w.source]}{w.withGst ? " + GST" : ""}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {w.kind === "below" ? `₹${(Math.round((w.cost - w.net) * 100) / 100).toLocaleString()}` : "₹0"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {listWarnings.length > 0 && (
          <div className="max-h-[240px] overflow-y-auto rounded-md border border-amber-400" data-testid="list-rate-warnings">
            <div className="px-3 py-1.5 text-xs font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Below price list — will be marked for the admin
            </div>
            <table className="w-full text-sm">
              <tbody>
                {listWarnings.map(({ item, idx, w }) => (
                  <tr key={idx} className="border-t">
                    <td className="px-3 py-2 font-medium leading-tight">{item.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-700">₹{w.net.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">List ₹{w.list.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            autoFocus
            variant="outline"
            data-testid="button-cost-alert-back"
            onClick={() => {
              setCostAlertOpen(false);
              const first = costWarnings[0] ?? listWarnings[0];
              if (first) {
                requestAnimationFrame(() => {
                  const el = document.querySelector<HTMLInputElement>(`[data-testid="input-rate-${first.idx}"]`);
                  if (el && el.offsetParent !== null && !el.disabled) { el.focus(); el.select(); }
                });
              }
            }}
          >
            Go back &amp; check
          </Button>
          <Button
            variant="destructive"
            data-testid="button-cost-alert-save"
            disabled={createInvoice.isPending || updateInvoice.isPending}
            onClick={saveInvoice}
          >
            Save anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function CustomerSearchDialog({
  open, onOpenChange, onSelect,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onSelect: (customer: any) => void;
}) {
  const { toast } = useToast();
  const [searchMode, setSearchMode] = useState<"mobile" | "name">("mobile");
  const [mobileInput, setMobileInput] = useState("");
  const [searchMobile, setSearchMobile] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [step, setStep] = useState<"mobile" | "found" | "not_found">("mobile");
  const [foundCustomer, setFoundCustomer] = useState<any>(null);
  const [newCustomer, setNewCustomer] = useState({
    name: "", gstin: "", address: "", city: "", state: "Maharashtra", pricingTier: "retail" as "retail" | "wholesale",
  });

  const reset = () => {
    setSearchMode("mobile");
    setMobileInput(""); setSearchMobile(""); setNameInput(""); setStep("mobile"); setFoundCustomer(null);
    setNewCustomer({ name: "", gstin: "", address: "", city: "", state: "Maharashtra", pricingTier: "retail" });
  };

  const { data: lookupResult, isFetching: isLooking } = useLookupEntityByMobile(
    { mobile: searchMobile },
    { query: { enabled: searchMobile.length === 10, queryKey: getLookupEntityByMobileQueryKey({ mobile: searchMobile }) } }
  );

  if (lookupResult !== undefined && searchMobile && step === "mobile" && !isLooking) {
    if (lookupResult.found && lookupResult.entity) {
      setFoundCustomer(lookupResult.entity);
      setStep("found");
    } else {
      setStep("not_found");
    }
  }

  const handleLookup = () => {
    if (mobileInput.length !== 10) return;
    setSearchMobile(mobileInput);
  };

  const debouncedName = useDebounced(nameInput, 250);
  const nameSearchParams = { type: "customer" as const, search: debouncedName.trim() };
  const { data: nameMatches = [], isFetching: isNameSearching } = useListEntities(nameSearchParams, {
    query: {
      queryKey: getListEntitiesQueryKey(nameSearchParams),
      enabled: searchMode === "name" && debouncedName.trim().length >= 1,
    },
  });

  // Keyboard highlight for the name-results list (Arrow keys + Enter).
  const [custActiveIdx, setCustActiveIdx] = useState(0);
  const nameListRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setCustActiveIdx(0); }, [debouncedName, nameMatches.length]);
  useEffect(() => {
    nameListRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [custActiveIdx]);

  const createEntity = useCreateEntity();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    createEntity.mutate(
      { data: { type: "customer", mobile: mobileInput, ...newCustomer } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
          toast({ title: "Customer added" });
          onSelect(created);
          reset();
        },
        onError: (err: any) => toast({ title: "Failed to add customer", description: err?.message, variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Search className="w-4 h-4" /> Change Customer</DialogTitle>
          <DialogDescription>Search by name or mobile number, or register a new customer.</DialogDescription>
        </DialogHeader>

        {step === "mobile" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={searchMode === "mobile" ? "default" : "outline"}
                size="sm"
                onClick={() => setSearchMode("mobile")}
                data-testid="button-search-mode-mobile"
              >
                By Mobile
              </Button>
              <Button
                type="button"
                variant={searchMode === "name" ? "default" : "outline"}
                size="sm"
                onClick={() => setSearchMode("name")}
                data-testid="button-search-mode-name"
              >
                By Name
              </Button>
            </div>

            {searchMode === "mobile" ? (
              <div className="flex gap-2">
                <Input
                  placeholder="10-digit mobile number"
                  value={mobileInput}
                  maxLength={10}
                  onChange={(e) => { setMobileInput(e.target.value.replace(/\D/g, "")); setSearchMobile(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleLookup(); }}
                  className="font-mono tracking-wider"
                  data-testid="input-customer-search-mobile"
                />
                <Button onClick={handleLookup} disabled={mobileInput.length !== 10 || isLooking} data-testid="button-lookup-customer">
                  {isLooking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <Input
                  placeholder="Type customer name or code..."
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoComplete="off"
                  data-testid="input-customer-search-name"
                  role="combobox"
                  aria-expanded={nameMatches.length > 0}
                  aria-activedescendant={nameMatches[custActiveIdx] ? `option-customer-${nameMatches[custActiveIdx].id}` : undefined}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setCustActiveIdx((i) => Math.min(i + 1, nameMatches.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setCustActiveIdx((i) => Math.max(i - 1, 0));
                    } else if (e.key === "Enter") {
                      const pick = nameMatches[custActiveIdx];
                      if (pick) { e.preventDefault(); onSelect(pick); reset(); }
                    }
                  }}
                />
                <div ref={nameListRef} className="max-h-60 overflow-y-auto space-y-1" role="listbox">
                  {isNameSearching ? (
                    <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Searching...
                    </div>
                  ) : nameInput.trim().length < 1 ? (
                    <div className="p-3 text-sm text-muted-foreground">Start typing to search customers.</div>
                  ) : nameMatches.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No matching customer.</div>
                  ) : (
                    nameMatches.map((c: any, idx: number) => {
                      const active = idx === custActiveIdx;
                      return (
                        <button
                          type="button"
                          key={c.id}
                          id={`option-customer-${c.id}`}
                          role="option"
                          aria-selected={active}
                          data-active={active}
                          onClick={() => { onSelect(c); reset(); }}
                          onMouseEnter={() => setCustActiveIdx(idx)}
                          className={`w-full text-left px-3 py-2 rounded-md border text-sm ${active ? "bg-accent border-accent-foreground/20" : "hover:bg-accent"}`}
                          data-testid={`option-customer-${c.id}`}
                        >
                          <div className="font-medium">{c.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {c.mobile}
                            {c.code && <span className="ml-1.5 font-mono">· #{c.code}</span>}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={() => onSelect(null)} data-testid="button-select-walkin">
              Walk-in / Cash Customer
            </Button>
          </div>
        )}

        {step === "found" && foundCustomer && (
          <div className="space-y-3">
            <div className="bg-muted rounded-lg p-4 space-y-1">
              <div className="font-semibold">{foundCustomer.name}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{foundCustomer.mobile}</div>
              <Badge variant="outline" className="capitalize text-[10px] mt-1">{foundCustomer.pricingTier} pricing</Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setStep("mobile"); setSearchMobile(""); }}>Change</Button>
              <Button className="flex-1" onClick={() => { onSelect(foundCustomer); reset(); }} data-testid="button-confirm-customer">Select</Button>
            </div>
          </div>
        )}

        {step === "not_found" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No customer registered for {mobileInput}. Register one now:</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} placeholder="Business / customer name" data-testid="input-new-customer-name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">GSTIN</Label>
                <Input value={newCustomer.gstin} onChange={(e) => setNewCustomer({ ...newCustomer, gstin: e.target.value })} placeholder="Optional" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pricing Tier</Label>
                <Select value={newCustomer.pricingTier} onValueChange={(v) => setNewCustomer({ ...newCustomer, pricingTier: v as "retail" | "wholesale" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retail">Retail</SelectItem>
                    <SelectItem value="wholesale">Wholesale</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Address</Label>
                <Input value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} placeholder="Street address" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Input value={newCustomer.city} onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">State</Label>
                <Input value={newCustomer.state} onChange={(e) => setNewCustomer({ ...newCustomer, state: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setStep("mobile"); setSearchMobile(""); }}>Back</Button>
              <Button className="flex-1" onClick={handleCreate} disabled={createEntity.isPending} data-testid="button-save-new-customer">
                {createEntity.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
                Register & Select
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerEditDialog({
  open, onOpenChange, customer, onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  customer: any;
  onSaved: (customer: any) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateEntity = useUpdateEntity();
  const [form, setForm] = useState({
    name: "", mobile: "", gstin: "", address: "", city: "", state: "", pricingTier: "retail" as "retail" | "wholesale",
  });

  useEffect(() => {
    if (open && customer) {
      setForm({
        name: customer.name ?? "",
        mobile: customer.mobile ?? "",
        gstin: customer.gstin ?? "",
        address: customer.address ?? "",
        city: customer.city ?? "",
        state: customer.state ?? "",
        pricingTier: customer.pricingTier === "wholesale" ? "wholesale" : "retail",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer?.id]);

  const handleSave = () => {
    if (!customer?.id) return;
    updateEntity.mutate(
      { id: customer.id, data: { ...form, name: form.name.trim(), mobile: form.mobile.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntitiesQueryKey() });
          toast({ title: "Customer updated" });
          onSaved({ ...customer, ...form });
        },
        onError: (err: any) => toast({ title: "Update failed", description: err?.message, variant: "destructive" }),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pencil className="w-4 h-4" /> Edit Customer</DialogTitle>
          <DialogDescription>Update this customer's details.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-edit-customer-name" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Mobile</Label>
            <Input value={form.mobile} maxLength={10} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, "") })} data-testid="input-edit-customer-mobile" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">GSTIN</Label>
            <Input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">City</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">State</Label>
            <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Pricing Tier</Label>
            <Select value={form.pricingTier} onValueChange={(v) => setForm({ ...form, pricingTier: v as "retail" | "wholesale" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">Retail</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateEntity.isPending} data-testid="button-save-customer-edit">
            {updateEntity.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
