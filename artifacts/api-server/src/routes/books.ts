import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { GST_ACCOUNTANT_ROLE } from "../lib/gst-access";
import {
  LEDGER_GROUPS, isLedgerGroup, ledgerList, trialBalance, profitAndLoss, balanceSheet, dayBook, todayIst, fyStart,
} from "../lib/books";

// Books & Audit (see lib/books.ts) — admin and accountant; the GST Accountant / CA login reads.
const router: IRouter = Router();

function allowed(req: any, res: any, adminOnly = false): boolean {
  const role = req.session?.role;
  if (role === "admin" || (!adminOnly && role === "accountant")) return true;
  // GST Accountant / CA login sees every statement (the books are GST-only) but changes nothing.
  if (role === GST_ACCOUNTANT_ROLE && !adminOnly && req.method === "GET") return true;
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

async function audit(companyId: number, req: any, action: string, description: string, metadata: unknown) {
  const session = req.session;
  await pool.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
    [companyId, action, description, session?.userId ?? 1, session?.name ?? "Unknown", JSON.stringify(metadata)],
  );
}

// A new company starts with the two ledgers almost every business needs.
async function seedDefaultLedgers(companyId: number) {
  await pool.query(
    `INSERT INTO book_ledgers (company_id, name, group_code)
     SELECT $1, v.name, v.grp FROM (VALUES ('Capital Account', 'capital'), ('Depreciation', 'indirect_expense')) AS v(name, grp)
     WHERE NOT EXISTS (SELECT 1 FROM book_ledgers WHERE company_id = $1)
     ON CONFLICT (company_id, name) DO NOTHING`,
    [companyId],
  );
}

// ── Ledgers ──────────────────────────────────────────────────────────

router.get("/books/ledgers", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  try {
    const companyId = getCompanyId(req);
    await seedDefaultLedgers(companyId);
    res.json({
      groups: Object.entries(LEDGER_GROUPS).map(([code, g]) => ({ code, ...g })),
      ledgers: await ledgerList(companyId),
    });
  } catch (err) {
    logger.error({ err }, "GET /books/ledgers failed");
    res.status(500).json({ error: "Failed to load ledgers" });
  }
});

function ledgerInput(body: any): { name: string; group: keyof typeof LEDGER_GROUPS; openingBalance: number } | string {
  const name = String(body?.name ?? "").trim();
  if (!name || name.length > 100) return "Ledger name is required (max 100 characters)";
  if (!isLedgerGroup(body?.group)) return "Choose a group";
  const openingBalance = r2(Number(body?.openingBalance ?? 0));
  if (!Number.isFinite(openingBalance) || openingBalance < 0) return "Opening balance must be 0 or more";
  return { name, group: body.group, openingBalance: LEDGER_GROUPS[body.group as keyof typeof LEDGER_GROUPS].statement === "bs" ? openingBalance : 0 };
}

router.post("/books/ledgers", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const input = ledgerInput(req.body);
  if (typeof input === "string") { res.status(400).json({ error: input }); return; }
  try {
    const companyId = getCompanyId(req);
    const r = await pool.query(
      `INSERT INTO book_ledgers (company_id, name, group_code, opening_balance) VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, name) DO NOTHING RETURNING id`,
      [companyId, input.name, input.group, input.openingBalance],
    );
    if (!r.rows.length) { res.status(409).json({ error: "A ledger with this name already exists" }); return; }
    await audit(companyId, req, "book_ledger_created", `Ledger "${input.name}" created`, { id: r.rows[0].id, ...input });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    logger.error({ err }, "POST /books/ledgers failed");
    res.status(500).json({ error: "Failed to create ledger" });
  }
});

router.patch("/books/ledgers/:id", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const id = Number(req.params.id);
  const input = ledgerInput(req.body);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid ledger" }); return; }
  if (typeof input === "string") { res.status(400).json({ error: input }); return; }
  const isActive = req.body?.isActive !== false;
  try {
    const companyId = getCompanyId(req);
    const dup = await pool.query(`SELECT 1 FROM book_ledgers WHERE company_id = $1 AND name = $2 AND id <> $3`, [companyId, input.name, id]);
    if (dup.rows.length) { res.status(409).json({ error: "A ledger with this name already exists" }); return; }
    const r = await pool.query(
      `UPDATE book_ledgers SET name = $1, group_code = $2, opening_balance = $3, is_active = $4
       WHERE company_id = $5 AND id = $6 RETURNING id`,
      [input.name, input.group, input.openingBalance, isActive, companyId, id],
    );
    if (!r.rows.length) { res.status(404).json({ error: "Ledger not found" }); return; }
    await audit(companyId, req, "book_ledger_edited", `Ledger "${input.name}" edited`, { id, ...input, isActive });
    res.json({ id });
  } catch (err) {
    logger.error({ err }, "PATCH /books/ledgers failed");
    res.status(500).json({ error: "Failed to update ledger" });
  }
});

// ── Journal vouchers ─────────────────────────────────────────────────

router.get("/books/vouchers", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  try {
    const companyId = getCompanyId(req);
    const r = await pool.query(
      `SELECT jv.id, jv.voucher_no, jv.voucher_date::text AS voucher_date, jv.narration, jv.total, jv.status,
              jv.created_by_name, jv.created_at,
              COALESCE(json_agg(json_build_object('ledgerId', jl.ledger_id, 'ledgerName', l.name, 'debit', jl.debit, 'credit', jl.credit) ORDER BY jl.id)
                FILTER (WHERE jl.id IS NOT NULL), '[]') AS lines
       FROM journal_vouchers jv
       LEFT JOIN journal_voucher_lines jl ON jl.voucher_id = jv.id
       LEFT JOIN book_ledgers l ON l.id = jl.ledger_id
       WHERE jv.company_id = $1 AND jv.voucher_date BETWEEN $2::date AND $3::date
       GROUP BY jv.id ORDER BY jv.voucher_date DESC, jv.id DESC`,
      [companyId, period.from, period.to],
    );
    res.json(r.rows.map((v: any) => ({
      id: v.id, voucherNo: v.voucher_no, date: v.voucher_date, narration: v.narration, total: Number(v.total),
      status: v.status, createdByName: v.created_by_name, createdAt: v.created_at,
      lines: v.lines.map((l: any) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
    })));
  } catch (err) {
    logger.error({ err }, "GET /books/vouchers failed");
    res.status(500).json({ error: "Failed to load vouchers" });
  }
});

router.post("/books/vouchers", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const date = req.body?.date;
  const narration = String(req.body?.narration ?? "").trim().slice(0, 500) || null;
  const rawLines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!validDate(date)) { res.status(400).json({ error: "Enter a valid date" }); return; }
  const lines = rawLines.map((l) => ({ ledgerId: Number(l?.ledgerId), debit: r2(Number(l?.debit) || 0), credit: r2(Number(l?.credit) || 0) }));
  if (lines.length < 2 || lines.length > 50) { res.status(400).json({ error: "A voucher needs at least one debit and one credit line" }); return; }
  for (const l of lines) {
    if (!Number.isInteger(l.ledgerId) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0)) {
      res.status(400).json({ error: "Each line needs a ledger and either a debit or a credit amount" });
      return;
    }
  }
  const debit = r2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = r2(lines.reduce((s, l) => s + l.credit, 0));
  if (debit !== credit) { res.status(400).json({ error: `Debit ₹${debit} and credit ₹${credit} must be equal` }); return; }
  if (!lines.some((l) => l.debit > 0) || !lines.some((l) => l.credit > 0)) {
    res.status(400).json({ error: "A voucher needs at least one debit and one credit line" });
    return;
  }

  const companyId = getCompanyId(req);
  const session = (req as any).session;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [...new Set(lines.map((l) => l.ledgerId))];
    const found = await client.query(`SELECT id FROM book_ledgers WHERE company_id = $1 AND id = ANY($2::int[]) AND is_active = true`, [companyId, ids]);
    if (found.rows.length !== ids.length) {
      await client.query("ROLLBACK");
      res.status(400).json({ error: "One of the ledgers was not found or is inactive" });
      return;
    }
    // One numbering per company: JV-1, JV-2, … (lock so two saves can't share one).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('journal_vouchers'), $1)`, [companyId]);
    const next = await client.query(
      `SELECT COALESCE(MAX(SUBSTRING(voucher_no FROM 4)::int), 0) + 1 AS n
       FROM journal_vouchers WHERE company_id = $1 AND voucher_no ~ '^JV-[0-9]+$'`,
      [companyId],
    );
    const voucherNo = `JV-${next.rows[0].n}`;
    const v = await client.query(
      `INSERT INTO journal_vouchers (company_id, voucher_no, voucher_date, narration, total, created_by_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [companyId, voucherNo, date, narration, debit, session?.userId ?? null, session?.name ?? null],
    );
    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_voucher_lines (company_id, voucher_id, ledger_id, debit, credit) VALUES ($1, $2, $3, $4, $5)`,
        [companyId, v.rows[0].id, l.ledgerId, l.debit, l.credit],
      );
    }
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, 'journal_created', $2, $3, $4, $5)`,
      [companyId, `Journal ${voucherNo} saved: ₹${debit}`, session?.userId ?? 1, session?.name ?? "Unknown",
        JSON.stringify({ id: v.rows[0].id, voucherNo, date, lines })],
    );
    await client.query("COMMIT");
    res.status(201).json({ id: v.rows[0].id, voucherNo });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "POST /books/vouchers failed");
    res.status(500).json({ error: "Failed to save voucher" });
  } finally {
    client.release();
  }
});

// Vouchers are never deleted — cancelling keeps the record for audit and
// drops it from every report.
router.post("/books/vouchers/:id/cancel", async (req, res): Promise<void> => {
  if (!allowed(req, res, true)) return;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid voucher" }); return; }
  try {
    const companyId = getCompanyId(req);
    const r = await pool.query(
      `UPDATE journal_vouchers SET status = 'cancelled', cancelled_at = NOW()
       WHERE company_id = $1 AND id = $2 AND status = 'saved' RETURNING voucher_no, total`,
      [companyId, id],
    );
    if (!r.rows.length) { res.status(404).json({ error: "Voucher not found or already cancelled" }); return; }
    await audit(companyId, req, "journal_cancelled", `Journal ${r.rows[0].voucher_no} cancelled (₹${r.rows[0].total})`, { id });
    res.json({ id });
  } catch (err) {
    logger.error({ err }, "POST /books/vouchers/:id/cancel failed");
    res.status(500).json({ error: "Failed to cancel voucher" });
  }
});

// ── Statements ───────────────────────────────────────────────────────

router.get("/books/trial-balance", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  try {
    res.json(await trialBalance(getCompanyId(req), period.to, period.from));
  } catch (err) {
    logger.error({ err }, "GET /books/trial-balance failed");
    res.status(500).json({ error: "Failed to build Trial Balance" });
  }
});

router.get("/books/profit-loss", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  try {
    res.json(await profitAndLoss(getCompanyId(req), period.from, period.to));
  } catch (err) {
    logger.error({ err }, "GET /books/profit-loss failed");
    res.status(500).json({ error: "Failed to build Profit & Loss" });
  }
});

router.get("/books/balance-sheet", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  try {
    res.json(await balanceSheet(getCompanyId(req), period.to, period.from));
  } catch (err) {
    logger.error({ err }, "GET /books/balance-sheet failed");
    res.status(500).json({ error: "Failed to build Balance Sheet" });
  }
});

router.get("/books/day-book", async (req, res): Promise<void> => {
  if (!allowed(req, res)) return;
  const period = periodFromQuery(req);
  if (!period) { res.status(400).json({ error: "Invalid date range" }); return; }
  try {
    res.json(await dayBook(getCompanyId(req), period.from, period.to));
  } catch (err) {
    logger.error({ err }, "GET /books/day-book failed");
    res.status(500).json({ error: "Failed to build Day Book" });
  }
});

export default router;
