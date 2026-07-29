import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { logger } from "./logger";
import { hashPassword, isHashed } from "./password";
import { generateSeriesNumber } from "./number-series";

const SCHEMA_FILE_NAME = "production-schema.sql";
const SEED_FILE_NAME = "production-seed-data.sql";

// The platform super_admin has no company_id (NULL) — it manages all tenants.
// Using role "super_admin" here ensures a fresh install can log in and create
// companies/subscriptions immediately without being locked out by the
// "No tenant context" guard that blocks regular admin/salesman accounts whose
// company_id is NULL. Never set company_id on this row.
const DEFAULT_ADMIN = {
  username: "admin",
  passwordHash: "admin123",
  role: "super_admin",
  name: "Super Administrator",
} as const;

/**
 * Walk up from each start directory looking for a repo-root file. Returns the
 * first match. This makes the lookup robust across the local dev cwd
 * (artifacts/api-server) and the production container cwd (/app).
 */
function locateRepoFile(fileName: string): string | null {
  const startDirs = new Set<string>([process.cwd()]);
  try {
    if (typeof __dirname === "string") startDirs.add(__dirname);
  } catch {
    // __dirname unavailable; ignore.
  }

  for (const start of startDirs) {
    let dir = path.resolve(start);
    // Walk up to the filesystem root.
    for (;;) {
      const candidate = path.join(dir, fileName);
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return null;
}

function locateSchemaFile(): string | null {
  const override = process.env.PRODUCTION_SCHEMA_PATH;
  if (override) {
    return existsSync(override) ? path.resolve(override) : null;
  }
  return locateRepoFile(SCHEMA_FILE_NAME);
}

/**
 * pg_dump emits psql meta-commands (e.g. \restrict, \unrestrict) that are not
 * valid SQL when sent over the wire via node-postgres. Strip any line that
 * begins with a backslash so the remaining statements execute cleanly.
 */
function stripPsqlMetaCommands(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("\\"))
    .join("\n");
}

async function usersTableExists(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ reg: string | null }>(
    "SELECT to_regclass('public.users') AS reg;",
  );
  return result.rows[0]?.reg != null;
}

async function applySchema(client: pg.Client): Promise<void> {
  const schemaPath = locateSchemaFile();
  if (!schemaPath) {
    throw new Error(
      `Cannot bootstrap database: ${SCHEMA_FILE_NAME} not found. Set PRODUCTION_SCHEMA_PATH to its absolute path.`,
    );
  }

  logger.info({ schemaPath }, "Database is empty; applying schema");
  const rawSql = readFileSync(schemaPath, "utf8");
  const sql = stripPsqlMetaCommands(rawSql);
  await client.query(sql);
  logger.info("Database schema applied successfully");
}

/**
 * One-time business-data seed. Loads production-seed-data.sql (the development
 * company-8 dataset) ONLY when the products table is empty, so a freshly
 * provisioned production database comes up populated with real data instead of
 * a blank slate. Every statement in the file is conflict-safe (ON CONFLICT DO
 * NOTHING / user upserts) and the whole load runs inside a single transaction,
 * so it is safe to ship and a no-op once data exists.
 */
async function seedBusinessDataIfEmpty(client: pg.Client): Promise<void> {
  const productsReg = await client.query<{ reg: string | null }>(
    "SELECT to_regclass('public.products') AS reg;",
  );
  if (productsReg.rows[0]?.reg == null) {
    logger.info("products table missing; skipping data seed");
    return;
  }

  const countResult = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM public.products;",
  );
  const productCount = Number(countResult.rows[0]?.count ?? "0");
  if (productCount > 0) {
    logger.info(
      { productCount },
      "Business data already present; skipping data seed",
    );
    return;
  }

  const seedPath = locateRepoFile(SEED_FILE_NAME);
  if (!seedPath) {
    logger.warn(
      { seedFile: SEED_FILE_NAME },
      "Seed file not found; leaving database empty",
    );
    return;
  }

  logger.info({ seedPath }, "Products table empty; loading business data seed");
  const rawSql = readFileSync(seedPath, "utf8");
  const sql = stripPsqlMetaCommands(rawSql);
  await client.query("BEGIN;");
  try {
    await client.query(sql);
    await client.query("COMMIT;");
    logger.info("Business data seed loaded successfully");
  } catch (err) {
    await client.query("ROLLBACK;");
    throw err;
  }
}

/**
 * Idempotent schema patches. Adds columns and tables introduced after the
 * initial production-schema.sql was cut, so existing installs pick them up on
 * the next restart without a manual migration step.
 */
async function applySchemaPatches(client: pg.Client): Promise<void> {
  const patches: string[] = [
    // ── Entities: salesman assignment ──────────────────────────────────────
    `ALTER TABLE entities ADD COLUMN IF NOT EXISTS assigned_salesman_id INTEGER`,
    `ALTER TABLE entities ADD COLUMN IF NOT EXISTS commission_expiry_date TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE entities ADD COLUMN IF NOT EXISTS customer_source TEXT NOT NULL DEFAULT 'admin'`,

    // ── Commission transactions: per-invoice commission snapshots ──────────
    `CREATE TABLE IF NOT EXISTS commission_transactions (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER NOT NULL,
      invoice_id      INTEGER NOT NULL,
      invoice_no      TEXT NOT NULL,
      salesman_id     INTEGER NOT NULL,
      salesman_name   TEXT NOT NULL,
      customer_id     INTEGER,
      customer_name   TEXT,
      total_liters    NUMERIC(14, 3) NOT NULL DEFAULT 0,
      commission_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      status          TEXT NOT NULL DEFAULT 'pending',
      paid_at         TIMESTAMP WITH TIME ZONE,
      payment_reference TEXT,
      created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,

    // ── Products: volume unit type (liter or kg) ───────────────────────────
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_unit VARCHAR(10) NOT NULL DEFAULT 'liter'`,

    // ── Products: direct selling price for non-GST invoices ───────────────
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS non_gst_price NUMERIC(12, 2)`,

    // ── WhatsApp: per-entity WhatsApp number ──────────────────────────────
    `ALTER TABLE entities ADD COLUMN IF NOT EXISTS whatsapp_number TEXT`,

    // ── WhatsApp: message log ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS whatsapp_logs (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER NOT NULL,
      customer_id       INTEGER,
      customer_name     TEXT,
      mobile_number     TEXT NOT NULL,
      message_type      TEXT NOT NULL,
      message_body      TEXT NOT NULL,
      reference_id      INTEGER,
      reference_type    TEXT,
      delivery_status   TEXT NOT NULL DEFAULT 'pending',
      wa_message_id     TEXT,
      error_text        TEXT,
      sent_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS whatsapp_logs_company_idx ON whatsapp_logs(company_id)`,
    `CREATE INDEX IF NOT EXISTS whatsapp_logs_customer_idx ON whatsapp_logs(customer_id)`,

    // ── Transport / E-Way Bill: Transporter Master ─────────────────────────
    `CREATE TABLE IF NOT EXISTS transporters (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER NOT NULL,
      name              TEXT NOT NULL,
      gstin             TEXT,
      transporter_id    TEXT,
      contact_name      TEXT,
      contact_mobile    TEXT,
      notes             TEXT,
      is_active         BOOLEAN NOT NULL DEFAULT TRUE,
      created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,

    // ── Transport / E-Way Bill: Vehicle Master ─────────────────────────────
    `CREATE TABLE IF NOT EXISTS vehicles (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER NOT NULL,
      vehicle_number    TEXT NOT NULL,
      vehicle_type      TEXT NOT NULL DEFAULT 'regular',
      notes             TEXT,
      is_active         BOOLEAN NOT NULL DEFAULT TRUE,
      created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,

    // ── Transport / E-Way Bill: Dispatch Module ────────────────────────────
    `CREATE TABLE IF NOT EXISTS dispatches (
      id                        SERIAL PRIMARY KEY,
      company_id                INTEGER NOT NULL,
      invoice_id                INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      invoice_no                TEXT,
      transporter_id            INTEGER,
      transporter_name          TEXT,
      transporter_gstin         TEXT,
      vehicle_id                INTEGER,
      vehicle_number            TEXT,
      lr_number                 TEXT,
      transport_mode            TEXT NOT NULL DEFAULT 'road',
      distance_km               INTEGER,
      eway_bill_status          TEXT NOT NULL DEFAULT 'pending',
      eway_bill_number          TEXT,
      eway_bill_date            TIMESTAMP WITH TIME ZONE,
      eway_bill_validity_date   TIMESTAMP WITH TIME ZONE,
      notes                     TEXT,
      created_by_user_id        INTEGER,
      created_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS dispatches_company_idx ON dispatches(company_id)`,
    `CREATE INDEX IF NOT EXISTS dispatches_invoice_idx ON dispatches(invoice_id)`,

    // ── Commission payments: bulk payment records ──────────────────────────
    `CREATE TABLE IF NOT EXISTS commission_payments (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      salesman_id         INTEGER NOT NULL,
      salesman_name       TEXT NOT NULL,
      amount              NUMERIC(12, 2) NOT NULL,
      payment_date        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      reference           TEXT,
      note                TEXT,
      created_by_user_id  INTEGER,
      created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,

    // ── Products: name of the outer packaging (Box, Barrel, Drum, etc.) ────
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS packaging_unit VARCHAR(20) NOT NULL DEFAULT 'Box'`,

    // ── Manufacturing: assembled output staged here until dispatched to
    // Store — assembling no longer credits finished-good stock directly.
    `CREATE TABLE IF NOT EXISTS ready_material_batches (
      id                    SERIAL PRIMARY KEY,
      company_id            INTEGER NOT NULL,
      bom_id                INTEGER,
      product_id            INTEGER NOT NULL,
      product_name          TEXT NOT NULL,
      unit                  TEXT NOT NULL,
      qty                   NUMERIC(12, 3) NOT NULL,
      batches               NUMERIC(12, 3) NOT NULL DEFAULT 1,
      worker_id             INTEGER,
      worker_name           TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'ready',
      adjustment_reason     TEXT,
      material_transfer_id  INTEGER,
      dispatched_at         TIMESTAMP WITH TIME ZONE,
      workload_card_id      INTEGER,
      created_by_user_id    INTEGER,
      created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS ready_material_batches_company_idx ON ready_material_batches(company_id)`,
    `CREATE INDEX IF NOT EXISTS ready_material_batches_status_idx ON ready_material_batches(status)`,

    // ── Number series: display format template (e.g. "INV/YYYY/MM/SEQ") ───
    // Missing on installs older than this column — without it, the very
    // first use of any brand-new series type (a new company's first
    // invoice, or first use of a document type like purchase orders) fails
    // with "column format_string does not exist".
    `ALTER TABLE number_series ADD COLUMN IF NOT EXISTS format_string TEXT`,

    // ── Expenses: which Cash Book account the expense was paid from ────────
    // Nullable so older rows (created before this column existed) don't
    // break — backfillExpenseAccounts() below fills them in once.
    `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS account_id INTEGER`,
  ];

  for (const sql of patches) {
    try {
      await client.query(sql);
    } catch (err) {
      logger.warn({ err, sql: sql.slice(0, 120) }, "Schema patch failed (non-fatal)");
    }
  }
  logger.info("Schema patches applied");
}

async function ensureDefaultAdmin(client: pg.Client): Promise<void> {
  // Insert the platform super_admin if it does not exist yet.
  // ON CONFLICT: if the row already exists but has the old role "admin" (pre-fix
  // installs), upgrade it to "super_admin" so the operator can reach the
  // subscription/company management console without being blocked by the
  // company_id NULL → "No tenant context" guard. company_id stays NULL — that
  // is correct and intentional for the cross-tenant super_admin.
  // ON CONFLICT target must match an actual unique constraint/index.
  // After the per-company migration:
  //   - UNIQUE(username)                              → DROPPED
  //   - UNIQUE(company_id, username)                  → covers tenant users
  //   - UNIQUE(username) WHERE (company_id IS NULL)   → covers super_admin (partial index)
  // Use the partial-index form so PostgreSQL can resolve the conflict target.
  const result = await client.query(
    `INSERT INTO public.users (username, password_hash, role, name, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (username) WHERE (company_id IS NULL) DO UPDATE
       SET role = CASE
             WHEN EXCLUDED.role = 'super_admin' AND public.users.role != 'super_admin'
               THEN 'super_admin'
             ELSE public.users.role
           END,
           company_id = NULL
     RETURNING id, role;`,
    [
      DEFAULT_ADMIN.username,
      hashPassword(DEFAULT_ADMIN.passwordHash),
      DEFAULT_ADMIN.role,
      DEFAULT_ADMIN.name,
    ],
  );

  const row = result.rows[0];
  if (row) {
    logger.info(
      { username: DEFAULT_ADMIN.username, role: row.role },
      "Default super_admin user ensured",
    );
  }
}

/**
 * One-time (but safe to re-run) migration: any user row still holding a raw
 * plaintext password — from before hashing was added, or from the seed data
 * — gets rewritten to a scrypt hash. isHashed() makes this a no-op for rows
 * already migrated, so it's cheap to run on every restart.
 */
async function hashPlaintextPasswords(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ id: number; password_hash: string }>(
    `SELECT id, password_hash FROM users`,
  );
  let migrated = 0;
  for (const row of rows) {
    if (isHashed(row.password_hash)) continue;
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [
      hashPassword(row.password_hash),
      row.id,
    ]);
    migrated++;
  }
  if (migrated > 0) {
    logger.info({ migrated }, "Migrated plaintext passwords to scrypt hashes");
  }
}

// expenses.payment_mode (cash | upi | bank) -> account_transactions.mode enum.
const PAYMENT_MODE_TO_TXN_MODE: Record<string, string> = {
  cash: "cash",
  upi: "upi",
  bank: "bank_transfer",
};

/**
 * One-time (but safe to re-run) migration: expenses created before the
 * account_id column existed never showed up in Cash Book, because nothing
 * ever recorded their cash/bank impact as an account_transactions row. For
 * each such expense, pick the company's active account whose type matches
 * the expense's payment_mode (the two use the same cash/upi/bank values) and
 * post the missing "out" entry, exactly like a fresh expense would today.
 * Only ever touches rows still missing account_id, so it's cheap to re-run.
 */
async function backfillExpenseAccounts(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{
    id: number; company_id: number; amount: string; payment_mode: string; paid_to: string | null; category_name: string;
  }>(
    `SELECT id, company_id, amount, payment_mode, paid_to, category_name FROM expenses WHERE account_id IS NULL`,
  );
  if (rows.length === 0) return;

  const acctCache = new Map<string, { id: number } | null>();
  let migrated = 0;
  for (const row of rows) {
    const cacheKey = `${row.company_id}:${row.payment_mode}`;
    if (!acctCache.has(cacheKey)) {
      const { rows: acctRows } = await client.query<{ id: number }>(
        `SELECT id FROM accounts WHERE company_id = $1 AND type = $2 AND is_active = true ORDER BY id LIMIT 1`,
        [row.company_id, row.payment_mode],
      );
      acctCache.set(cacheKey, acctRows[0] ?? null);
    }
    const acct = acctCache.get(cacheKey) ?? null;
    if (!acct) continue; // No matching account for this company/mode — leave it, nothing sane to link to.

    const amount = Number(row.amount);
    const receiptNo = await generateSeriesNumber(client, "payment_receipt", row.company_id);
    await client.query(
      `INSERT INTO account_transactions
        (company_id, account_id, direction, amount, mode, party_name, notes, receipt_no)
       VALUES ($1,$2,'out',$3,$4,$5,$6,$7)`,
      [
        row.company_id,
        acct.id,
        amount,
        PAYMENT_MODE_TO_TXN_MODE[row.payment_mode] ?? "other",
        row.paid_to,
        `Expense: ${row.category_name} (backfilled)`,
        receiptNo,
      ],
    );
    await client.query(`UPDATE accounts SET current_balance = current_balance - $1 WHERE id = $2`, [amount, acct.id]);
    await client.query(`UPDATE expenses SET account_id = $1 WHERE id = $2`, [acct.id, row.id]);
    migrated++;
  }
  if (migrated > 0) {
    logger.info({ migrated, skipped: rows.length - migrated }, "Backfilled expenses into Cash Book");
  }
}

/**
 * One-time (but safe to re-run) cleanup: a product is only ever supposed to
 * have one 'ready' Ready Material line at a time (Assemble and manual
 * Material Transfer both now merge into an existing one instead of creating
 * a new row), but rows created before that fix are still sitting duplicated
 * — typically a real assembled batch alongside a separate negative deficit
 * row for the same product. Merges every such group into a single row:
 * sums qty/batches, keeps the most recent worker/workload attribution, and
 * clears the deficit note once the combined qty is no longer negative.
 */
async function consolidateReadyMaterialBatches(client: pg.Client): Promise<void> {
  const { rows: groups } = await client.query<{ company_id: number; product_id: number }>(
    `SELECT company_id, product_id FROM ready_material_batches
     WHERE status = 'ready'
     GROUP BY company_id, product_id
     HAVING COUNT(*) > 1`,
  );
  if (groups.length === 0) return;

  let merged = 0;
  for (const group of groups) {
    const { rows: batchRows } = await client.query(
      `SELECT * FROM ready_material_batches
       WHERE company_id = $1 AND product_id = $2 AND status = 'ready'
       ORDER BY created_at ASC`,
      [group.company_id, group.product_id],
    );
    if (batchRows.length < 2) continue;

    const keep = batchRows[0];
    const latest = batchRows[batchRows.length - 1];
    const totalQty = batchRows.reduce((s, b) => s + Number(b.qty), 0);
    const totalBatches = batchRows.reduce((s, b) => s + Number(b.batches), 0);
    const reason = totalQty >= 0 ? null : (batchRows.find((b) => b.adjustment_reason)?.adjustment_reason ?? null);

    await client.query(
      `UPDATE ready_material_batches
       SET qty = $1, batches = $2, worker_id = $3, worker_name = $4, workload_card_id = $5,
           bom_id = $6, adjustment_reason = $7, updated_at = NOW()
       WHERE id = $8`,
      [totalQty, totalBatches, latest.worker_id, latest.worker_name, latest.workload_card_id, latest.bom_id, reason, keep.id],
    );
    await client.query(
      `DELETE FROM ready_material_batches WHERE id = ANY($1::int[])`,
      [batchRows.slice(1).map((b) => b.id)],
    );
    merged++;
  }
  if (merged > 0) {
    logger.info({ merged }, "Consolidated duplicate Ready Material lines");
  }
}

/**
 * Idempotent startup bootstrap. Connects with a dedicated client (so the schema
 * dump's session-level SET statements never leak into the shared pool), creates
 * all tables from the schema file when the database is empty, and ensures the
 * default admin user exists. Never throws — failures are logged so the server
 * can still start and surface its health endpoint.
 */
export async function ensureDatabaseReady(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    logger.error("DATABASE_URL is not set; skipping database bootstrap");
    return;
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    if (await usersTableExists(client)) {
      logger.info("Database already initialized (users table present)");
    } else {
      await applySchema(client);
    }

    await seedBusinessDataIfEmpty(client);
    await applySchemaPatches(client);
    await ensureDefaultAdmin(client);
    await hashPlaintextPasswords(client);
    await backfillExpenseAccounts(client);
    await consolidateReadyMaterialBatches(client);
  } catch (err) {
    logger.error({ err }, "Database bootstrap failed");
  } finally {
    try {
      await client.end();
    } catch (endErr) {
      logger.error({ err: endErr }, "Failed to close bootstrap DB client");
    }
  }
}
