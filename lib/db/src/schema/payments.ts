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
  // Loose reference (no FK), matching ledger_entries/stock_movements' existing
  // convention — a later Recycle-Bin permanent-delete of the invoice must
  // never block or corrupt this payment's history.
  invoiceId: integer("invoice_id"),
  salesmanId: integer("salesman_id"),
  salesmanName: text("salesman_name"),
  // Role of the user who logged this payment (e.g. "salesman", "store",
  // "admin"). Store-user payments wait for admin acceptance in the Cash Book;
  // salesman payments keep going through the Payments page approval flow — this
  // is how the two pending queues are told apart.
  createdByRole: text("created_by_role"),
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

// One row per invoice a payment (or Cash Book Payment In) was FIFO-allocated
// against. Keyed by receiptNo rather than a payment/account_transaction id —
// both tables already share the same receipt number for a given payment
// event (see the comment on GET /payment-receipts/:receiptNo), so receiptNo
// is already this codebase's established cross-table join key; reusing it
// avoids a polymorphic sourceType/sourceId pair that could silently join to
// the wrong row (payments.id and account_transactions.id are independent
// sequences that can collide numerically).
export const paymentAllocationsTable = pgTable("payment_allocations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  receiptNo: text("receipt_no").notNull(),
  // Loose reference (no FK) for the same reason as payments.invoiceId above.
  invoiceId: integer("invoice_id"),
  invoiceNo: text("invoice_no").notNull(),
  allocatedAmount: numeric("allocated_amount", { precision: 12, scale: 2 }).notNull(),
  invoiceAmountAtAllocation: numeric("invoice_amount_at_allocation", { precision: 12, scale: 2 }).notNull(),
  previousPaidAtAllocation: numeric("previous_paid_at_allocation", { precision: 12, scale: 2 }).notNull(),
  balanceAfterAllocation: numeric("balance_after_allocation", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("payment_allocations_company_idx").on(t.companyId),
  index("payment_allocations_receipt_idx").on(t.companyId, t.receiptNo),
  index("payment_allocations_invoice_idx").on(t.invoiceId),
]);

export type PaymentAllocation = typeof paymentAllocationsTable.$inferSelect;
