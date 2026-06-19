import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { logger } from "./logger";

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
      DEFAULT_ADMIN.passwordHash,
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
