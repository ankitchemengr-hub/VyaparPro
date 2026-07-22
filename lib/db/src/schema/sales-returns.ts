import { pgTable, text, serial, timestamp, integer, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { productsTable } from "./products";

export const salesReturnsTable = pgTable("sales_returns", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  returnNo: text("return_no").notNull(),
  returnDate: timestamp("return_date", { withTimezone: true }).notNull().defaultNow(),
  // Loose reference (no FK), matching ledger_entries/payments' existing
  // convention — a later Recycle-Bin permanent-delete of the invoice must
  // never block or corrupt this return's history.
  invoiceId: integer("invoice_id"),
  invoiceNo: text("invoice_no").notNull(),
  customerId: integer("customer_id").references(() => entitiesTable.id),
  customerName: text("customer_name"),
  reason: text("reason"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  totalTax: numeric("total_tax", { precision: 12, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("saved"), // saved, cancelled
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sales_returns_company_idx").on(t.companyId),
  index("sales_returns_invoice_idx").on(t.invoiceId),
  index("sales_returns_customer_idx").on(t.customerId),
  unique("sales_returns_company_return_no_unique").on(t.companyId, t.returnNo),
]);

export const salesReturnItemsTable = pgTable("sales_return_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  returnId: integer("return_id").notNull().references(() => salesReturnsTable.id, { onDelete: "cascade" }),
  // Loose reference back to the original invoice_items row — no FK, same
  // reasoning as sales_returns.invoiceId above.
  invoiceItemId: integer("invoice_item_id"),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("sales_return_items_company_idx").on(t.companyId),
  index("sales_return_items_return_idx").on(t.returnId),
]);

export const insertSalesReturnSchema = createInsertSchema(salesReturnsTable).omit({ id: true, createdAt: true });
export type InsertSalesReturn = z.infer<typeof insertSalesReturnSchema>;
export type SalesReturn = typeof salesReturnsTable.$inferSelect;
export type SalesReturnItem = typeof salesReturnItemsTable.$inferSelect;
