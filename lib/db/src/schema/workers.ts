import { pgTable, text, serial, integer, numeric, boolean, timestamp, date, index, uniqueIndex } from "drizzle-orm/pg-core";

export const workersTable = pgTable("workers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
  skill: text("skill"),
  dailyWage: numeric("daily_wage", { precision: 12, scale: 2 }).notNull().default("0"),
  joinedAt: date("joined_at"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("workers_company_idx").on(t.companyId),
  index("workers_active_idx").on(t.isActive),
]);

export const workerAttendanceTable = pgTable("worker_attendance", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  workerId: integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").notNull(), // present | absent | half_day
  wageAmount: numeric("wage_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("worker_attendance_company_idx").on(t.companyId),
  uniqueIndex("worker_attendance_worker_date_uq").on(t.workerId, t.date),
  index("worker_attendance_date_idx").on(t.date),
]);

export const workerPaymentsTable = pgTable("worker_payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  workerId: integer("worker_id").notNull().references(() => workersTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  paidOn: date("paid_on").notNull(),
  paymentMode: text("payment_mode").notNull(), // cash | upi | bank
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("worker_payments_company_idx").on(t.companyId),
  index("worker_payments_worker_idx").on(t.workerId),
  index("worker_payments_paid_on_idx").on(t.paidOn),
]);

export type Worker = typeof workersTable.$inferSelect;
export type WorkerAttendance = typeof workerAttendanceTable.$inferSelect;
export type WorkerPayment = typeof workerPaymentsTable.$inferSelect;
