import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";

// Local, on-disk safety net: a full pg_dump of the whole database, taken
// automatically — no prompts, no admin action required — so a crash, power
// cut, or the admin just closing everything for the day always leaves a
// same-day dump on this machine to restore from instead of starting over.
// Runs once at boot, then daily, and once more on a graceful shutdown; dumps
// older than BACKUP_RETENTION_COUNT are pruned so the folder doesn't grow
// forever.

const BACKUP_RETENTION_COUNT = 14;

// PM2 (see ecosystem.config.cjs) runs this process with cwd set to
// <repo root>/artifacts/api-server, so two levels up is the repo root.
const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const BACKUP_DIR = process.env["BACKUP_DIR"] || path.join(REPO_ROOT, "backups");

// pg_dump isn't on PATH in a stock Windows PostgreSQL install — find it under
// Program Files instead of requiring the admin to configure anything.
function resolvePgDumpPath(): string {
  const override = process.env["PG_DUMP_PATH"];
  if (override && existsSync(override)) return override;

  if (process.platform === "win32") {
    const pgRoot = "C:\\Program Files\\PostgreSQL";
    try {
      const versions = readdirSync(pgRoot)
        .filter((v) => /^\d+$/.test(v))
        .sort((a, b) => Number(b) - Number(a));
      for (const v of versions) {
        const candidate = path.join(pgRoot, v, "bin", "pg_dump.exe");
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      // Fall through to the bare command below.
    }
  }
  return "pg_dump";
}

function pruneOldBackups(): void {
  const files = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("erp_database-") && f.endsWith(".sql"))
    .map((f) => ({ name: f, mtime: statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of files.slice(BACKUP_RETENTION_COUNT)) {
    try {
      unlinkSync(path.join(BACKUP_DIR, stale.name));
    } catch {
      // Best-effort cleanup — a leftover old dump isn't worth failing over.
    }
  }
}

let running = false;

// Dumps the whole database to a timestamped .sql file. Never throws — a
// failed backup must never take the app down or block a shutdown.
export async function runDatabaseBackup(): Promise<void> {
  if (running) return; // boot-time and shutdown-time runs can't overlap
  running = true;
  try {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      logger.warn("Skipping automatic backup: DATABASE_URL is not set");
      return;
    }
    mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outFile = path.join(BACKUP_DIR, `erp_database-${stamp}.sql`);
    const pgDump = resolvePgDumpPath();

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        pgDump,
        ["--dbname", databaseUrl, "--file", outFile, "--no-owner", "--no-privileges"],
        { windowsHide: true },
      );
      let stderr = "";
      child.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump exited with code ${code}: ${stderr.slice(0, 500)}`));
      });
    });

    pruneOldBackups();
    logger.info(`Automatic database backup saved to ${outFile}`);
  } catch (err) {
    logger.error({ err }, "Automatic database backup failed");
  } finally {
    running = false;
  }
}

// Starts the backup schedule: runs once on boot, then every day at local
// midnight — same shape as startSubscriptionScheduler.
export function startBackupScheduler(): void {
  void runDatabaseBackup();

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0); // next local midnight
    const delay = next.getTime() - now.getTime();
    setTimeout(() => {
      void runDatabaseBackup();
      scheduleNext();
    }, delay);
  };

  scheduleNext();
  logger.info(`Backup scheduler started (dumps saved to ${BACKUP_DIR})`);
}

// Best-effort final backup when the process is asked to stop — Ctrl+C,
// `pm2 stop`, or Windows shutting the service down. This is the
// "before closing the application" safety net the daily schedule alone
// can't cover.
let shuttingDown = false;
export function registerShutdownBackup(): void {
  const handleSignal = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal} — taking a final backup before exit`);
    void runDatabaseBackup().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
}
