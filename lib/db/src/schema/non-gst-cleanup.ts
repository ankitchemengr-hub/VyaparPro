import { pgTable, text, serial, timestamp, integer, numeric, boolean, index, unique } from "drizzle-orm/pg-core";

// Settings → Data Management → Non-GST Data Cleanup. "Delete" here is a
// retention-safe delete: the bill row stays (invoices/purchases.deleted_at),
// so every financial total is unchanged. See artifacts/api-server/src/lib/non-gst-cleanup.ts.

// One row per company per category ("sales" | "purchase") — each category
// has its own independent schedule.
export const nonGstCleanupSettingsTable = pgTable("non_gst_cleanup_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  category: text("category").notNull(), // sales | purchase
  enabled: boolean("enabled").notNull().default(false),
  frequency: text("frequency").notNull().default("monthly"), // daily | weekly | monthly | yearly
  // A scheduled run deletes eligible bills dated more than this many days ago.
  minAgeDays: integer("min_age_days").notNull().default(90),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastJobId: integer("last_job_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("non_gst_cleanup_settings_company_category_unique").on(t.companyId, t.category),
]);

// One row per delete/restore run, manual or scheduled — the audit trail.
export const nonGstCleanupJobsTable = pgTable("non_gst_cleanup_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  category: text("category").notNull(), // sales | purchase
  trigger: text("trigger").notNull(), // manual | scheduled
  action: text("action").notNull(), // delete | restore
  dateFrom: text("date_from"), // YYYY-MM-DD, inclusive
  dateTo: text("date_to"), // YYYY-MM-DD, inclusive
  status: text("status").notNull().default("running"), // running | succeeded | failed
  eligibleCount: integer("eligible_count").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  totalValue: numeric("total_value", { precision: 14, scale: 2 }).notNull().default("0"),
  idempotencyKey: text("idempotency_key").notNull(),
  operatorUserId: integer("operator_user_id"),
  operatorName: text("operator_name"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  index("non_gst_cleanup_jobs_company_idx").on(t.companyId, t.category),
  unique("non_gst_cleanup_jobs_idempotency_unique").on(t.companyId, t.idempotencyKey),
]);

// Per-bill outcome of a job: what was deleted/restored, and what was left
// alone and why.
export const nonGstCleanupJobItemsTable = pgTable("non_gst_cleanup_job_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  jobId: integer("job_id").notNull().references(() => nonGstCleanupJobsTable.id, { onDelete: "cascade" }),
  recordId: integer("record_id").notNull(),
  recordNo: text("record_no").notNull(),
  recordDate: timestamp("record_date", { withTimezone: true }),
  partyName: text("party_name"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("0"),
  outcome: text("outcome").notNull(), // deleted | restored | excluded
  reason: text("reason"),
}, (t) => [
  index("non_gst_cleanup_job_items_job_idx").on(t.jobId),
]);

export type NonGstCleanupSettings = typeof nonGstCleanupSettingsTable.$inferSelect;
export type NonGstCleanupJob = typeof nonGstCleanupJobsTable.$inferSelect;
export type NonGstCleanupJobItem = typeof nonGstCleanupJobItemsTable.$inferSelect;
