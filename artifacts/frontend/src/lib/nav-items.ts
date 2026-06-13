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
  KeyRound,
  Truck,
  HardHat,
  Receipt,
  ClipboardList,
  Inbox,
  BadgeIndianRupee,
  LayoutGrid,
  DatabaseBackup,
  Tag,
  type LucideIcon,
} from "lucide-react";

export type Role = "super_admin" | "admin" | "salesman" | "store" | "manufacturing" | "accountant" | "customer";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  roles: Role[];
  description?: string;
}

// Top-level items always shown in the sidebar.
export const topNavItems: NavItem[] = [
  { name: "Platform Console", href: "/subscriptions", icon: BadgeIndianRupee, roles: ["super_admin"] },
  { name: "Dashboard", href: "/", icon: LayoutDashboard, roles: ["admin", "accountant"] },
  { name: "Menu", href: "/menu", icon: LayoutGrid, roles: ["admin", "salesman", "store", "manufacturing", "accountant", "customer"] },
  { name: "Catalog", href: "/catalog", icon: ShoppingCart, roles: ["admin", "salesman", "store", "manufacturing", "customer"] },
];

// All operational modules, shown as a grid on the Menu page.
export const moduleNavItems: NavItem[] = [
  { name: "My Orders", href: "/my-orders", icon: ClipboardList, roles: ["customer"], description: "Track your placed orders" },
  { name: "Customer Orders", href: "/customer-orders", icon: Inbox, roles: ["admin"], description: "Manage incoming orders" },
  { name: "Salesman Orders", href: "/salesman-orders", icon: ClipboardList, roles: ["salesman"], description: "Create and submit orders" },
  { name: "Billing", href: "/billing", icon: FileText, roles: ["admin", "salesman"], description: "Create GST / non-GST invoices" },
  { name: "Invoices", href: "/invoices", icon: FileText, roles: ["admin", "salesman", "accountant"], description: "Browse and print invoices" },
  { name: "Inventory", href: "/inventory", icon: Package, roles: ["admin", "store"], description: "Products and stock" },
  { name: "Customers", href: "/customers", icon: Users, roles: ["admin", "salesman", "accountant"], description: "Customer directory and ledgers" },
  { name: "Payments", href: "/payments", icon: CreditCard, roles: ["admin", "salesman", "accountant"], description: "Collections and approvals" },
  { name: "Commission", href: "/commission", icon: BadgeIndianRupee, roles: ["admin", "accountant", "salesman"], description: "Salesman commission report" },
  { name: "Cash Book", href: "/cashbook", icon: HandCoins, roles: ["admin", "accountant"], description: "Daily cash movements" },
  { name: "Accounts", href: "/accounts", icon: Wallet, roles: ["admin", "accountant"], description: "Bank and cash accounts" },
  { name: "Rewards", href: "/rewards", icon: Award, roles: ["admin", "customer"], description: "Volume reward schemes" },
  { name: "Manufacturing", href: "/manufacturing", icon: Factory, roles: ["admin", "manufacturing"], description: "Production workload" },
  { name: "Bill of Materials", href: "/bom", icon: FileText, roles: ["admin"], description: "BOM master" },
  { name: "Purchases", href: "/purchases", icon: Truck, roles: ["admin", "accountant", "store"], description: "Purchase bills" },
  { name: "Workers", href: "/workers", icon: HardHat, roles: ["admin", "accountant"], description: "Worker attendance" },
  { name: "Expenses", href: "/expenses", icon: Receipt, roles: ["admin", "accountant"], description: "Business expenses" },
  { name: "Reports", href: "/reports", icon: BarChart3, roles: ["admin", "accountant"], description: "Sales, tax, P&L reports" },
  { name: "Subscriptions", href: "/subscriptions", icon: BadgeIndianRupee, roles: ["super_admin"], description: "Tenant subscriptions" },
  { name: "Price List", href: "/price-list", icon: Tag, roles: ["admin"], description: "Edit product pricing in bulk" },
  { name: "User Accounts", href: "/users", icon: KeyRound, roles: ["admin"], description: "Manage logins" },
  { name: "Settings", href: "/settings", icon: Settings, roles: ["admin"], description: "Role permissions and config" },
  { name: "Backup & Restore", href: "/backup-restore", icon: DatabaseBackup, roles: ["admin"], description: "Backup, restore and reset data" },
];
