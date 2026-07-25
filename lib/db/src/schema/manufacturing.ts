import { pgTable, text, serial, timestamp, integer, numeric, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

export const bomsTable = pgTable("boms", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  finishedProductId: integer("finished_product_id").notNull().references(() => productsTable.id),
  outputQuantity: numeric("output_quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("boms_company_idx").on(t.companyId),
]);

export const bomItemsTable = pgTable("bom_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  bomId: integer("bom_id").notNull().references(() => bomsTable.id, { onDelete: "cascade" }),
  materialProductId: integer("material_product_id").notNull().references(() => productsTable.id),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bom_items_company_idx").on(t.companyId),
  index("bom_items_bom_idx").on(t.bomId),
]);

export const workloadCardsTable = pgTable("workload_cards", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  targetQty: numeric("target_qty", { precision: 12, scale: 3 }).notNull(),
  status: text("status").notNull().default("pending"), // pending, processing, done
  workerId: integer("worker_id"),
  workerName: text("worker_name"),
  orderType: text("order_type").notNull().default("manual_order"), // low_stock_alert, manual_order, customer_backorder
  referenceOrderId: integer("reference_order_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("workload_company_idx").on(t.companyId),
  index("workload_status_idx").on(t.status),
]);

// A batch of finished goods that has come off an assembly run but hasn't
// been moved into sellable stock yet — assembling debits raw materials right
// away (they're physically consumed), but the output sits here as "ready to
// dispatch" until an admin/manufacturing user sends it to Store via the
// dispatch action below, which is the point stock actually gets credited.
// This gives admins a chance to correct a mis-entered qty (the Adjust
// button) before it becomes real, sellable inventory.
export const readyMaterialBatchesTable = pgTable("ready_material_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  bomId: integer("bom_id").references(() => bomsTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  unit: text("unit").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  batches: numeric("batches", { precision: 12, scale: 3 }).notNull().default("1"),
  workerId: integer("worker_id"),
  workerName: text("worker_name").notNull(),
  status: text("status").notNull().default("ready"), // ready | dispatched
  adjustmentReason: text("adjustment_reason"),
  materialTransferId: integer("material_transfer_id"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  workloadCardId: integer("workload_card_id"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ready_material_batches_company_idx").on(t.companyId),
  index("ready_material_batches_status_idx").on(t.status),
]);

export const insertBomSchema = createInsertSchema(bomsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBom = z.infer<typeof insertBomSchema>;
export type Bom = typeof bomsTable.$inferSelect;
export type BomItem = typeof bomItemsTable.$inferSelect;
export type WorkloadCard = typeof workloadCardsTable.$inferSelect;
export type ReadyMaterialBatch = typeof readyMaterialBatchesTable.$inferSelect;
