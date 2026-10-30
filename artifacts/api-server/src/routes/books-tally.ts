import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { todayIst, fyStart } from "../lib/books";
import { tallyExport, parseTally, tallyTag } from "../lib/tally";
import { GST_ACCOUNTANT_ROLE, isGstAccountant } from "../lib/gst-access";

// Books & Audit: Tally XML export / import and the audit trail. Reading is
// open to admin, accountant and the read-only GST Accountant / CA login; importing writes
// ledgers and Journals, so it is admin and accountant only.
const router: IRouter = Router();

function allowed(req: any, res: any, write = false): boolean {
  const role = req.session?.role;
  if (role === "admin" || role === "accountant" || (!write && role === GST_ACCOUNTANT_ROLE)) return true;
  res.status(403).json({ error: "Forbidden" });
  return false;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: unknown): v is string => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

function periodFromQuery(req: any): { from: string; to: string } | null {
  const to = req.query.to ? String(req.query.to) : todayIst();
  const from = req.query.from ? String(req.query.from) : fyStart(to);
  if (!validDate(to) || !validDate(from) || from > to) return null;
  return { from, to };
}

async function audit(db: { query: typeof pool.query }, companyId: number, req: any, action: string, description: string, metadata: unknown) {
  const session = req.session;
  await db.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
    [companyId, action, description, session?.userId ?? 1, session?.name ?? "Unknown", JSON.stringify(metadata)],
  );
}

// ── Tally export ─────────────────────────────────────────────────────

router.get("/books/tally/export", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  try {
    const companyId = getCompanyId(req);
    const out = await tallyExport(companyId, period.from, period.to);
    await audit(pool, companyId, req, "tally_exported",
      `Tally XML exported for ${period.from} to ${period.to} (${out.vouchers} vouchers)`, { ...period, vouchers: out.vouchers, ledgers: out.ledgers });
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="tally-${period.from}-to-${period.to}.xml"`);
    res.send(out.xml);
  } catch (err) {
    logger.error({ err }, "GET /books/tally/export failed");
    res.status(500).json({ error: "Failed to build Tally export" });
  }
});

// ── Tally import ─────────────────────────────────────────────────────
// POST { xml, dryRun } — dryRun returns what would happen without saving.

router.post("/books/tally/import", async (req, res): Promise<void> => {
  if (!allowed(req, res, true)) return;
  const xml = typeof req.body?.xml === "string" ? req.body.xml : "";
  const dryRun = req.body?.dryRun !== false;
  if (!/<ENVELOPE[\s>]/i.test(xml)) { res.status(400).json({ error: "This is not a Tally XML file (no <ENVELOPE>)" }); return; }
  const parsed = parseTally(xml);
  if (parsed.journals.length > 3000) { res.status(400).json({ error: "More than 3000 Journals — export a shorter period from Tally" }); return; }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('journal_vouchers'), $1)`, [companyId]);

    // Ledgers: new names are created, existing ones are left as they are.
    const existing = await client.query(`SELECT id, name, is_active FROM book_ledgers WHERE company_id = $1`, [companyId]);
    const byName = new Map<string, { id: number; active: boolean }>(
      existing.rows.map((r: any) => [String(r.name).toLowerCase(), { id: r.id, active: r.is_active }]));
    const ledgersNew = parsed.ledgers.filter((l) => !byName.has(l.name.toLowerCase()));
    const ledgersExisting = parsed.ledgers.filter((l) => byName.has(l.name.toLowerCase())).map((l) => l.name);
    if (!dryRun) {
      for (const l of ledgersNew) {
        const r = await client.query(
          `INSERT INTO book_ledgers (company_id, name, group_code, opening_balance) VALUES ($1, $2, $3, $4)
           ON CONFLICT (company_id, name) DO NOTHING RETURNING id`,
          [companyId, l.name, l.group, l.openingBalance],
        );
        if (r.rows.length) byName.set(l.name.toLowerCase(), { id: r.rows[0].id, active: true });
      }
    } else {
      for (const l of ledgersNew) byName.set(l.name.toLowerCase(), { id: -1, active: true });
    }

    // Journals: every line must be a Books ledger, debits = credits, and
    // the same Tally voucher must not be in Books already.
    const journalsOk: { date: string; no: string; total: number }[] = [];
    const journalsSkipped: { no: string; date: string; reason: string }[] = [];
    const next = await client.query(
      `SELECT COALESCE(MAX(SUBSTRING(voucher_no FROM 4)::int), 0) AS n FROM journal_vouchers WHERE company_id = $1 AND voucher_no ~ '^JV-[0-9]+$'`,
      [companyId],
    );
    let seq: number = next.rows[0].n;
    for (const j of parsed.journals) {
      const label = j.no || "—";
      const debit = r2(j.lines.reduce((s, l) => s + l.debit, 0));
      const credit = r2(j.lines.reduce((s, l) => s + l.credit, 0));
      const missing = j.lines.map((l) => l.ledger).filter((name) => !byName.get(name.toLowerCase())?.active);
      let reason = "";
      if (!validDate(j.date)) reason = "No valid date";
      else if (j.lines.length < 2 || debit === 0) reason = "Fewer than two lines";
      else if (debit !== credit) reason = `Debit ₹${debit} ≠ credit ₹${credit}`;
      else if (missing.length) reason = `Ledger not in Books: ${[...new Set(missing)].slice(0, 3).join(", ")}`;
      if (!reason) {
        const tag = tallyTag(j);
        const dup = await client.query(
          `SELECT 1 FROM journal_vouchers WHERE company_id = $1 AND voucher_date = $2::date AND total = $3 AND status = 'saved' AND narration LIKE $4 LIMIT 1`,
          [companyId, j.date, debit, `%${tag.replace(/[%_\\]/g, "\\$&")}`],
        );
        if (dup.rows.length) reason = "Already imported";
      }
      if (reason) { journalsSkipped.push({ no: label, date: j.date, reason }); continue; }
      journalsOk.push({ date: j.date, no: label, total: debit });
      if (dryRun) continue;

      const voucherNo = `JV-${++seq}`;
      const narration = `${j.narration ? `${j.narration} ` : ""}${tallyTag(j)}`.slice(0, 500);
      const v = await client.query(
        `INSERT INTO journal_vouchers (company_id, voucher_no, voucher_date, narration, total, created_by_id, created_by_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [companyId, voucherNo, j.date, narration, debit, session?.userId ?? null, session?.name ?? null],
      );
      for (const l of j.lines) {
        await client.query(
          `INSERT INTO journal_voucher_lines (company_id, voucher_id, ledger_id, debit, credit) VALUES ($1, $2, $3, $4, $5)`,
          [companyId, v.rows[0].id, byName.get(l.ledger.toLowerCase())!.id, l.debit, l.credit],
        );
      }
    }

    const summary = {
      ledgersCreated: ledgersNew.map((l) => ({ name: l.name, group: l.group, openingBalance: l.openingBalance, warning: l.warning })),
      ledgersExisting,
      ledgersSkipped: parsed.skippedLedgers,
      journalsImported: journalsOk,
      journalsSkipped,
      vouchersSkipped: parsed.skippedVouchers,
    };
    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await audit(client, companyId, req, "tally_imported",
        `Tally XML imported: ${ledgersNew.length} ledgers, ${journalsOk.length} Journals`,
        { ledgers: ledgersNew.map((l) => l.name), journals: journalsOk });
      await client.query("COMMIT");
    }
    res.json({ dryRun, ...summary });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "POST /books/tally/import failed");
    res.status(500).json({ error: "Failed to import Tally data" });
  } finally {
    client.release();
  }
});

// ── Audit trail ──────────────────────────────────────────────────────
// Every create / edit / cancel / delete the ERP logs, newest first. The log
// is append-only — nothing here edits or removes it.
//
// The GST Accountant / CA login sees only the Books entries and the entries
// about a GST invoice or GST purchase bill (by the invoiceId / purchaseId the
// entry's details carry) — nothing about non-GST bills.
const GST_SCOPE = `(
  action IN ('journal_created', 'journal_cancelled', 'book_ledger_created', 'book_ledger_edited', 'tally_imported', 'tally_exported')
  OR EXISTS (SELECT 1 FROM invoices gi WHERE gi.company_id = audit_log.company_id AND gi.invoice_type = 'gst'
             AND gi.id = NULLIF(substring(audit_log.metadata from '"invoiceId": *([0-9]{1,9})'), '')::int)
  OR EXISTS (SELECT 1 FROM purchases gp WHERE gp.company_id = audit_log.company_id AND gp.bill_type = 'gst'
             AND gp.id = NULLIF(substring(audit_log.metadata from '"purchaseId": *([0-9]{1,9})'), '')::int)
  OR (action = 'invoice_permanently_deleted' AND description LIKE 'GST invoice %')
)`;

router.get("/books/audit-trail", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  const userId = req.query.userId ? Number(req.query.userId) : null;
  const action = req.query.action ? String(req.query.action).slice(0, 80) : null;
  const q = String(req.query.q ?? "").trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  if (userId !== null && !Number.isInteger(userId)) { res.status(400).json({ error: "Invalid user" }); return; }
  try {
    const companyId = getCompanyId(req);
    const scope = [`company_id = $1`, `(created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $2::date AND $3::date`];
    if (isGstAccountant(req)) scope.push(GST_SCOPE);
    const where = [...scope];
    const params: unknown[] = [companyId, period.from, period.to];
    if (userId !== null) { params.push(userId); where.push(`user_id = $${params.length}`); }
    if (action) { params.push(action); where.push(`action = $${params.length}`); }
    if (q) { params.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`); where.push(`(description ILIKE $${params.length} OR user_name ILIKE $${params.length})`); }
    const base = `FROM audit_log WHERE ${where.join(" AND ")}`;
    const [rows, count, users, actions] = await Promise.all([
      pool.query(`SELECT id, action, description, user_id, user_name, metadata, created_at ${base} ORDER BY created_at DESC, id DESC LIMIT ${limit}`, params),
      pool.query(`SELECT COUNT(*)::int AS n ${base}`, params),
      pool.query(
        `SELECT user_id, MAX(user_name) AS user_name FROM audit_log WHERE ${scope.join(" AND ")}
         GROUP BY user_id ORDER BY MAX(user_name)`, [companyId, period.from, period.to]),
      pool.query(
        `SELECT action, COUNT(*)::int AS n FROM audit_log WHERE ${scope.join(" AND ")}
         GROUP BY action ORDER BY action`, [companyId, period.from, period.to]),
    ]);
    res.json({
      total: count.rows[0].n,
      rows: rows.rows.map((r: any) => ({
        id: r.id, action: r.action, description: r.description ?? null, userId: r.user_id, userName: r.user_name ?? null,
        metadata: r.metadata ?? null, createdAt: new Date(r.created_at).toISOString(),
      })),
      users: users.rows.map((u: any) => ({ id: u.user_id, name: u.user_name ?? `User ${u.user_id}` })),
      actions: actions.rows.map((a: any) => ({ action: a.action, count: a.n })),
    });
  } catch (err) {
    logger.error({ err }, "GET /books/audit-trail failed");
    res.status(500).json({ error: "Failed to load audit trail" });
  }
});

export default router;
