CREATE TABLE IF NOT EXISTS sales_returns (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  return_no TEXT NOT NULL,
  return_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  invoice_id INTEGER,
  invoice_no TEXT NOT NULL,
  customer_id INTEGER REFERENCES entities(id),
  customer_name TEXT,
  reason TEXT,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'saved',
  created_by_user_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_returns_company_idx ON sales_returns(company_id);
CREATE INDEX IF NOT EXISTS sales_returns_invoice_idx ON sales_returns(invoice_id);
CREATE INDEX IF NOT EXISTS sales_returns_customer_idx ON sales_returns(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS sales_returns_company_return_no_unique ON sales_returns(company_id, return_no);

CREATE TABLE IF NOT EXISTS sales_return_items (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL,
  return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
  invoice_item_id INTEGER,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty NUMERIC(12,3) NOT NULL,
  unit TEXT NOT NULL,
  rate NUMERIC(12,2) NOT NULL,
  tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sales_return_items_company_idx ON sales_return_items(company_id);
CREATE INDEX IF NOT EXISTS sales_return_items_return_idx ON sales_return_items(return_id);
