// Central, single-source-of-truth list of company-scoped business tables.
//
// Backup (this batch) reads every one of these with `WHERE company_id = $1`.
// Restore and Reset (later batches) will reuse this same ordered list so the
// three operations can never drift apart.
//
// Every table listed here has been verified to carry a `company_id` column, so a
// plain per-company SELECT is always tenant-safe. Platform/tenant-management
// tables (companies, subscriptions, subscription_alerts) are deliberately
// EXCLUDED — they are not a single company's business data. The backup module's
// own tables (backups, backup_settings) are also excluded; backup history is not
// itself part of a data backup.
//
// Order matters for the later restore/reset batches (parents before children for
// inserts, the reverse for deletes), so the list is grouped masters → children →
// transactions to make that future ordering obvious.
export const COMPANY_TABLES = [
  // Masters
  "users",
  "role_permissions",
  "products",
  "entities",
  "accounts",
  "workers",
  "expense_categories",
  "reward_schemes",
  "boms",
  "number_series",
  "app_settings",
  "print_settings",
  // Sequences (per-company counters)
  "invoice_sequence",
  "purchase_sequence",
  // Children of masters
  "bom_items",
  "reward_progress",
  "worker_attendance",
  "worker_payments",
  // Transactions
  "invoices",
  "invoice_items",
  "purchases",
  "purchase_items",
  "customer_orders",
  "customer_order_items",
  "workload_cards",
  "payments",
  "stock_movements",
  "ledger_entries",
  "account_transactions",
  "capital_snapshots",
  "expenses",
  // History
  "audit_log",
] as const;

export type CompanyTable = (typeof COMPANY_TABLES)[number];

// Tables deliberately PRESERVED by a "Reset" (wipe-to-start-fresh). We keep the
// account usable after a reset: the logins (users), the feature-permission matrix
// (role_permissions) and the company configuration (app_settings, print_settings).
// Everything else in COMPANY_TABLES — products, parties, all transactions, the
// per-company number sequences and the audit history — is cleared.
export const RESET_PRESERVE: readonly CompanyTable[] = [
  "users",
  "role_permissions",
  "app_settings",
  "print_settings",
] as const;
