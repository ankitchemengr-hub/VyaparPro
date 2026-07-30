import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import {
  useListProducts,
  useGetProductRecentPrices,
  getGetProductRecentPricesQueryKey,
  useCreateInvoice,
  useUpdateInvoice,
  useGetInvoice,
  useLogPayment,
  useListAccounts,
  useListEntities,
  useGetPrintSettings,
  useLookupEntityByMobile,
  useCreateEntity,
  useUpdateEntity,
  getListInvoicesQueryKey,
  getListPaymentsQueryKey,
  getListAccountsQueryKey,
  getGetInvoiceQueryKey,
  getLookupEntityByMobileQueryKey,
  getListEntitiesQueryKey,
  type PaymentInputMode,
} from "@workspace/api-client-react";
import { InvoiceTemplateRenderer } from "@/components/invoice-templates/InvoiceTemplateRenderer";
import { useCompanyLogo } from "@/hooks/use-company-logo";
import { FALLBACK_PRINT_SETTINGS } from "@/components/invoice-templates/defaults";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ArrowLeft, Banknote, CreditCard, Building2, Smartphone, Clock, SkipForward,
  Search, Plus, Pencil, UserPlus, Share2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { shareInvoiceImage } from "@/lib/share-invoice";

type QtyMode = "unit" | "box";

const GST_INVOICE_TYPES = new Set(["gst", "proforma_invoice"]);
function isGstInvoiceType(t: string) { return GST_INVOICE_TYPES.has(t); }

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

// Small hint shown under the Rate input while billing so the last few prices
// this product actually sold/bought at are visible without leaving the row —
// separate cached query per product, so switching a row's product doesn't
// wait on every other row's history.
function RecentPriceHint({ productId }: { productId: number }) {
  const { data } = useGetProductRecentPrices(productId, {
    query: { queryKey: getGetProductRecentPricesQueryKey(productId), enabled: !!productId, staleTime: 5 * 60 * 1000 },
  });
  if (!data) return null;
  const sold = data.lastSalePrices.map((p) => `₹${Number(p.rate).toLocaleString()}`).join(", ");
  const bought = data.lastPurchasePrices.map((p) => `₹${Number(p.rate).toLocaleString()}`).join(", ");
  if (!sold && !bought) return null;
  return (
    <div className="text-[9px] leading-tight text-muted-foreground">
      {sold && <div>Sold: {sold}</div>}
      {bought && <div>Bought: {bought}</div>}
    </div>
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
    () => (params.invoiceType === "non_gst" ? "non_gst" : "gst")
  );
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [placeOfSupply, setPlaceOfSupply] = useState(customer?.state || "Maharashtra");
  const [items, setItems] = useState<BillingItem[]>([]);
  const [freight, setFreight] = useState(0);
  const [saved, setSaved] = useState(false);
  const [salesmanId, setSalesmanId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [savedInvoice, setSavedInvoice] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const savedSheetRef = useRef<HTMLDivElement>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState<"cash" | "upi" | "cheque" | "bank_transfer" | "credit">("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentDone, setPaymentDone] = useState(false);
  const [paymentSkipped, setPaymentSkipped] = useState(false);
  const [savedPayment, setSavedPayment] = useState<any>(null);
  const [accountId, setAccountId] = useState<number | null>(null);

  // ── All data hooks ──
  const { data: products } = useListProducts({ forSale: true });
  const { data: salesmanEntities } = useListEntities({ type: "salesman" } as any);
  const { data: existingInvoice } = useGetInvoice(editId as number, { query: { enabled: isEditMode } as any });
  const { data: accounts } = useListAccounts();
  const { data: printSettingsData } = useGetPrintSettings();
  const logo = useCompanyLogo();
  const printSettings = { ...(printSettingsData ?? FALLBACK_PRINT_SETTINGS), logo };
  const createInvoice = useCreateInvoice();
  const updateInvoice = useUpdateInvoice();
  const logPayment = useLogPayment();

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

  useEffect(() => {
  if (!products || items.length === 0) return;
  setItems((prev) => prev.map((item) => {
    const p = products.find((x: any) => x.id === item.productId);
    if (!p) return item;
    const newRate = isGstInvoiceType(invoiceType)
      ? Number(p.wholesalePrice)
      : (Number((p as any).nonGstPrice) > 0 ? Number((p as any).nonGstPrice) : Number(p.wholesalePrice));
    const taxPct = isGstInvoiceType(invoiceType) ? (Number(p.taxRate) || 18) : 0;
    const amount = Math.round(billedUnits(item) * newRate * (1 + taxPct / 100) * 100) / 100;
    return { ...item, rate: newRate, taxPct, amount };
  }));
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [invoiceType, products]);

  useEffect(() => {
    if (!isEditMode || !existingInvoice || prefilled) return;
    const et = existingInvoice.invoiceType as string;
    if (et === "gst" || et === "non_gst") { setDocType("invoice"); setInvoiceSubtype(et); }
    else { setDocType(et); }
    setInvoiceDate(String(existingInvoice.invoiceDate).slice(0, 10));
    setPlaceOfSupply(existingInvoice.placeOfSupply || "Maharashtra");
    setFreight(Number(existingInvoice.freight ?? 0));
    if (existingInvoice.customerId || existingInvoice.customerName) {
      setCustomer({
        id: existingInvoice.customerId, name: existingInvoice.customerName,
        gstin: existingInvoice.customerGstin, address: existingInvoice.billingAddress,
        state: existingInvoice.placeOfSupply, pricingTier: "retail", outstandingBalance: 0,
      });
    }
    setItems((existingInvoice.items ?? []).map((it: any) => {
      const prod = (products ?? []).find((x: any) => x.id === it.productId);
      return {
        productId: it.productId, name: it.productName, unit: it.unit,
        qty: Number(it.qty), qtyMode: "unit" as QtyMode, unitsPerBox: resolvePack(prod),
        rate: Number(it.rate), mrp: Number(it.mrp), taxPct: Number(it.taxPct),
        discountPct: Number(it.discountPct), discountAmt: Number(it.discountAmt),
        amount: Number(it.amount), litersPerBox: Number(prod?.litersPerBox ?? 0) || 0,
        packagingUnit: prod?.packagingUnit?.trim() || "Box",
      };
    }));
    setPrefilled(true);
  }, [isEditMode, existingInvoice, prefilled]);

  useEffect(() => {
    if (!params.cart || !products) return;
    try {
      const cartItems: { productId: number; qty: number }[] = JSON.parse(decodeURIComponent(params.cart));
      const billing: BillingItem[] = cartItems.map(({ productId, qty }) => {
        const p = products.find((x) => x.id === productId);
        if (!p) return null;
        const rate = isGstInvoiceType(invoiceType)
          ? p.wholesalePrice
          : (Number((p as any).nonGstPrice) > 0 ? Number((p as any).nonGstPrice) : p.wholesalePrice);
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
        } as BillingItem;
      }).filter(Boolean) as BillingItem[];
      setItems(billing);
    } catch { /* ignore */ }
  }, [products, params.cart]);

  useEffect(() => {
    if (paymentMode === "credit") { setAccountId(null); return; }
    const accountTypeForMode: Record<string, string> = { cash: "cash", upi: "upi", cheque: "bank", bank_transfer: "bank" };
    const matching = (accounts ?? []).filter((a) => a.isActive && a.type === accountTypeForMode[paymentMode]);
    if (matching.length === 0) { setAccountId(null); return; }
    if (!accountId || !matching.some((a) => a.id === accountId)) setAccountId(matching[0].id);
  }, [paymentMode, accounts]);

  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

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
  const accountTypeForMode: Record<string, string> = { cash: "cash", upi: "upi", cheque: "bank", bank_transfer: "bank" };
  const matchingAccounts = (accounts ?? []).filter(
    (a) => a.isActive && (paymentMode === "credit" ? false : a.type === accountTypeForMode[paymentMode]),
  );

  const filteredProducts = productSearch.trim()
    ? (products ?? []).filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase().trim())).slice(0, 12)
    : (products ?? []).slice(0, 12);

  const updateItem = (idx: number, field: keyof BillingItem, value: any) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[idx], [field]: value };
      const base = billedUnits(item) * item.rate;
      const discAmt = item.discountAmt > 0 ? item.discountAmt : (base * item.discountPct / 100);
      const taxable = base - discAmt;
      const taxAmt = isGstInvoiceType(invoiceType) ? (taxable * item.taxPct / 100) : 0;
      item.amount = Math.round((taxable + taxAmt) * 100) / 100;
      updated[idx] = item;
      return updated;
    });
  };

  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const addProduct = (p: any) => {
    const existing = items.findIndex((i) => i.productId === p.id);
    if (existing >= 0) { updateItem(existing, "qty", items[existing].qty + 1); }
    else {
      const rate = isGstInvoiceType(invoiceType)
        ? p.wholesalePrice
        : (Number((p as any).nonGstPrice) > 0 ? Number((p as any).nonGstPrice) : p.wholesalePrice);
      const taxPct = isGstInvoiceType(invoiceType) ? (Number(p.taxRate) || 18) : 0;
      const amount = Number(rate ?? 0) * (1 + taxPct / 100);
      setItems((prev) => [...prev, {
        productId: p.id, name: p.name, unit: p.unit ?? "QTY", qty: 1,
        qtyMode: "unit" as QtyMode, unitsPerBox: resolvePack(p),
        rate: Number(rate ?? 0), mrp: Number(p.mrp ?? 0), taxPct,
        discountPct: 0, discountAmt: 0,
        amount: Math.round(amount * 100) / 100,
        litersPerBox: Number((p as any).litersPerBox ?? 0) || 0,
        packagingUnit: (p as any).packagingUnit?.trim() || "Box",
      }]);
    }
    setProductSearch("");
    setSearchOpen(false);
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
  const grandTotal = subtotal + totalTax + freight;
  const roundOff = Math.round(grandTotal) - grandTotal;
  const finalTotal = Math.round(grandTotal);

  const handleSave = () => {
    if (items.length === 0) {
      toast({ title: "No items", description: "Add at least one product before saving.", variant: "destructive" });
      return;
    }
    const payload = {
      invoiceType, invoiceDate, placeOfSupply,
      customerId: customer?.id ?? undefined,
      customerName: customer?.name ?? undefined,
      customerGstin: customer?.gstin ?? undefined,
      billingAddress: customer?.address ?? undefined,
      salesmanId: salesmanId ?? undefined,
      freight, roundOff,
      items: items.map((i) => ({
        productId: i.productId, qty: billedUnits(i),
        ...(i.qtyMode === "box" && i.unitsPerBox > 0 ? { qtyBoxes: i.qty } : {}),
        ...(i.litersPerBox > 0 ? { litersPerBox: i.litersPerBox } : {}),
        unit: i.unit ?? "QTY", rate: i.rate ?? 0, mrp: i.mrp ?? 0,
        taxPct: isGstInvoiceType(invoiceType) ? i.taxPct : 0,
        discountPct: i.discountPct, discountAmt: i.discountAmt, cessPct: 0,
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
          setPaymentAmount(finalTotal);
          toast({ title: `Invoice ${invoice.invoiceNo} saved`, description: "Now record payment received." });
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

  const handleRecordPayment = () => {
    const isWalkIn = !customer?.id;
    logPayment.mutate({
      data: {
        ...(customer?.id ? { customerId: customer.id } : {}),
        amount: paymentAmount,
        mode: paymentMode as PaymentInputMode,
        ...(accountId ? { accountId } : {}),
        notes: [
          isWalkIn ? `Walk-in cash sale${savedInvoice?.invoiceNo ? ` (Invoice ${savedInvoice.invoiceNo})` : ""}` : "",
          paymentRef ? `Ref: ${paymentRef}` : "",
          paymentNotes,
        ].filter(Boolean).join(" | ") || undefined,
      },
    }, {
      onSuccess: (payment) => {
        queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        setSavedPayment(payment);
        setPaymentDone(true);
        toast({
          title: payment.status === "approved" ? "Payment recorded & approved" : "Payment logged — pending approval",
          description: payment.status === "approved"
            ? isWalkIn ? `₹${paymentAmount.toLocaleString()} recorded as walk-in ${paymentMode.toUpperCase()} sale.`
              : `₹${paymentAmount.toLocaleString()} debited from ${customer.name}'s balance.`
            : `₹${paymentAmount.toLocaleString()} logged. Admin approval required.`,
        });
      },
      onError: async (err: any) => {
        let desc = err?.message ?? "Server error";
        try { const body = err?.response ? await err.response.json() : null; if (body?.error) desc = String(body.error).slice(0, 300); } catch {}
        toast({ title: "Failed to record payment", description: desc, variant: "destructive" });
      },
    });
  };

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

  const modeIcons: Record<string, React.ReactNode> = {
    cash: <Banknote className="w-4 h-4" />, upi: <Smartphone className="w-4 h-4" />,
    cheque: <CreditCard className="w-4 h-4" />, bank_transfer: <Building2 className="w-4 h-4" />,
    credit: <Clock className="w-4 h-4" />,
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

        {savedInvoice.invoiceType === "quotation" ? (
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
        ) : !paymentDone && !paymentSkipped ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Banknote className="w-4 h-4 text-primary" /> Collect Payment
              </CardTitle>
              <CardDescription>
                {customer
                  ? `Record what ${customer.name} paid now. Admin payments are instantly credited to the ledger.`
                  : "No customer account linked. Skip if this is a cash sale."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Payment Mode</Label>
                <div className="grid grid-cols-2 gap-3">
                  {(["cash", "upi"] as const).map((mode) => (
                    <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 font-semibold transition-all
                        ${paymentMode === mode ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                      data-testid={`mode-${mode}`}>
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${paymentMode === mode ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        {modeIcons[mode]}
                      </span>
                      <div className="text-left">
                        <div className="text-base">{mode === "cash" ? "Cash" : "UPI"}</div>
                        <div className="text-xs font-normal text-muted-foreground mt-0.5">
                          {mode === "cash" ? "Instant — no reference needed" : "GPay / PhonePe / BHIM"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {(["cheque", "bank_transfer", "credit"] as const).map((mode) => (
                    <button key={mode} type="button" onClick={() => setPaymentMode(mode)}
                      className={`flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-lg border text-xs font-medium text-center transition-all
                        ${paymentMode === mode ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"}`}
                      data-testid={`mode-${mode}`}>
                      {modeIcons[mode]}
                      {mode === "bank_transfer" ? "Bank Transfer" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMode === "credit" ? (
                <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground flex items-start gap-3">
                  <Clock className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                  <div>
                    <p className="font-medium text-foreground">Selling on Credit</p>
                    <p>No payment collected now. ₹{finalTotal.toLocaleString()} will remain as outstanding balance for {customer?.name ?? "this customer"}.</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="payment-amount">Amount Received (₹)</Label>
                    <Input id="payment-amount" type="number" min={0} max={finalTotal} value={paymentAmount}
                      onChange={(e) => setPaymentAmount(Number(e.target.value))} className="text-lg font-bold" data-testid="input-payment-amount" />
                    {paymentAmount < finalTotal && paymentAmount > 0 && <p className="text-xs text-amber-500">Partial — ₹{(finalTotal - paymentAmount).toLocaleString()} outstanding</p>}
                    {paymentAmount === finalTotal && <p className="text-xs text-green-600">Full payment</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payment-ref">
                      {paymentMode === "upi" ? "UPI / Transaction ID" : paymentMode === "cheque" ? "Cheque No." : paymentMode === "bank_transfer" ? "UTR / Reference" : "Reference"}
                    </Label>
                    <Input id="payment-ref" value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="Optional" data-testid="input-payment-ref" />
                  </div>
                </div>
              )}

              {paymentMode !== "credit" && (
                <div className="space-y-2">
                  <Label htmlFor="account-select" className="flex items-center gap-2">
                    Deposit to Account
                    <span className="text-xs text-muted-foreground font-normal">
                      ({paymentMode === "cash" ? "Cash drawer" : paymentMode === "upi" ? "UPI account" : "Bank account"})
                    </span>
                  </Label>
                  {matchingAccounts.length === 0 ? (
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
                      No active {accountTypeForMode[paymentMode]} account configured. Payment will still be recorded.
                    </div>
                  ) : (
                    <Select value={accountId ? String(accountId) : ""} onValueChange={(v) => setAccountId(v ? Number(v) : null)}>
                      <SelectTrigger id="account-select" data-testid="select-account"><SelectValue placeholder="Select an account" /></SelectTrigger>
                      <SelectContent>
                        {matchingAccounts.map((a) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">{a.name}</span>
                              {a.identifier && <span className="text-xs text-muted-foreground shrink-0">({a.identifier})</span>}
                              <span className="text-xs text-muted-foreground ml-auto shrink-0">Bal: ₹{Number(a.currentBalance).toLocaleString()}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="payment-notes">Notes (optional)</Label>
                <Textarea id="payment-notes" rows={2} value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} placeholder="Any remarks..." data-testid="input-payment-notes" />
              </div>

              <div className="flex gap-3 pt-1">
                <Button className="flex-1"
                  onClick={paymentMode === "credit" ? () => setPaymentSkipped(true) : handleRecordPayment}
                  disabled={logPayment.isPending || (paymentMode !== "credit" && paymentAmount <= 0)}
                  data-testid="button-record-payment">
                  {logPayment.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : paymentMode === "credit" ? <Clock className="w-4 h-4 mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                  {paymentMode === "credit" ? "Confirm Credit Sale" : `Record ₹${paymentAmount.toLocaleString()} ${paymentMode.toUpperCase()}`}
                </Button>
                <Button variant="outline" onClick={() => setPaymentSkipped(true)} data-testid="button-skip-payment">
                  <SkipForward className="w-4 h-4 mr-1.5" /> Skip
                </Button>
              </div>
              {!customer?.id && paymentMode !== "credit" && (
                <p className="text-xs text-muted-foreground text-center">Walk-in cash sale — payment recorded under shared Walk-in Customer account.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className={paymentDone ? "border-green-500/30 bg-green-500/5" : "border-muted"}>
            <CardContent className="pt-5 pb-4">
              {paymentDone && savedPayment ? (
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-6 h-6 text-green-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{savedPayment.status === "approved" ? "Payment Applied" : "Payment Logged — Pending Approval"}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      ₹{Number(savedPayment.amount).toLocaleString()} via {savedPayment.mode.toUpperCase()}
                      {savedPayment.status === "approved" ? " — debited from outstanding balance immediately." : " — will be applied once admin approves."}
                    </p>
                    {savedPayment.status === "pending" && <Badge variant="outline" className="mt-2 text-amber-500 border-amber-500 text-[10px]">Pending Admin Approval</Badge>}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-muted-foreground">
                  <SkipForward className="w-5 h-5 shrink-0" />
                  <p className="text-sm">Payment skipped. Outstanding balance updated on invoice.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
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

  return (
    <>
    <div className="space-y-5 pb-10 print:hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => setLocation("/catalog")} data-testid="button-back-catalog">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {isEditMode ? `Edit Invoice ${existingInvoice?.invoiceNo ?? ""}` : "Create Invoice"}
          </h1>
          {isEditMode && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400 whitespace-normal text-left max-w-full">
              Editing — stock &amp; customer balance will be re-adjusted on save
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
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
          </Button>
          {isEditMode && existingInvoice && (
            <Button variant="outline" onClick={() => window.print()} data-testid="button-print-invoice">
              <Printer className="w-4 h-4 mr-2" /> Print
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <Card>
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

          <Card>
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
                <div className="space-y-1">
                  <Label className="text-xs">Freight (₹)</Label>
                  <Input type="number" min={0} value={freight} onChange={(e) => setFreight(Number(e.target.value))} data-testid="input-freight" />
                </div>
                {user?.role === "admin" && (
                  <div className="space-y-1">
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

          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between">
              <CardTitle className="text-base">Line Items</CardTitle>
              <span className="text-xs text-muted-foreground">{items.length} item{items.length !== 1 ? "s" : ""}</span>
            </CardHeader>
            <div className="px-5 pb-3 relative" ref={searchRef}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)} placeholder="Search product to add..." className="pl-9 h-9" data-testid="input-product-search" />
              </div>
              {searchOpen && (
                <div className="absolute z-50 left-5 right-5 top-full mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-lg">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No products found.</div>
                  ) : filteredProducts.map((p) => {
                    const alreadyAdded = items.some((i) => i.productId === p.id);
                    return (
                      <button key={p.id} type="button" onClick={() => addProduct(p)}
                        className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-3 text-sm border-b last:border-0"
                        data-testid={`product-option-${p.id}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">
                            ₹{Number(isGstInvoiceType(invoiceType) ? p.wholesalePrice : ((p as any).nonGstPrice > 0 ? (p as any).nonGstPrice : p.wholesalePrice)).toLocaleString()}
                            {isGstInvoiceType(invoiceType) && p.taxRate ? ` · GST ${p.taxRate}%` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {alreadyAdded && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Added</span>}
                          <Plus className="w-4 h-4 text-muted-foreground" />
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
                      <TableRow key={idx} data-testid={`billing-row-${idx}`}>
                        <TableCell>
                          <div className="font-medium text-sm leading-tight">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.unit}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <div className="flex items-center gap-1">
                              <Input type="number" min={1} step="any" value={item.qty}
                                onChange={(e) => updateItem(idx, "qty", Number(e.target.value))}
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
                          <Input type="number" min={0} value={item.rate} onChange={(e) => updateItem(idx, "rate", Number(e.target.value))}
                            className="w-24 text-right h-7 text-sm disabled:opacity-100 disabled:cursor-not-allowed"
                            data-testid={`input-rate-${idx}`} disabled={user?.role !== "admin"}
                            title={user?.role !== "admin" ? "Only admin can edit rate" : undefined} />
                          <RecentPriceHint productId={item.productId} />
                        </TableCell>
                        {isGstInvoiceType(invoiceType) && (
                          <TableCell className="text-right">
                            <Input type="number" min={0} max={28} value={item.taxPct}
                              onChange={(e) => updateItem(idx, "taxPct", Number(e.target.value))}
                              className="w-16 text-right h-7 text-sm" data-testid={`input-tax-${idx}`} />
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Input type="number" min={0} max={100} value={item.discountPct}
                            onChange={(e) => updateItem(idx, "discountPct", Number(e.target.value))}
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
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: stacked cards — the table's 8 fixed-width columns
                  (~780px) never fit a phone screen, so each line item gets
                  its own labeled block instead of a cramped row. */}
              <div className="md:hidden max-h-[500px] overflow-y-auto divide-y">
                {items.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">No items — search above to add products</div>
                ) : items.map((item, idx) => (
                  <div key={idx} className="p-4 space-y-3" data-testid={`billing-row-mobile-${idx}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm leading-tight">{item.name}</div>
                        <div className="text-xs text-muted-foreground">{item.unit}</div>
                      </div>
                      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => removeItem(idx)} data-testid={`button-remove-item-mobile-${idx}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Qty</Label>
                        <div className="flex items-center gap-1">
                          <Input type="number" min={1} step="any" value={item.qty}
                            onChange={(e) => updateItem(idx, "qty", Number(e.target.value))}
                            className="h-8 text-sm" data-testid={`input-qty-mobile-${idx}`} />
                          <Select value={item.qtyMode} onValueChange={(v) => updateItem(idx, "qtyMode", v as QtyMode)}>
                            <SelectTrigger className="h-8 w-[62px] px-2 text-xs shrink-0" data-testid={`select-qty-mode-mobile-${idx}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unit">QTY</SelectItem>
                              <SelectItem value="box" disabled={item.unitsPerBox <= 0}>{item.packagingUnit.toUpperCase()}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {item.qtyMode === "box" && item.unitsPerBox > 0 && (
                          <span className="text-[10px] text-muted-foreground block" data-testid={`hint-billed-units-mobile-${idx}`}>= {billedUnits(item).toLocaleString()} {item.unit}</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Rate (₹)</Label>
                        <Input type="number" min={0} value={item.rate} onChange={(e) => updateItem(idx, "rate", Number(e.target.value))}
                          className="h-8 text-sm disabled:opacity-100 disabled:cursor-not-allowed"
                          data-testid={`input-rate-mobile-${idx}`} disabled={user?.role !== "admin"}
                          title={user?.role !== "admin" ? "Only admin can edit rate" : undefined} />
                        <RecentPriceHint productId={item.productId} />
                      </div>
                    </div>

                    <div className={`grid gap-2 ${isGstInvoiceType(invoiceType) ? "grid-cols-3" : "grid-cols-2"}`}>
                      {isGstInvoiceType(invoiceType) && (
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Tax%</Label>
                          <Input type="number" min={0} max={28} value={item.taxPct}
                            onChange={(e) => updateItem(idx, "taxPct", Number(e.target.value))}
                            className="h-8 text-sm" data-testid={`input-tax-mobile-${idx}`} />
                        </div>
                      )}
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">Disc%</Label>
                        <Input type="number" min={0} max={100} value={item.discountPct}
                          onChange={(e) => updateItem(idx, "discountPct", Number(e.target.value))}
                          className="h-8 text-sm" data-testid={`input-discount-mobile-${idx}`} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-muted-foreground">LTR</Label>
                        <div className="h-8 flex items-center text-sm tabular-nums" data-testid={`cell-ltr-mobile-${idx}`}>
                          {(() => { const ltr = lineLiters(item); return ltr > 0 ? ltr.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—"; })()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t text-sm">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="font-bold">₹{item.amount.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
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
              {Math.abs(roundOff) > 0.001 && <div className="flex justify-between text-muted-foreground text-xs"><span>Round Off</span><span>{roundOff > 0 ? "+" : ""}₹{roundOff.toFixed(2)}</span></div>}
              <Separator />
              <div className="flex justify-between font-bold text-lg"><span>Grand Total</span><span className="text-primary">₹{finalTotal.toLocaleString()}</span></div>
              {isGstInvoiceType(invoiceType) && totalTax > 0 && (
                <div className="bg-muted/50 rounded p-3 space-y-1 text-xs">
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
          <Button className="w-full" size="lg" onClick={handleSave}
            disabled={createInvoice.isPending || updateInvoice.isPending || items.length === 0}
            data-testid="button-save-invoice-bottom">
            {(createInvoice.isPending || updateInvoice.isPending) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {isEditMode ? "Update Invoice" : "Save & Generate Invoice"}
          </Button>
          <Button variant="outline" className="w-full" onClick={() => setLocation("/catalog")} data-testid="button-back-to-catalog">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Catalog
          </Button>
        </div>
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
                  placeholder="Type customer name..."
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  autoComplete="off"
                  data-testid="input-customer-search-name"
                />
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {isNameSearching ? (
                    <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Searching...
                    </div>
                  ) : nameInput.trim().length < 1 ? (
                    <div className="p-3 text-sm text-muted-foreground">Start typing to search customers.</div>
                  ) : nameMatches.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground">No matching customer.</div>
                  ) : (
                    nameMatches.map((c: any) => (
                      <button
                        type="button"
                        key={c.id}
                        onClick={() => { onSelect(c); reset(); }}
                        className="w-full text-left px-3 py-2 rounded-md border hover:bg-accent text-sm"
                        data-testid={`option-customer-${c.id}`}
                      >
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.mobile}</div>
                      </button>
                    ))
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
