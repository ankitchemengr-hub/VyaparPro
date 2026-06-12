import { pgTable, text, serial, timestamp, integer, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  receiptId: text("receipt_id").notNull(),
  customerId: integer("customer_id").notNull().references(() => entitiesTable.id),
  customerName: text("customer_name"),
  salesmanId: integer("salesman_id"),
  salesmanName: text("salesman_name"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  mode: text("mode").notNull().default("cash"), // cash, cheque, upi, bank_transfer, other
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  notes: text("notes"),
  approvedById: integer("approved_by_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  accountId: integer("account_id"), // which account the money went into; null = held by salesman, pending collection
  collectedAt: timestamp("collected_at", { withTimezone: true }),
  collectedById: integer("collected_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("payments_company_idx").on(t.companyId),
  index("payments_customer_idx").on(t.customerId),
  index("payments_status_idx").on(t.status),
  unique("payments_company_receipt_unique").on(t.companyId, t.receiptId),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
