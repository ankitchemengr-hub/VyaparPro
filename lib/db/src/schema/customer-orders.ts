import { pgTable, text, serial, integer, numeric, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const customerOrdersTable = pgTable("customer_orders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  orderNo: text("order_no"),
  userId: integer("user_id"),
  entityId: integer("entity_id"),
  customerName: text("customer_name").notNull(),
  customerMobile: text("customer_mobile"),
  status: text("status").notNull().default("pending"), // pending, production, ready_for_dispatch, dispatched, delivered, cancelled (legacy: processing, done)
  isDraft: boolean("is_draft").notNull().default(false), // salesman draft not yet submitted to admin
  totalItems: integer("total_items").notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  adminRemarks: text("admin_remarks"),
  vehicleNumber: text("vehicle_number"),
  driverName: text("driver_name"),
  dispatchDate: timestamp("dispatch_date", { withTimezone: true }),
  dispatchStatus: text("dispatch_status"), // not_dispatched, dispatched, delivered
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("customer_orders_company_idx").on(t.companyId),
  index("customer_orders_user_idx").on(t.userId),
  index("customer_orders_status_idx").on(t.status),
]);

export const customerOrderItemsTable = pgTable("customer_order_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  orderId: integer("order_id").notNull().references(() => customerOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
  productName: text("product_name").notNull(),
  unit: text("unit"),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
  workloadCardId: integer("workload_card_id"),
}, (t) => [
  index("customer_order_items_company_idx").on(t.companyId),
  index("customer_order_items_order_idx").on(t.orderId),
]);

export type CustomerOrder = typeof customerOrdersTable.$inferSelect;
export type CustomerOrderItem = typeof customerOrderItemsTable.$inferSelect;
