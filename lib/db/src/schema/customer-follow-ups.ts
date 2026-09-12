import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { entitiesTable } from "./entities";

// One row per contact attempt logged against a customer flagged as inactive
// (no invoice within the configured threshold) — see the
// inactive_customer_days_threshold app_settings key. History, not a single
// overwritable field, so past follow-ups stay visible.
export const customerFollowUpsTable = pgTable("customer_follow_ups", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  customerId: integer("customer_id").notNull().references(() => entitiesTable.id),
  remark: text("remark").notNull(),
  createdByUserId: integer("created_by_user_id"),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("customer_follow_ups_company_idx").on(t.companyId),
  index("customer_follow_ups_customer_idx").on(t.customerId),
]);

export type CustomerFollowUp = typeof customerFollowUpsTable.$inferSelect;
