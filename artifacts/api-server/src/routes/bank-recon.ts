import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import {
  importStatement, suggestFor, confirmLine, ignoreLine, undoLine,
  ReconError, MAX_LINES, type ReconAction, type ReconUser,
} from "../lib/bank-recon";

// Bank Reconciliation (lib/bank-recon.ts). Reading is for admin and
// accountant, like Cash Book; booking from the statement is admin only.
const router: IRouter = Router();

const READ_ROLES = new Set(["admin", "accountant", "super_admin"]);
const WRITE_ROLES = new Set(["admin", "super_admin"]);

function allowed(req: any, res: any, roles: Set<string>): boolean {
  if (!roles.has(req.session?.role)) {
    res.status(403).json({ error: roles === WRITE_ROLES ? "Only admin can do this" : "Forbidden" });
    return false;
  }
  return true;
}

const userOf = (req: any): ReconUser => ({
  userId: req.session?.userId ?? null,
  name: req.session?.name ?? req.session?.username ?? null,
  role: req.session?.role ?? null,
});

function formatLine(r: any, suggestion: any) {
  return {
    id: r.id,
    date: r.day,
    description: r.description,
    refNo: r.ref_no ?? null,
    debit: Number(r.debit),
    credit: Number(r.credit),
    balance: r.balance == null ? null : Number(r.balance),
    status: r.status,
    matchedKind: r.matched_kind ?? null,
    matchedLabel: r.matched_label ?? null,
    matchedByName: r.matched_by_name ?? null,
    receiptNo: r.receipt_no ?? null,
    fileName: r.file_name ?? null,
    suggestion: suggestion ?? null,
  };
}

// GET /bank-recon/lines?accountId=&status=open|matched|ignored|all
router.get("/bank-recon/lines", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  const accountId = Number(req.query.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0) { res.status(400).json({ error: "Pick a bank account" }); return; }
  const status = String(req.query.status ?? "open");
  const statusSql = status === "matched" ? `AND l.status = 'matched'`
    : status === "ignored" ? `AND l.status = 'ignored'`
    : status === "all" ? "" : `AND l.status = 'pending'`;
  try {
    const { rows } = await pool.query(
      `SELECT l.*, l.txn_date::text AS day FROM bank_statement_lines l
        WHERE l.company_id = $1 AND l.account_id = $2 ${statusSql}
        ORDER BY l.txn_date DESC, l.id DESC LIMIT 3000`,
      [companyId, accountId],
    );
    // txn_date as the "YYYY-MM-DD" text (pg returns DATE as a JS Date).
    const pending = rows.filter((r: any) => r.status === "pending").map((r: any) => ({ ...r, txn_date: r.day }));
    const suggestions = await suggestFor(pool, companyId, accountId, pending);
    const [counts, acct, last] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*)::int AS n FROM bank_statement_lines WHERE company_id = $1 AND account_id = $2 GROUP BY status`,
        [companyId, accountId],
      ),
      pool.query(`SELECT current_balance::float AS bal FROM accounts WHERE company_id = $1 AND id = $2`, [companyId, accountId]),
      pool.query(
        `SELECT balance::float AS bal, txn_date::text AS day FROM bank_statement_lines
          WHERE company_id = $1 AND account_id = $2 AND balance IS NOT NULL ORDER BY txn_date DESC, id DESC LIMIT 1`,
        [companyId, accountId],
      ),
    ]);
    const n = Object.fromEntries(counts.rows.map((c: any) => [c.status, c.n]));
    res.json({
      lines: rows.map((r: any) => formatLine(r, suggestions.get(r.id))),
      summary: {
        open: n.pending ?? 0,
        matched: n.matched ?? 0,
        ignored: n.ignored ?? 0,
        bookBalance: acct.rows[0]?.bal ?? null,
        statementBalance: last.rows[0]?.bal ?? null,
        statementBalanceDate: last.rows[0]?.day ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /bank-recon/lines failed");
    res.status(500).json({ error: "Could not load the statement" });
  }
});

// POST /bank-recon/import { accountId, rows, fileName, dryRun }
router.post("/bank-recon/import", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows?.length) { res.status(400).json({ error: "No entries found in the file" }); return; }
  if (rows.length > MAX_LINES) { res.status(400).json({ error: `At most ${MAX_LINES} entries at a time — upload a shorter period` }); return; }
  const accountId = Number(req.body?.accountId);
  if (!Number.isInteger(accountId) || accountId <= 0) { res.status(400).json({ error: "Pick a bank account" }); return; }
  const dryRun = req.body?.dryRun !== false;
  const companyId = getCompanyId(req);
  const user = userOf(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bank_recon_import'), $1)`, [companyId]);
    const out = await importStatement(client, companyId, {
      accountId, rows, dryRun, userName: user.name,
      fileName: typeof req.body?.fileName === "string" ? req.body.fileName.slice(0, 200) : null,
    });
    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query(
        `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, "bank_statement_imported", `Bank statement: ${out.added} entries added (${out.from ?? "?"} to ${out.to ?? "?"})`,
         user.userId ?? 1, user.name ?? "Unknown", JSON.stringify({ accountId, added: out.added, duplicates: out.duplicates, fileName: req.body?.fileName ?? null })],
      );
      await client.query("COMMIT");
    }
    res.json({ dryRun, ...out });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof ReconError) { res.status(400).json({ error: err.message }); return; }
    logger.error({ err }, "POST /bank-recon/import failed");
    res.status(500).json({ error: "Import failed — nothing was saved" });
  } finally {
    client.release();
  }
});

async function inTxn(res: any, what: string, fn: (client: any) => Promise<any>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    res.json(out ?? { ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof ReconError) { res.status(400).json({ error: err.message }); return; }
    logger.error({ err }, `${what} failed`);
    res.status(500).json({ error: "Could not save — nothing was changed" });
  } finally {
    client.release();
  }
}

const lineIdOf = (req: any) => Number(req.params.id);

// POST /bank-recon/lines/:id/confirm { action }
router.post("/bank-recon/lines/:id/confirm", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  await inTxn(res, "confirm bank line", (c) => confirmLine(c, companyId, userOf(req), lineIdOf(req), req.body?.action as ReconAction));
});

// POST /bank-recon/confirm-many { items: [{ lineId, action }] } — each line
// in its own transaction, so one bad line doesn't hold back the rest.
router.post("/bank-recon/confirm-many", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
  const companyId = getCompanyId(req);
  const user = userOf(req);
  const results: Array<{ lineId: number; ok: boolean; label?: string; error?: string }> = [];
  for (const it of items) {
    const lineId = Number(it?.lineId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await confirmLine(client, companyId, user, lineId, it?.action as ReconAction);
      await client.query("COMMIT");
      results.push({ lineId, ok: true, label: r.label });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (!(err instanceof ReconError)) logger.error({ err, lineId }, "confirm-many line failed");
      results.push({ lineId, ok: false, error: err instanceof ReconError ? err.message : "Could not save" });
    } finally {
      client.release();
    }
  }
  res.json({ done: results.filter((r) => r.ok).length, results });
});

router.post("/bank-recon/lines/:id/ignore", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  await inTxn(res, "ignore bank line", (c) => ignoreLine(c, companyId, userOf(req), lineIdOf(req)));
});

router.post("/bank-recon/lines/:id/undo", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  await inTxn(res, "undo bank line", (c) => undoLine(c, companyId, userOf(req), lineIdOf(req)));
});

// DELETE /bank-recon/lines/:id — an open line read wrongly from the file.
router.delete("/bank-recon/lines/:id", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const r = await pool.query(
    `DELETE FROM bank_statement_lines WHERE company_id = $1 AND id = $2 AND status <> 'matched' RETURNING id`,
    [companyId, lineIdOf(req)],
  );
  if (!r.rows.length) { res.status(400).json({ error: "Only an open or ignored line can be removed — undo it first" }); return; }
  res.json({ ok: true });
});

export default router;
