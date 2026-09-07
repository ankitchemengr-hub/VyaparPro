// Single source of truth for the app's keyboard shortcuts.
//   - SHORTCUTS drives the "?" help dialog (display only).
//   - NAV_SHORTCUTS drives the Alt+<key> navigation in use-global-shortcuts.
// Keep the two in sync when adding a navigation entry.

import type { Role } from "@/lib/nav-items";

export type ShortcutGroup = "Global" | "Navigation" | "Billing";

export interface ShortcutDoc {
  keys: string[];
  label: string;
  group: ShortcutGroup;
}

export interface NavShortcut {
  // event.code (layout-independent) — Alt can emit diacritics via event.key.
  code: string;
  keyLabel: string;
  path: string;
  roles?: Role[];
}

export const NAV_SHORTCUTS: NavShortcut[] = [
  { code: "KeyH", keyLabel: "H", path: "/", roles: ["admin"] },
  { code: "KeyB", keyLabel: "B", path: "/billing", roles: ["admin", "store"] },
  { code: "KeyI", keyLabel: "I", path: "/invoices", roles: ["admin", "salesman", "accountant", "store"] },
  { code: "KeyP", keyLabel: "P", path: "/purchases", roles: ["admin", "accountant", "store"] },
  { code: "KeyL", keyLabel: "L", path: "/price-list", roles: ["admin"] },
  { code: "KeyM", keyLabel: "M", path: "/menu" },
];

const NAV_LABEL: Record<string, string> = {
  "/": "Go to Dashboard",
  "/billing": "Go to Billing",
  "/invoices": "Go to Invoices",
  "/purchases": "Go to Purchases",
  "/price-list": "Go to Price List",
  "/menu": "Go to Menu",
};

export const SHORTCUTS: ShortcutDoc[] = [
  { keys: ["Ctrl", "K"], label: "Open the command palette", group: "Global" },
  { keys: ["?"], label: "Show this shortcuts list", group: "Global" },
  { keys: ["Esc"], label: "Close a dialog or dropdown", group: "Global" },

  ...NAV_SHORTCUTS.map((n): ShortcutDoc => ({
    keys: ["Alt", n.keyLabel],
    label: NAV_LABEL[n.path] ?? n.path,
    group: "Navigation",
  })),

  { keys: ["/"], label: "Focus the product search", group: "Billing" },
  { keys: ["Alt", "N"], label: "Add a line (focus product search)", group: "Billing" },
  { keys: ["↑", "↓"], label: "Move through the product / customer list", group: "Billing" },
  { keys: ["Enter"], label: "Add the highlighted product · move to next field", group: "Billing" },
  { keys: ["Alt", "C"], label: "Change customer", group: "Billing" },
  { keys: ["Alt", "Del"], label: "Remove the focused line", group: "Billing" },
  { keys: ["Ctrl", "S"], label: "Save & generate the invoice", group: "Billing" },
];
