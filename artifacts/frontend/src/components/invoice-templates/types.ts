// Shared types for the invoice template engine.
import type { ComponentType } from "react";
import type { PrintSettings } from "@workspace/api-client-react";

export type { PrintSettings };

export interface ProductMaps {
  lpbByProduct: Map<number, number>;
  upbByProduct: Map<number, number>;
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
