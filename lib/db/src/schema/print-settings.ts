import { pgTable, serial, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Per-company invoice print configuration. One row per tenant company; all the
// individual toggles / header / terms / printer fields live inside `config`
// (a typed object validated by the PrintSettings Zod schema in the API layer).
// Defaults are merged server-side so a missing row still yields a complete config.
export const printSettingsTable = pgTable("print_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  config: jsonb("config").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("print_settings_company_uq").on(t.companyId),
]);

export type PrintSettingsRow = typeof printSettingsTable.$inferSelect;
