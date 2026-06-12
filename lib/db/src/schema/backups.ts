import { pgTable, serial, integer, text, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// Per-company automatic-backup cadence preferences. One row per tenant company.
// The toggles only persist the preference; the scheduler that acts on them (and
// the object-storage write) is delivered in a later batch. `last_*_at` tracks the
// most recent successful run for each cadence so the scheduler can decide what is
// due without re-reading backup history.
export const backupSettingsTable = pgTable("backup_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  dailyEnabled: boolean("daily_enabled").notNull().default(false),
  weeklyEnabled: boolean("weekly_enabled").notNull().default(false),
  monthlyEnabled: boolean("monthly_enabled").notNull().default(false),
  lastDailyAt: timestamp("last_daily_at", { withTimezone: true }),
  lastWeeklyAt: timestamp("last_weekly_at", { withTimezone: true }),
  lastMonthlyAt: timestamp("last_monthly_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("backup_settings_company_uq").on(t.companyId),
]);

// Backup history. One row per generated backup. `storage_key` is the object-storage
// key for automatic backups; it is NULL for manual backups, which stream straight
// to the admin's browser and are not retained server-side. `table_counts` records
// the row count per exported table at backup time for the history view.
export const backupsTable = pgTable("backups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  type: text("type").notNull(), // 'manual' | 'daily' | 'weekly' | 'monthly'
  tableCounts: jsonb("table_counts").notNull().default({}),
  createdBy: integer("created_by").notNull(),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("backups_company_idx").on(t.companyId),
  index("backups_created_at_idx").on(t.createdAt),
]);

export type BackupSettingsRow = typeof backupSettingsTable.$inferSelect;
export type BackupRow = typeof backupsTable.$inferSelect;
