import { pgTable, text, serial, timestamp, integer, numeric, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { productsTable } from "./products";

// A printable slip recording raw material sent from Store to Manufacturing
// (or vice versa). Purely a paper-trail log — this app tracks one stock
// number per product (no separate location-wise stock), so creating a
// transfer does NOT adjust product.currentStock.
export const materialTransfersTable = pgTable("material_transfers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  transferNo: text("transfer_no").notNull(),
  transferDate: timestamp("transfer_date", { withTimezone: true }).notNull().defaultNow(),
  sentBy: text("sent_by"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("material_transfers_company_idx").on(t.companyId),
  index("material_transfers_date_idx").on(t.transferDate),
  unique("material_transfers_company_transfer_no_unique").on(t.companyId, t.transferNo),
]);

export const materialTransferItemsTable = pgTable("material_transfer_items", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  transferId: integer("transfer_id").notNull().references(() => materialTransfersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  qty: numeric("qty", { precision: 12, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("material_transfer_items_company_idx").on(t.companyId),
  index("material_transfer_items_transfer_idx").on(t.transferId),
]);

export const materialTransferSequenceTable = pgTable("material_transfer_sequence", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  lastNumber: integer("last_number").notNull().default(0),
}, (t) => [
  unique("material_transfer_sequence_company_unique").on(t.companyId),
]);

export const insertMaterialTransferSchema = createInsertSchema(materialTransfersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMaterialTransfer = z.infer<typeof insertMaterialTransferSchema>;
export type MaterialTransfer = typeof materialTransfersTable.$inferSelect;
export type MaterialTransferItem = typeof materialTransferItemsTable.$inferSelect;
