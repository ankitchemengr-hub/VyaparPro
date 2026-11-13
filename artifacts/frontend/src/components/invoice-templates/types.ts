// Shared types for the invoice template engine.
import type { ComponentType } from "react";
import type { PrintSettings as ApiPrintSettings } from "@workspace/api-client-react";

// `logo` isn't part of the print-settings API schema — it's the company
// profile's logo (a separate, per-tenant concept), merged in client-side by
// whoever renders a template so templates have one settings object to read.
// `billLogo` (the logo uploaded in Print Settings) and `nonGst` (Non-GST
// bills' own settings) are stored with the print settings but aren't in the
// generated schema either; printSettingsFor() resolves them per bill.
export type NonGstPrintSettings = Partial<ApiPrintSettings> & { enabled?: boolean; billLogo?: string | null };
export type PrintSettings = ApiPrintSettings & {
  logo?: string | null;
  billLogo?: string | null;
  nonGst?: NonGstPrintSettings | null;
};

// The settings one bill prints with: a Non-GST bill uses the Non-GST settings
// when they are turned on, and the logo is the one uploaded for that kind of
// bill in Print Settings, else the Company Profile logo.
export function printSettingsFor(settings: PrintSettings, invoiceType: string | null | undefined): PrintSettings {
  const own = invoiceType !== "gst" && settings.nonGst?.enabled ? settings.nonGst : null;
  const merged: PrintSettings = own ? { ...settings, ...own, nonGst: settings.nonGst } : settings;
  return { ...merged, logo: merged.billLogo || settings.logo || null };
}

export interface ProductMaps {
  lpbByProduct: Map<number, number>;
  upbByProduct: Map<number, number>;
  // Products ticked "Show MRP on invoice print" — their lines get an MRP column.
  mrpProducts?: Set<number>;
}

// The MRP to print on a line (the one saved on the bill), or null when its
// product isn't ticked or has no MRP.
export function printedMrp(item: any, maps: ProductMaps): number | null {
  if (!maps.mrpProducts?.has(Number(item.productId))) return null;
  const mrp = Number(item.mrp) || 0;
  return mrp > 0 ? mrp : null;
}

export interface Computed {
  items: any[];
  isGst: boolean;
  isInterstate: boolean;
  placeOfSupply: string;
  totalQty: number;
  totalLtr: number;
  totalBox: number;
  hasAnyDisc: boolean;
  roundOff: number;
}

export interface TemplateProps {
  invoice: any;
  maps: ProductMaps;
  settings: PrintSettings;
  computed: Computed;
}

export type PaperSize = "A4" | "A5";
export type Orientation = "portrait" | "landscape";

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  paper: PaperSize;
  orientation: Orientation;
  component: ComponentType<TemplateProps>;
}

// Visual theme passed to the shared building blocks so each design can restyle
// the items table / totals without duplicating the (error-prone) column logic.
export interface TemplateTheme {
  headBg: string;       // items-table header row background
  headText: string;     // items-table header text color
  rule: string;         // border color utility (e.g. "border-gray-300")
  totalRow: string;     // grand-total emphasis background
  accentText: string;   // accent color for labels/amounts
}
