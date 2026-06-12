import { pgTable, text, serial, timestamp, integer, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { productsTable } from "./products";

export const purchasesTable = pgTable("purchases", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  billNo: text("bill_no").notNull(),
  vendorBillNo: text("vendor_bill_no"),
  billDate: timestamp("bill_date", { withTimezone: true }).notNull().defaultNow(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  billType: text("bill_type").notNull().default("gst"),
  vendorId: integer("vendor_id").references(() => entitiesTable.id),
  vendorName: text("vendor_name"),
  vendorGstin: text("vendor_gstin"),
  placeOfSupply: text("place_of_supply").notNull().default("Maharashtra"),
  notes: text("notes"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDiscount: numeric("total_discount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalTax: numeric("total_tax", { precision: 12, scale: 2 }).notNull().default("0"),
  cgst: numeric("cgst", { precision: 12, scale: 2 }).notNull().default("0"),
  sgst: numeric("sgst", { precision: 12, scale: 2 }).notNull().default("0"),
  igst: numeric("igst", { precision: 12, scale: 2 }).notNull().default("0"),
  freight: numeric("freight", { precision: 12, scale: 2 }).notNull().default("0"),
  roundOff: numeric("round_off", { precision: 6, scale: 2 }).notNull().default("0"),
  grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).notNull().default("0"),
  amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
  balanceDue: numeric("balance_due", { precision: 12, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("saved"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("purchases_company_idx").on(t.companyId),
  index("purchases_vendor_idx").on(t.vendorId),
  index("purchases_date_idx").on(t.billDate),
  unique("purchases_company_bill_no_unique").on(t.companyId, t.billNo),
]);

export const purchaseItemsTable = pgTable("purchase_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  purchaseId: integer("purchase_id").notNull().references(() => purchasesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  hsnCode: text("hsn_code"),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmt: numeric("discount_amt", { precision: 12, scale: 2 }).notNull().default("0"),
  taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("purchase_items_company_idx").on(t.companyId),
  index("purchase_items_purchase_idx").on(t.purchaseId),
]);

export const purchaseSequenceTable = pgTable("purchase_sequence", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
}, (t) => [
  unique("purchase_sequence_company_month_year_unique").on(t.companyId, t.month, t.year),
]);

export const insertPurchaseSchema = createInsertSchema(purchasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPurchase = z.infer<typeof insertPurchaseSchema>;
export type Purchase = typeof purchasesTable.$inferSelect;
export type PurchaseItem = typeof purchaseItemsTable.$inferSelect;
