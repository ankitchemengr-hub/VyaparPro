import { pgTable, text, serial, timestamp, integer, boolean, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";
import { entitiesTable } from "./entities";

export const rewardSchemesTable = pgTable("reward_schemes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  schemeName: text("scheme_name").notNull().default(""),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  targetLiters: numeric("target_liters", { precision: 12, scale: 3 }).notNull(),
  rewardType: text("reward_type").notNull(), // free_gift, cash_discount, percentage_cashback
  rewardValue: text("reward_value").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("reward_schemes_company_idx").on(t.companyId),
]);

export const rewardProgressTable = pgTable("reward_progress", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  schemeId: integer("scheme_id").notNull().references(() => rewardSchemesTable.id),
  customerId: integer("customer_id").notNull().references(() => entitiesTable.id),
  litersAchieved: numeric("liters_achieved", { precision: 12, scale: 3 }).notNull().default("0"),
  isRewardAchieved: boolean("is_reward_achieved").notNull().default(false),
  isDisbursed: boolean("is_disbursed").notNull().default(false),
  disbursedAt: timestamp("disbursed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("reward_progress_company_idx").on(t.companyId),
  index("reward_progress_scheme_customer_idx").on(t.schemeId, t.customerId),
]);

export const insertRewardSchemeSchema = createInsertSchema(rewardSchemesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRewardScheme = z.infer<typeof insertRewardSchemeSchema>;
export type RewardScheme = typeof rewardSchemesTable.$inferSelect;
export type RewardProgress = typeof rewardProgressTable.$inferSelect;
