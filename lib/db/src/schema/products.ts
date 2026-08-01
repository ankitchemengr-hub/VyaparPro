import { pgTable, text, serial, timestamp, integer, boolean, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  printName: text("print_name"),
  group: text("group").notNull(),
  brand: text("brand").notNull(),
  itemCode: text("item_code").notNull(),
  unit: text("unit").notNull().default("QTY"),
  purchasePrice: numeric("purchase_price", { precision: 12, scale: 2 }).notNull().default("0"),
  retailPrice: numeric("retail_price", { precision: 12, scale: 2 }).notNull().default("0"),
  wholesalePrice: numeric("wholesale_price", { precision: 12, scale: 2 }).notNull().default("0"),
  mrp: numeric("mrp", { precision: 12, scale: 2 }).notNull().default("0"),
  minSalePrice: numeric("min_sale_price", { precision: 12, scale: 2 }),
  currentStock: numeric("current_stock", { precision: 12, scale: 3 }).notNull().default("0"),
  openingStock: numeric("opening_stock", { precision: 12, scale: 3 }),
  openingStockValue: numeric("opening_stock_value", { precision: 12, scale: 2 }),
  pricingBasis: text("pricing_basis").notNull().default("manual"),
  wholesaleMargin: numeric("wholesale_margin", { precision: 10, scale: 2 }),
  retailMargin: numeric("retail_margin", { precision: 10, scale: 2 }),
  // Per-product overrides for the Price List page's "Apply Margin" tool —
  // deliberately separate from wholesaleMargin/retailMargin above, which
  // belong to the older "Pricing Basis: Fixed Margin" feature (Inventory edit
  // form + raw-material cost cascade) and use a different formula (no GST
  // divide-back on wholesale). Null means "use the 10/15/12 default".
  nonGstMarginPct: numeric("non_gst_margin_pct", { precision: 5, scale: 2 }),
  retailMarginPct: numeric("retail_margin_pct", { precision: 5, scale: 2 }),
  wholesaleMarginPct: numeric("wholesale_margin_pct", { precision: 5, scale: 2 }),
  hsnCode: text("hsn_code"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).default("18"),
  commissionPerLiter: numeric("commission_per_liter", { precision: 12, scale: 2 }).notNull().default("0"),
  volumeUnit: text("volume_unit").notNull().default("liter"),
  litersPerBox: numeric("liters_per_box", { precision: 10, scale: 3 }),
  unitsPerBox: numeric("units_per_box", { precision: 10, scale: 3 }),
  packagingUnit: text("packaging_unit").notNull().default("Box"),
  notForSale: boolean("not_for_sale").notNull().default(false),
  addForManufacturing: boolean("add_for_manufacturing").notNull().default(false),
  minStockThreshold: numeric("min_stock_threshold", { precision: 12, scale: 3 }),
  nonGstPrice: numeric("non_gst_price", { precision: 12, scale: 2 }),
  imageUrl: text("image_url"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("products_company_idx").on(t.companyId),
  index("products_group_idx").on(t.group),
  index("products_brand_idx").on(t.brand),
  index("products_deleted_at_idx").on(t.deletedAt),
  uniqueIndex("products_company_item_code_uq").on(t.companyId, t.itemCode),
]);

export const stockMovementsTable = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  type: text("type").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  reason: text("reason").notNull(),
  referenceId: integer("reference_id"),
  referenceType: text("reference_type"),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("stock_movements_company_idx").on(t.companyId),
  index("stock_movements_product_idx").on(t.productId),
]);

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
export type StockMovement = typeof stockMovementsTable.$inferSelect;
