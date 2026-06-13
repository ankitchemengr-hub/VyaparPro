# Production Manager → Auth Fixer ERP — Migration Guide

This document describes how to import all data from the old Production Manager into
this new multi-tenant ERP once you are ready to migrate.

---

## Prerequisites

- Access to the old Production Manager's PostgreSQL database (or a pg_dump backup)
- The new ERP's `DATABASE_URL` environment variable
- `psql` or any PostgreSQL client

---

## Phase 1 — Schema compatibility check

Run this against the new database to confirm all target tables exist:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected tables in the new schema:
`companies`, `subscriptions`, `users`, `products`, `entities`, `invoices`,
`invoice_items`, `payments`, `purchases`, `purchase_items`, `rewards`,
`manufacturing_orders`, `manufacturing_items`, `accounts`, `account_transactions`,
`capital_snapshots`, `customer_orders`, `customer_order_items`, `expenses`,
`settings`, `print_settings`, `number_series`, `workers`, `audit_log`, `backups`

---

## Phase 2 — Export from old Production Manager

### 2a. Full dump (recommended)
```bash
pg_dump -U <old_user> -h <old_host> <old_db> \
  --data-only --no-owner --no-privileges \
  -f old_pm_data.sql
```

### 2b. Per-table CSV export (selective migration)
```bash
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY companies TO 'companies.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY users TO 'users.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY products TO 'products.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY entities TO 'entities.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY invoices TO 'invoices.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY invoice_items TO 'invoice_items.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY payments TO 'payments.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY purchases TO 'purchases.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY purchase_items TO 'purchase_items.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY expenses TO 'expenses.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY settings TO 'settings.csv' CSV HEADER"
psql -U <old_user> -h <old_host> <old_db> \
  -c "\COPY audit_log TO 'audit_log.csv' CSV HEADER"
```

---

## Phase 3 — Transform (if needed)

### Users — password column
The new schema stores passwords in the `password_hash` column.
If the old schema used a different column name (`password`, `pwd`, etc.),
rename it in the CSV before import:

```python
import csv, sys

with open('users.csv') as f:
    reader = csv.DictReader(f)
    # Rename old column to new name
    fieldnames = [c if c != 'password' else 'password_hash' for c in reader.fieldnames]
    rows = list(reader)

with open('users_new.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        if 'password' in row:
            row['password_hash'] = row.pop('password')
        writer.writerow(row)
```

### Users — company_id
Every migrated user MUST have a `company_id` that matches a row in `companies`.
The new schema enforces `UNIQUE(company_id, username)`.
Super-admin rows must have `company_id = NULL`.

### Users — username uniqueness
If the old system had a global unique username constraint and multiple companies
share a username (e.g. "admin"), you must assign each a `company_id` before import.
The new partial index `users_company_username_uq` handles this automatically once
the `company_id` is set correctly.

---

## Phase 4 — Import into new ERP

### 4a. Companies first (foreign key root)
```sql
-- Disable triggers temporarily to avoid constraint issues during bulk insert
SET session_replication_role = 'replica';

\COPY companies FROM 'companies.csv' CSV HEADER;

-- Re-enable triggers
SET session_replication_role = 'origin';
```

### 4b. Users (after companies)
```sql
SET session_replication_role = 'replica';

\COPY users FROM 'users_new.csv' CSV HEADER;

SET session_replication_role = 'origin';

-- Rebuild sequences to avoid PK collisions
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
```

### 4c. Products, Entities, Invoices, Purchases, Payments, Expenses
Import in this order (respect FK dependencies):

```sql
SET session_replication_role = 'replica';

\COPY products        FROM 'products.csv'       CSV HEADER;
\COPY entities        FROM 'entities.csv'        CSV HEADER;
\COPY invoices        FROM 'invoices.csv'        CSV HEADER;
\COPY invoice_items   FROM 'invoice_items.csv'   CSV HEADER;
\COPY payments        FROM 'payments.csv'        CSV HEADER;
\COPY purchases       FROM 'purchases.csv'       CSV HEADER;
\COPY purchase_items  FROM 'purchase_items.csv'  CSV HEADER;
\COPY expenses        FROM 'expenses.csv'        CSV HEADER;

SET session_replication_role = 'origin';

-- Reset all sequences
SELECT setval('products_id_seq',       (SELECT MAX(id) FROM products));
SELECT setval('entities_id_seq',       (SELECT MAX(id) FROM entities));
SELECT setval('invoices_id_seq',       (SELECT MAX(id) FROM invoices));
SELECT setval('invoice_items_id_seq',  (SELECT MAX(id) FROM invoice_items));
SELECT setval('payments_id_seq',       (SELECT MAX(id) FROM payments));
SELECT setval('purchases_id_seq',      (SELECT MAX(id) FROM purchases));
SELECT setval('purchase_items_id_seq', (SELECT MAX(id) FROM purchase_items));
SELECT setval('expenses_id_seq',       (SELECT MAX(id) FROM expenses));
```

### 4d. Settings and audit log
```sql
\COPY settings   FROM 'settings.csv'   CSV HEADER;
\COPY audit_log  FROM 'audit_log.csv'  CSV HEADER;
SELECT setval('audit_log_id_seq', (SELECT MAX(id) FROM audit_log));
```

---

## Phase 5 — Post-import verification

```sql
-- Row counts sanity check
SELECT 'companies'     AS tbl, COUNT(*) FROM companies
UNION ALL
SELECT 'users',         COUNT(*) FROM users
UNION ALL
SELECT 'products',      COUNT(*) FROM products
UNION ALL
SELECT 'entities',      COUNT(*) FROM entities
UNION ALL
SELECT 'invoices',      COUNT(*) FROM invoices
UNION ALL
SELECT 'payments',      COUNT(*) FROM payments
UNION ALL
SELECT 'expenses',      COUNT(*) FROM expenses
UNION ALL
SELECT 'audit_log',     COUNT(*) FROM audit_log
ORDER BY tbl;

-- Verify per-company username uniqueness holds
SELECT company_id, username, COUNT(*) AS n
FROM users
GROUP BY company_id, username
HAVING COUNT(*) > 1;
-- Should return 0 rows

-- Verify super_admin rows have NULL company_id
SELECT id, username, role, company_id FROM users WHERE role = 'super_admin';
-- company_id must be NULL for all rows

-- Verify sequences are ahead of max IDs
SELECT last_value FROM users_id_seq;
SELECT last_value FROM invoices_id_seq;
```

---

## Phase 6 — Subscription records

Every imported company needs a matching row in `subscriptions` for login to work
(the API checks subscription status at login time).

```sql
-- Insert a default active subscription for each imported company that lacks one
INSERT INTO subscriptions (
  company_id, owner_name, plan_name,
  subscription_start_date, subscription_end_date,
  subscription_amount, payment_status, subscription_status,
  last_payment_date, next_due_date
)
SELECT
  c.id,
  c.name,
  'yearly',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '1 year',
  0,
  'paid',
  'active',
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '1 year'
FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM subscriptions s WHERE s.company_id = c.id
);
```

---

## Data inventory

| Category       | Table(s)                                          | Notes                                |
|---------------|---------------------------------------------------|--------------------------------------|
| Companies      | `companies`, `subscriptions`                      | Root of the tenant hierarchy         |
| Users          | `users`                                           | Must have `company_id` + unique check|
| Inventory      | `products`, `workers`                             | Per-company scope                    |
| Transactions   | `invoices`, `invoice_items`, `payments`           | FK to entities + products            |
| Bills          | `purchases`, `purchase_items`                     | Vendor bills                         |
| Expenses       | `expenses`                                        |                                      |
| Reports data   | `account_transactions`, `capital_snapshots`       | Derived; may re-generate from source |
| Settings       | `settings`, `print_settings`, `number_series`     | One row per company                  |
| Audit logs     | `audit_log`                                       | Historical events                    |

---

## Rollback plan

If the import fails or data looks wrong:

1. The development database supports rollbacks via Replit checkpoints.
2. Before import, create a checkpoint in the Replit UI (three-dot menu → "Create checkpoint").
3. To rollback: restore from that checkpoint.
4. Alternatively, keep the old Production Manager running in parallel until
   you have verified all data is intact in the new system.

---

*Generated: 2026-06-13. Review and adapt column names to match your specific old-PM schema.*
