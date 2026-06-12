import { pgTable, text, serial, timestamp, integer, boolean, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { productsTable } from "./products";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  invoiceNo: text("invoice_no").notNull(),
  invoiceDate: timestamp("invoice_date", { withTimezone: true }).notNull().defaultNow(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  invoiceType: text("invoice_type").notNull().default("gst"), // gst, non_gst
  customerId: integer("customer_id").references(() => entitiesTable.id),
  customerName: text("customer_name"),
  customerGstin: text("customer_gstin"),
  billingAddress: text("billing_address"),
  shippingAddress: text("shipping_address"),
  placeOfSupply: text("place_of_supply").notNull().default("Maharashtra"),
  salesmanId: integer("salesman_id"),
  salesmanName: text("salesman_name"),
  poNumber: text("po_number"),
  eWayBillNo: text("e_way_bill_no"),
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
  status: text("status").notNull().default("saved"), // draft, saved, cancelled
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("invoices_company_idx").on(t.companyId),
  index("invoices_customer_idx").on(t.customerId),
  index("invoices_salesman_idx").on(t.salesmanId),
  index("invoices_date_idx").on(t.invoiceDate),
  unique("invoices_company_invoice_no_unique").on(t.companyId, t.invoiceNo),
]);

export const invoiceItemsTable = pgTable("invoice_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  hsnCode: text("hsn_code"),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  qtyBoxes: numeric("qty_boxes", { precision: 12, scale: 3 }),
  totalLiters: numeric("total_liters", { precision: 12, scale: 3 }),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 12, scale: 2 }).notNull(),
  mrp: numeric("mrp", { precision: 12, scale: 2 }).notNull().default("0"),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  discountAmt: numeric("discount_amt", { precision: 12, scale: 2 }).notNull().default("0"),
  taxPct: numeric("tax_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  cessPct: numeric("cess_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  netPrice: numeric("net_price", { precision: 12, scale: 2 }).notNull().default("0"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("invoice_items_company_idx").on(t.companyId),
  index("invoice_items_invoice_idx").on(t.invoiceId),
]);

export const invoiceSequenceTable = pgTable("invoice_sequence", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
}, (t) => [
  unique("invoice_sequence_company_month_year_unique").on(t.companyId, t.month, t.year),
]);

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceItem = typeof invoiceItemsTable.$inferSelect;
