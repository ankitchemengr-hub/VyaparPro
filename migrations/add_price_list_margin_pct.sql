-- Per-product margin % overrides for the Price List page's "Apply Margin"
-- tool. Deliberately separate from the existing wholesale_margin/retail_margin
-- columns, which belong to the older "Pricing Basis: Fixed Margin" feature
-- (Inventory edit form + raw-material cost cascade) and use a different
-- formula (no GST divide-back on wholesale). Null means "use the 10/15/12
-- default".
ALTER TABLE products ADD COLUMN IF NOT EXISTS non_gst_margin_pct NUMERIC(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS retail_margin_pct NUMERIC(5,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS wholesale_margin_pct NUMERIC(5,2);
