import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Package,
  Users,
  CreditCard,
  Award,
  Factory,
  BarChart3,
  Settings,
  Wallet,
  HandCoins,
  Scale,
  KeyRound,
  Truck,
  HardHat,
  Receipt,
  ClipboardList,
  ClipboardCheck,
  Inbox,
  BadgeIndianRupee,
  LayoutGrid,
  DatabaseBackup,
  RotateCcw,
  Tag,
  Tags,
  BookOpen,
  BookOpenCheck,
  Undo2,
  Sparkles,
  History,
  PhoneCall,
  PackagePlus,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";

export type Role = "super_admin" | "admin" | "salesman" | "store" | "manufacturing" | "accountant" | "gst_accountant" | "customer" | "counter";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  description?: string;
  /** For non-admin roles: also needs this Settings > Permissions feature on. */
  feature?: string;
  /** Hidden from a platform super_admin even while switched into a company
   *  (hasRole otherwise lets it see every admin item). */
  noSuperAdmin?: boolean;
}

// Top-level items always shown in the sidebar.
export const topNavItems: NavItem[] = [
  { name: "Platform Console", href: "/subscriptions", icon: BadgeIndianRupee, roles: ["super_admin"] },
  { name: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin"] },
  { name: "Invoices", href: "/invoices", icon: FileText, roles: ["admin", "salesman", "accountant", "gst_accountant", "store"] },
  // Straight to a new bill, without going through Menu.
  { name: "Billing", href: "/billing", icon: Receipt, roles: ["admin", "store"] },
  { name: "Menu", href: "/menu", icon: LayoutGrid, roles: ["admin", "salesman", "store", "manufacturing", "accountant", "gst_accountant", "customer", "counter"] },
  { name: "Catalog", href: "/catalog", icon: ShoppingCart, roles: ["admin", "salesman", "store", "manufacturing", "customer", "counter"] },
  { name: "My Statement", href: "/my-statement", icon: FileText, roles: ["customer"] },
  { name: "My Orders", href: "/my-orders", icon: ClipboardList, roles: ["customer", "salesman"] },
];

// All operational modules, shown as a grid on the Menu page.
export const moduleNavItems: NavItem[] = [
  { name: "My Orders", href: "/my-orders", icon: ClipboardList, roles: ["customer", "salesman"], description: "Track your placed orders" },
  { name: "My Statement", href: "/my-statement", icon: FileText, roles: ["customer"], description: "View your balance and transaction history" },
  { name: "Customer Orders", href: "/customer-orders", icon: Inbox, roles: ["admin", "store", "manufacturing"], description: "Manage incoming orders" },
  { name: "My Dashboard", href: "/salesman-dashboard", icon: LayoutDashboard, roles: ["salesman"], description: "My commission and sales overview" },
  { name: "Billing", href: "/billing", icon: FileText, roles: ["admin", "store"], description: "Create GST / non-GST invoices" },
  { name: "Invoices", href: "/invoices", icon: FileText, roles: ["admin", "salesman", "accountant", "gst_accountant", "store"], description: "Browse and print invoices" },
  { name: "Sales Return", href: "/sales-return", icon: Undo2, roles: ["admin", "salesman", "accountant", "store"], description: "Search a bill and process a return" },
  { name: "Quotations", href: "/quotations", icon: ClipboardList, roles: ["admin", "salesman", "accountant"], description: "Browse and manage quotations" },
  { name: "Inventory", href: "/inventory", icon: Package, roles: ["admin", "store"], description: "Products and stock" },
  { name: "Item Register", href: "/item-register", icon: History, roles: ["admin", "store", "accountant"], description: "Purchase, sale and adjustment movement for one item over a date range" },
  { name: "Brands", href: "/brands", icon: Tags, roles: ["admin", "store"], description: "Manage the brand list used when adding products" },
  { name: "Stock Adjustment", href: "/stock-adjustment", icon: ClipboardCheck, roles: ["admin"], description: "Physical stock reconciliation and adjustments" },
  { name: "Customers", href: "/customers", icon: Users, roles: ["admin", "salesman", "accountant"], description: "Customer directory and ledgers" },
  { name: "Inactive Customers", href: "/customers/inactive", icon: PhoneCall, roles: ["admin", "salesman", "accountant"], description: "Customers with no order in a while — contact them and log a remark" },
  { name: "Khatabook", href: "/khatabook", icon: BookOpen, roles: ["admin", "accountant"], description: "Customer and supplier balances at a glance" },
  { name: "Supplier Settle", href: "/supplier-settle", icon: Scale, roles: ["admin"], noSuperAdmin: true, description: "Each supplier's material sold, money collected for it, and what to pay them now" },
  { name: "Payments", href: "/payments", icon: CreditCard, roles: ["admin", "salesman", "accountant", "gst_accountant"], description: "Collections and approvals" },
  { name: "Commission", href: "/commission", icon: BadgeIndianRupee, roles: ["admin", "accountant", "salesman"], description: "Salesman commission report" },
  { name: "Cash Book", href: "/cashbook", icon: HandCoins, roles: ["admin", "accountant"], description: "Daily cash movements" },
  { name: "Accounts", href: "/accounts", icon: Wallet, roles: ["admin", "accountant"], description: "Bank and cash accounts" },
  { name: "Rewards", href: "/rewards", icon: Award, roles: ["admin", "customer"], description: "Volume reward schemes" },
  { name: "Production Received", href: "/material-received", icon: PackagePlus, roles: ["store"], feature: "material_receive", description: "Goods received from manufacturing (not a purchase)" },
  { name: "Manufacturing", href: "/manufacturing", icon: Factory, roles: ["admin", "manufacturing"], description: "Production workload" },
  { name: "Bill of Materials", href: "/bom", icon: FileText, roles: ["admin"], description: "BOM master" },
  { name: "Auto Manufacturing", href: "/auto-manufacture", icon: Factory, roles: ["admin"], description: "Made products never go negative on sale; fix existing negative stock" },
  { name: "Purchases", href: "/purchases", icon: Truck, roles: ["admin", "accountant", "gst_accountant", "store"], description: "Purchase bills" },
  { name: "Smart Order", href: "/smart-order", icon: Sparkles, roles: ["admin", "accountant", "store"], description: "Low-stock items ranked by sales pace, with a suggested reorder qty" },
  { name: "Workers", href: "/workers", icon: HardHat, roles: ["admin", "accountant"], description: "Worker attendance" },
  { name: "Expenses", href: "/expenses", icon: Receipt, roles: ["admin", "accountant"], description: "Business expenses" },
  { name: "Reports", href: "/reports", icon: BarChart3, roles: ["admin", "accountant", "gst_accountant"], description: "Sales, tax, P&L reports" },
  { name: "Books & Audit", href: "/books-audit", icon: BookOpenCheck, roles: ["admin", "accountant", "gst_accountant"], description: "GST books: Trial Balance, P&L, Balance Sheet, Day Book, audit trail and Tally import / export" },
  { name: "Subscriptions", href: "/subscriptions", icon: BadgeIndianRupee, roles: ["super_admin"], description: "Tenant subscriptions" },
  { name: "Price List", href: "/price-list", icon: Tag, roles: ["admin"], description: "Edit product pricing in bulk" },
  { name: "User Accounts", href: "/users", icon: KeyRound, roles: ["admin"], description: "Manage logins" },
  { name: "Settings", href: "/settings", icon: Settings, roles: ["admin"], description: "Role permissions and config" },
  { name: "Backup & Restore", href: "/backup-restore", icon: DatabaseBackup, roles: ["admin"], description: "Backup, restore and reset data" },
  { name: "Bill Payment Sync", href: "/payment-sync", icon: RefreshCw, roles: ["admin"], description: "Mark bills paid to match party balances (Khatabook / Cash Book payments)" },
  { name: "Recycle Bin", href: "/recycle-bin", icon: RotateCcw, roles: ["admin"], description: "Cancelled invoices — permanently delete or review" },
];

// Where a "go home" link should send each role — Dashboard ("/") is
// admin-only, so anyone else needs a real destination they actually have
// access to instead of bouncing straight back through another redirect.
export function homePathForRole(role: Role | undefined): string {
  if (role === "admin") return "/";
  if (role === "super_admin") return "/subscriptions";
  if (role === "accountant" || role === "gst_accountant") return "/menu";
  if (role === "customer") return "/home";
  return "/catalog";
}
