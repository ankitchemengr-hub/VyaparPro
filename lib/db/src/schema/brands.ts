import { pgTable, text, serial, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Master list of brand names — kept separate from products.brand (still a plain
// text column there) so existing product reads/writes don't need to change.
// Products just copy the brand name string at save time; renaming a brand here
// only affects products picked from the list afterward, not past ones.
export const brandsTable = pgTable("brands", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("brands_company_idx").on(t.companyId),
  uniqueIndex("brands_company_name_uq").on(t.companyId, t.name),
]);

export const insertBrandSchema = createInsertSchema(brandsTable).omit({ id: true, createdAt: true });
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brandsTable.$inferSelect;
