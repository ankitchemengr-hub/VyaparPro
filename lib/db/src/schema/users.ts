import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("salesman"),
  name: text("name").notNull(),
  entityId: integer("entity_id"),
  // Tenant company this user belongs to. NULL only for platform super_admin.
  companyId: integer("company_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("users_company_idx").on(t.companyId),
]);

export const rolePermissionsTable = pgTable("role_permissions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  role: text("role").notNull(),
  feature: text("feature").notNull(),
  allowed: boolean("allowed").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("role_permissions_company_role_feature_uq").on(t.companyId, t.role, t.feature),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type RolePermission = typeof rolePermissionsTable.$inferSelect;
