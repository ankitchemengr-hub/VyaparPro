import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { db, usersTable, pool } from "@workspace/db";
import { UpdateBackupSettingsBody, ResetCompanyDataBody } from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";
import { getCurrentCompany } from "../lib/company";
import { COMPANY_TABLES, RESET_PRESERVE } from "../lib/company-data";

const router: IRouter = Router();

const BACKUP_FORMAT = "shradha-erp-backup";
const BACKUP_VERSION = 1;

// Admin-only guard, identical in spirit to the one in settings.ts: re-reads the
// user row so a stale/disabled admin session cannot reach these routes.
async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!current || !current.isActive || current.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

function mapSettings(row: any) {
  return {
    dailyEnabled: row?.daily_enabled ?? false,
    weeklyEnabled: row?.weekly_enabled ?? false,
    monthlyEnabled: row?.monthly_enabled ?? false,
    lastDailyAt: row?.last_daily_at ? new Date(row.last_daily_at).toISOString() : null,
    lastWeeklyAt: row?.last_weekly_at ? new Date(row.last_weekly_at).toISOString() : null,
    lastMonthlyAt: row?.last_monthly_at ? new Date(row.last_monthly_at).toISOString() : null,
  };
}

async function resolveSettings(companyId: number) {
  const r = await pool.query(`SELECT * FROM backup_settings WHERE company_id = $1`, [companyId]);
  return mapSettings(r.rows[0]);
}

// Build the complete, tenant-scoped backup package object. Every table in
// COMPANY_TABLES is read with WHERE company_id so the package can only ever
// contain the caller's own company data.
async function buildBackupPackage(req: Request, companyId: number): Promise<{
  pkg: Record<string, unknown>;
  counts: Record<string, number>;
}> {
  const company = await getCurrentCompany(companyId);
  const session = (req as any).session;

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const table of COMPANY_TABLES) {
    // Table names come from a fixed allow-list constant, never user input.
    const r = await pool.query(`SELECT * FROM ${table} WHERE company_id = $1 ORDER BY id`, [companyId]);
    tables[table] = r.rows;
    counts[table] = r.rows.length;
  }

  const pkg = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    companyId,
    companyName: company?.name ?? null,
    createdAt: new Date().toISOString(),
    createdBy: { userId: session?.userId ?? null, name: session?.name ?? null },
    counts,
    tables,
  };
  return { pkg, counts };
}

// GET /system/backup-settings — automatic-backup cadence preferences (admin only).
router.get("/system/backup-settings", requireAdmin, async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  res.json(await resolveSettings(companyId));
});

// PUT /system/backup-settings — update cadence preferences (admin only). NOTE:
// this only persists the preference; the scheduler that acts on it is delivered
// in a later batch.
router.put("/system/backup-settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateBackupSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.issues });
    return;
  }
  const session = (req as any).session;
  const companyId = getCompanyId(req);

  const current = await pool.query(`SELECT * FROM backup_settings WHERE company_id = $1`, [companyId]);
  const merged = {
    daily_enabled: parsed.data.dailyEnabled ?? current.rows[0]?.daily_enabled ?? false,
    weekly_enabled: parsed.data.weeklyEnabled ?? current.rows[0]?.weekly_enabled ?? false,
    monthly_enabled: parsed.data.monthlyEnabled ?? current.rows[0]?.monthly_enabled ?? false,
  };

  await pool.query(
    `INSERT INTO backup_settings (company_id, daily_enabled, weekly_enabled, monthly_enabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id) DO UPDATE SET
       daily_enabled = EXCLUDED.daily_enabled,
       weekly_enabled = EXCLUDED.weekly_enabled,
       monthly_enabled = EXCLUDED.monthly_enabled,
       updated_at = NOW()`,
    [companyId, merged.daily_enabled, merged.weekly_enabled, merged.monthly_enabled],
  );
  await pool.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
     VALUES ($1, 'backup_settings_updated', $2, $3, $4, $5)`,
    [
      companyId,
      "Automatic backup preferences updated",
      session?.userId ?? 1,
      session?.name ?? "Unknown",
      JSON.stringify(merged),
    ],
  );

  res.json(await resolveSettings(companyId));
});

// GET /system/backups — backup history (admin only).
router.get("/system/backups", requireAdmin, async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const r = await pool.query(
    `SELECT * FROM backups WHERE company_id = $1 ORDER BY created_at DESC, id DESC`,
    [companyId],
  );
  res.json(
    r.rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      sizeBytes: Number(row.size_bytes ?? 0),
      type: row.type,
      tableCounts: row.table_counts ?? {},
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      createdAt: new Date(row.created_at).toISOString(),
    })),
  );
});

// GET /system/backup/download?format=zip|json — generate a manual backup and
// stream it to the admin's browser. This is a file download (not JSON), so it is
// implemented as a plain authenticated route rather than a generated hook; the
// signed session cookie authenticates the same-origin request. A history row is
// logged (type='manual', storage_key=null — the file is not retained server-side).
router.get("/system/backup/download", requireAdmin, async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const format = req.query.format === "json" ? "json" : "zip";

  const { pkg, counts } = await buildBackupPackage(req, companyId);
  const json = JSON.stringify(pkg, null, 2);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const baseName = `shradha-backup-${companyId}-${stamp}`;

  let body: Buffer;
  let fileName: string;
  let contentType: string;
  if (format === "json") {
    body = Buffer.from(json, "utf8");
    fileName = `${baseName}.json`;
    contentType = "application/json";
  } else {
    const zip = new JSZip();
    zip.file(`${baseName}.json`, json);
    body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    fileName = `${baseName}.zip`;
    contentType = "application/zip";
  }

  await pool.query(
    `INSERT INTO backups (company_id, file_name, storage_key, size_bytes, type, table_counts, created_by, created_by_name)
     VALUES ($1, $2, NULL, $3, 'manual', $4, $5, $6)`,
    [companyId, fileName, body.length, JSON.stringify(counts), session?.userId ?? 1, session?.name ?? "Unknown"],
  );
  await pool.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
     VALUES ($1, 'backup_created', $2, $3, $4, $5)`,
    [
      companyId,
      `Manual backup downloaded (${fileName}, ${body.length} bytes)`,
      session?.userId ?? 1,
      session?.name ?? "Unknown",
      JSON.stringify({ format, fileName, sizeBytes: body.length, counts }),
    ],
  );

  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("Content-Length", String(body.length));
  res.setHeader("Cache-Control", "no-store");
  res.status(200).end(body);
});

// POST /system/reset — wipe all company business data to start fresh (admin only).
// DESTRUCTIVE. Requires an explicit { confirm: "RESET" } token. Everything in
// COMPANY_TABLES is cleared except the RESET_PRESERVE set (logins, permissions,
// settings) so the account stays usable. Runs in a SERIALIZABLE transaction.
router.post("/system/reset", requireAdmin, async (req, res): Promise<void> => {
  const parsed = ResetCompanyDataBody.safeParse(req.body);
  if (!parsed.success || parsed.data.confirm !== "RESET") {
    res.status(400).json({ error: 'Type "RESET" to confirm.' });
    return;
  }
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const preserve = new Set<string>(RESET_PRESERVE);

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    const cleared: Record<string, number> = {};
    // Reverse order: children before parents so foreign keys never block a delete.
    for (const table of [...COMPANY_TABLES].reverse()) {
      if (preserve.has(table)) continue;
      const r = await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
      cleared[table] = r.rowCount ?? 0;
    }
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, 'data_reset', $2, $3, $4, $5)`,
      [
        companyId,
        "Company data reset to a fresh state",
        session?.userId ?? 1,
        session?.name ?? "Unknown",
        JSON.stringify({ cleared, preserved: [...preserve] }),
      ],
    );
    await client.query("COMMIT");
    res.json({ message: "Company data has been reset.", cleared });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    req.log.error({ err }, "Company data reset failed");
    res.status(500).json({ error: "Reset failed; no data was changed." });
  } finally {
    client.release();
  }
});

// POST /system/restore — replace ALL company data with the contents of an
// uploaded backup package (admin only). DESTRUCTIVE. The package must have been
// produced by this same company (companyId must match) so the original primary
// keys cannot collide with another tenant's rows. Runs in a SERIALIZABLE
// transaction: delete everything, re-insert the package rows (company_id forced
// to the caller's), then realign each table's id sequence.
router.post("/system/restore", requireAdmin, async (req, res): Promise<void> => {
  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const pkg = req.body as Record<string, any>;

  if (!pkg || typeof pkg !== "object" || pkg.format !== BACKUP_FORMAT) {
    res.status(400).json({ error: "Not a valid Shradha ERP backup file." });
    return;
  }
  if (Number(pkg.version) > BACKUP_VERSION) {
    res.status(400).json({ error: "This backup was made by a newer version and cannot be restored." });
    return;
  }
  // Primary check: company IDs match (backup was made on this same DB instance).
  // Fallback: company names match case-insensitively — handles the common case
  // where the DB was reset/recreated and the company was assigned a new internal
  // ID even though it is logically the same company. The restore itself forces
  // every row's company_id to the caller's current session value, so there is
  // no cross-tenant data leak regardless of which branch is taken.
  const currentCompany = await getCurrentCompany(companyId);
  const idMatches = pkg.companyId != null && Number(pkg.companyId) === companyId;
  // Normalize names: lowercase + collapse all whitespace so "SHRADHA OILCENTER"
  // matches "SHRADHA OIL CENTER" (spacing may differ between backup and current DB).
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const nameMatches =
    typeof pkg.companyName === "string" &&
    pkg.companyName.trim().length > 0 &&
    currentCompany?.name != null &&
    normalize(pkg.companyName) === normalize(currentCompany.name);
  if (!idMatches && !nameMatches) {
    res.status(400).json({ error: "This backup belongs to a different company and cannot be restored here." });
    return;
  }
  const tables: Record<string, any[]> =
    pkg.tables && typeof pkg.tables === "object" ? pkg.tables : {};

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");

    // 1) Clear existing rows, children before parents.
    for (const table of [...COMPANY_TABLES].reverse()) {
      await client.query(`DELETE FROM ${table} WHERE company_id = $1`, [companyId]);
    }

    // 2) Re-insert package rows, parents before children.
    const restored: Record<string, number> = {};
    for (const table of COMPANY_TABLES) {
      const rows = Array.isArray(tables[table]) ? tables[table] : [];
      // Trusted column metadata from the database itself. We only ever build SQL
      // from these names (never from raw uploaded keys), so a malicious backup
      // cannot inject SQL through column identifiers. `jsonCols` are stringified
      // because node-pg would otherwise format a JS array as a Postgres array.
      const typeRes = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
        [table],
      );
      const allowedCols = new Set<string>(typeRes.rows.map((r: any) => r.column_name));
      const jsonCols = new Set<string>(
        typeRes.rows
          .filter((r: any) => r.data_type === "json" || r.data_type === "jsonb")
          .map((r: any) => r.column_name),
      );

      let count = 0;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        // Intersect uploaded keys with real columns; unknown keys are ignored.
        const cols = Object.keys(row).filter((c) => allowedCols.has(c));
        if (cols.length === 0) continue;
        const values = cols.map((c) => {
          if (c === "company_id") return companyId;
          const v = row[c];
          if (jsonCols.has(c)) return v == null ? null : JSON.stringify(v);
          return v;
        });
        const colList = cols.map((c) => `"${c}"`).join(", ");
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
        await client.query(`INSERT INTO ${table} (${colList}) VALUES (${placeholders})`, values);
        count++;
      }
      restored[table] = count;

      // 3) Realign the id sequence (if the table has one) so the next insert
      // doesn't reuse a restored primary key.
      const seqRes = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [table]);
      const seq = seqRes.rows[0]?.seq;
      if (seq) {
        await client.query(
          `SELECT setval($1, GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${table}), 1))`,
          [seq],
        );
      }
    }

    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, 'data_restored', $2, $3, $4, $5)`,
      [
        companyId,
        "Company data restored from a backup file",
        session?.userId ?? 1,
        session?.name ?? "Unknown",
        JSON.stringify({ restored, backupCreatedAt: pkg.createdAt ?? null }),
      ],
    );

    await client.query("COMMIT");
    res.json({ message: "Backup restored successfully.", restored });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    req.log.error({ err }, "Company data restore failed");
    res.status(500).json({ error: "Restore failed; no data was changed." });
  } finally {
    client.release();
  }
});

export default router;
