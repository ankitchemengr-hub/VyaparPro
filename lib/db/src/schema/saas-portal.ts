import { pgTable, text, serial, timestamp, integer, numeric, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

// The public pricing-page catalog (Starter/Business/Professional/Enterprise) —
// a different axis from subscriptions.planName, which is the *billing cycle*
// (monthly/quarterly/half_yearly/yearly). A subscription references one of
// these by slug (subscriptions.planTier) alongside its existing cycle.
export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  priceMonthly: numeric("price_monthly", { precision: 12, scale: 2 }).notNull().default("0"),
  maxUsers: integer("max_users"),
  maxCompanies: integer("max_companies"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  trialDays: integer("trial_days").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

// Payment transaction history — subscriptions itself is one row per company
// (renewals update it in place), so this is the only place a customer's past
// payments actually live.
export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  subscriptionId: integer("subscription_id").notNull(),
  planTier: text("plan_tier").notNull(),
  billingCycle: text("billing_cycle").notNull(), // monthly, quarterly, half_yearly, yearly
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  gateway: text("gateway").notNull().default("razorpay"),
  razorpayOrderId: text("razorpay_order_id").notNull().unique(),
  // Nullable until the gateway actually reports a payment; unique so a
  // re-delivered webhook for the same payment can't double-process it.
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  razorpaySignature: text("razorpay_signature"),
  status: text("status").notNull().default("pending"), // pending, success, failed, refunded
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [
  index("subscription_payments_company_idx").on(t.companyId),
  index("subscription_payments_subscription_idx").on(t.subscriptionId),
]);

// "Book a Demo" / contact-us submissions from the public website.
export const demoRequestsTable = pgTable("demo_requests", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  businessName: text("business_name"),
  mobile: text("mobile").notNull(),
  email: text("email"),
  businessType: text("business_type"),
  numUsers: integer("num_users"),
  message: text("message"),
  status: text("status").notNull().default("new"), // new, contacted, closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Public-website FAQ accordion — DB-driven so it can change without a redeploy.
export const faqsTable = pgTable("faqs", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;
export type SubscriptionPayment = typeof subscriptionPaymentsTable.$inferSelect;
export type DemoRequest = typeof demoRequestsTable.$inferSelect;
export type Faq = typeof faqsTable.$inferSelect;
