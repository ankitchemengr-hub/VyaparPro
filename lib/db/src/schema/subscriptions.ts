import { pgTable, text, serial, timestamp, integer, numeric, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A tenant company/client that subscribes to the ERP.
export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerName: text("owner_name"),
  mobile: text("mobile"),
  email: text("email"),
  // Optional brand logo shown on the login screen in dedicated-company mode.
  // Stored as a base64 data URL (same convention as other uploaded images).
  logo: text("logo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// One subscription record per company (the active/most recent one drives access).
export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  planName: text("plan_name").notNull(), // monthly, quarterly, half_yearly, yearly
  subscriptionStartDate: timestamp("subscription_start_date", { withTimezone: true }).notNull(),
  subscriptionEndDate: timestamp("subscription_end_date", { withTimezone: true }).notNull(),
  subscriptionAmount: numeric("subscription_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paymentStatus: text("payment_status").notNull().default("pending"), // paid, pending, overdue
  subscriptionStatus: text("subscription_status").notNull().default("active"), // active, expired, suspended
  lastPaymentDate: timestamp("last_payment_date", { withTimezone: true }),
  nextDueDate: timestamp("next_due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // One subscription record per company — renew/plan-change update this row in place.
  uniqueIndex("subscription_company_unique").on(t.companyId),
]);

// Automated expiry/renewal alerts produced by the daily scheduler.
export const subscriptionAlertsTable = pgTable("subscription_alerts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  subscriptionId: integer("subscription_id").notNull(),
  alertType: text("alert_type").notNull(), // expiry_30, expiry_15, expiry_7, expiry_3, expiry_today, expired
  message: text("message").notNull(),
  daysRemaining: integer("days_remaining").notNull().default(0),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("subscription_alert_sub_idx").on(t.subscriptionId),
  // Each alert type fires at most once per subscription — keeps scheduler reruns idempotent.
  uniqueIndex("subscription_alert_type_unique").on(t.subscriptionId, t.alertType),
]);

export const insertCompanySchema = createInsertSchema(companiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Company = typeof companiesTable.$inferSelect;
export type Subscription = typeof subscriptionsTable.$inferSelect;
export type SubscriptionAlert = typeof subscriptionAlertsTable.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
