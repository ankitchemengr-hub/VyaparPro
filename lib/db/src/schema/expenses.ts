import { pgTable, text, serial, integer, numeric, boolean, timestamp, date, index, uniqueIndex } from "drizzle-orm/pg-core";

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("expense_categories_company_name_uq").on(t.companyId, t.name),
]);

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  date: date("date").notNull(),
  categoryId: integer("category_id").references(() => expenseCategoriesTable.id, { onDelete: "set null" }),
  categoryName: text("category_name").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentMode: text("payment_mode").notNull(), // cash | upi | bank
  // Which Cash Book account this expense was paid from. Nullable only for
  // rows created before this column existed; every new expense requires one
  // so it shows up as a real "out" entry in Cash Book (account_transactions).
  accountId: integer("account_id"),
  paidTo: text("paid_to"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("expenses_company_idx").on(t.companyId),
  index("expenses_date_idx").on(t.date),
  index("expenses_category_idx").on(t.categoryId),
]);

export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
