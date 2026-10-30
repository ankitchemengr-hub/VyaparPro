// Single source of truth for the app's keyboard shortcuts.
//   - SHORTCUTS drives the "?" help dialog (display only).
//   - NAV_SHORTCUTS drives the Alt+<key> navigation in use-global-shortcuts.
// Keep the two in sync when adding a navigation entry.

import type { Role } from "@/lib/nav-items";

export type ShortcutGroup = "Global" | "Navigation" | "Billing" | "Books (Tally keys)";

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

export interface BooksShortcut {
  keys: string[];
  label: string;
  // A Books & Audit tab, or another page.
  tab?: string;
  path?: string;
  action?: "period" | "export" | "import" | "accept";
  // Not for the read-only CA login (it opens a page that changes data).
  writes?: boolean;
}

export const BOOKS_SHORTCUTS: BooksShortcut[] = [
  { keys: ["F4"], label: "Contra", tab: "contra" },
  { keys: ["F5"], label: "Payment (Cash Book)", path: "/cashbook", writes: true },
  { keys: ["F6"], label: "Receipt (Cash Book)", path: "/cashbook", writes: true },
  { keys: ["F7"], label: "Journal", tab: "journal" },
  { keys: ["F8"], label: "Sales (new bill)", path: "/billing", writes: true },
  { keys: ["F9"], label: "Purchase", path: "/purchases", writes: true },
  { keys: ["Ctrl", "F8"], label: "Credit Note", tab: "credit-note", writes: true },
  { keys: ["Ctrl", "F9"], label: "Debit Note", tab: "debit-note", writes: true },
  { keys: ["Alt", "F2"], label: "Change period", action: "period" },
  { keys: ["Ctrl", "A"], label: "Accept (save) the Journal", action: "accept", writes: true },
  { keys: ["Alt", "E"], label: "Export to Tally XML", action: "export" },
  { keys: ["Alt", "O"], label: "Import from Tally XML", action: "import", writes: true },
  { keys: ["T"], label: "Trial Balance", tab: "trial-balance" },
  { keys: ["P"], label: "Profit & Loss", tab: "profit-loss" },
  { keys: ["B"], label: "Balance Sheet", tab: "balance-sheet" },
  { keys: ["D"], label: "Day Book", tab: "day-book" },
  { keys: ["L"], label: "Ledgers", tab: "ledgers" },
  { keys: ["A"], label: "Audit trail", tab: "audit-trail" },
];

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
  { keys: ["Alt", "T"], label: "Jump to bill discount (or Enter on an empty product search)", group: "Billing" },
  { keys: ["Alt", "Del"], label: "Remove the focused line", group: "Billing" },
  { keys: ["Ctrl", "S"], label: "Save & generate the invoice", group: "Billing" },

  // Books & Audit page only — the same keys as Tally (see components/books-tally.tsx).
  ...BOOKS_SHORTCUTS.map((b): ShortcutDoc => ({ keys: b.keys, label: b.label, group: "Books (Tally keys)" })),
];
