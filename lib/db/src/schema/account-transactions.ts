import { pgTable, text, serial, timestamp, integer, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const accountTransactionsTable = pgTable("account_transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  receiptNo: text("receipt_no"),
  accountId: integer("account_id").notNull().references(() => accountsTable.id),
  direction: text("direction").notNull(), // 'in' | 'out'
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  mode: text("mode").notNull().default("cash"), // cash, upi, bank_transfer, cheque, other
  partyName: text("party_name"),
  partyMobile: text("party_mobile"),
  partyEntityId: integer("party_entity_id"),
  notes: text("notes"),
  createdById: integer("created_by_id"),
  createdByName: text("created_by_name"),
  createdByRole: text("created_by_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("acct_txn_company_idx").on(t.companyId),
  index("acct_txn_account_idx").on(t.accountId),
  index("acct_txn_direction_idx").on(t.direction),
  index("acct_txn_created_idx").on(t.createdAt),
  unique("acct_txn_company_receipt_unique").on(t.companyId, t.receiptNo),
]);

export const insertAccountTransactionSchema = createInsertSchema(accountTransactionsTable).omit({ id: true, createdAt: true, receiptNo: true });
export type InsertAccountTransaction = z.infer<typeof insertAccountTransactionSchema>;
export type AccountTransaction = typeof accountTransactionsTable.$inferSelect;
