import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Generic key/value application settings, scoped per tenant company.
export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  key: text("key").notNull(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("app_settings_company_key_uq").on(t.companyId, t.key),
]);

// Configurable document-number series, one row per series type per company
// (invoice / order / quotation). The number is assembled from the
// enabled tokens joined by `separator`:
//   [prefix] [year] [month] [paddedSeq]
export const numberSeriesTable = pgTable("number_series", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  seriesType: text("series_type").notNull(), // invoice | order | quotation
  prefix: text("prefix").notNull().default(""),
  includeYear: boolean("include_year").notNull().default(true),
  includeMonth: boolean("include_month").notNull().default(true),
  yearFormat: text("year_format").notNull().default("calendar"), // calendar | fiscal
  separator: text("separator").notNull().default("/"),
  padding: integer("padding").notNull().default(0),
  startNumber: integer("start_number").notNull().default(1),
  nextNumber: integer("next_number").notNull().default(1),
  resetRule: text("reset_rule").notNull().default("monthly"), // never | daily | monthly | yearly | fiscal
  periodKey: text("period_key"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("number_series_company_type_uq").on(t.companyId, t.seriesType),
]);

export const insertAppSettingSchema = createInsertSchema(appSettingsTable);
export const insertNumberSeriesSchema = createInsertSchema(numberSeriesTable);
export type AppSetting = typeof appSettingsTable.$inferSelect;
export type NumberSeries = typeof numberSeriesTable.$inferSelect;
export type NumberSeriesType = "invoice" | "order" | "quotation";
