import { pool } from "@workspace/db";
import { logger } from "./logger";

// Settings → Data Management → Non-GST Data Cleanup.
//
// "Delete" here is a retention-safe delete: the bill row gets deleted_at set
// and nothing else changes. Its status stays 'saved', so every report that
// sums saved bills (Sales/Other Sales registers, Purchase/Other Purchase, P&L,
// COGS, dashboard) keeps the same totals, and its stock_movements,
// ledger_entries, payments and allocations are never touched — stock, party
// balances and Cash Book stay exactly as they were. What changes is
// visibility: deleted bills drop out of every bill list and only an admin
// can still open one by its link. There is deliberately no restore — a
// delete is final.
//
// Bills are picked only by verified type + tenant: invoice_type / bill_type
// = 'non_gst', status 'saved', company_id = the caller's company. A bill is
// left alone (and the reason shown) when deleting it would hide something
// still open — an unpaid balance, a payment not yet collected, a sales
// return, an E-Way Bill, a GST amount, or a legal hold.
//
// "Permanent delete" (permanent: true) goes further, on the admin's explicit
// choice: the bill row and everything that only describes the bill — line
// items, its party-ledger lines, payment allocations, the auto "Discount"
// expense, purchase attachments — are removed, so the bill drops out of every
// report total (P&L, registers, dashboard). What really happened stays real:
// stock_movements and current stock, Cash Book (account_transactions),
// payments, party balances (entities.outstanding_balance) and salesman
// commission are kept. The same eligibility rules apply, and bills hidden by
// an earlier normal delete are picked up too. Statutory retention (Companies
// Act s.128, CGST s.36 / Rule 56 — 8 years) is the admin's call; the screen
// says so before they confirm.

export type CleanupCategory = "sales" | "purchase";
export const CLEANUP_CATEGORIES: CleanupCategory[] = ["sales", "purchase"];
export const SCHEDULE_FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const STATUTORY_RETENTION_YEARS = 8;

type Queryable = { query: (text: string, params?: any[]) => Promise<any> };

export interface Operator {
  userId: number;
  name: string;
}

export interface DateRange {
  // YYYY-MM-DD, inclusive. A null `from` means "from the beginning".
  from: string | null;
  to: string;
}

export interface CleanupCandidate {
  id: number;
  recordNo: string;
  recordDate: string;
  partyName: string | null;
  amount: number;
  // null = eligible; otherwise why it was left alone.
  reason: string | null;
}

const TABLES = {
  sales: {
    table: "invoices",
    noCol: "invoice_no",
    dateCol: "invoice_date",
    partyCol: "customer_name",
    typeCol: "invoice_type",
    label: "Non-GST Sales",
  },
  purchase: {
    table: "purchases",
    noCol: "bill_no",
    dateCol: "bill_date",
    partyCol: "vendor_name",
    typeCol: "bill_type",
    label: "Non-GST Purchase",
  },
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isCategory(v: unknown): v is CleanupCategory {
  return v === "sales" || v === "purchase";
}

export function validateRange(range: { from?: unknown; to?: unknown }): DateRange | string {
  const from = range.from == null || range.from === "" ? null : String(range.from);
  const to = String(range.to ?? "");
  if (from !== null && !DATE_RE.test(from)) return "Invalid from date";
  if (!DATE_RE.test(to)) return "Invalid to date";
  if (from !== null && from > to) return "From date is after To date";
  if (to > todayLocal()) return "To date cannot be in the future";
  return { from, to };
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The reason a bill must be left alone, or NULL when it may be deleted.
// Order matters only for which single reason is shown.
function reasonSql(category: CleanupCategory): string {
  if (category === "sales") {
    return `CASE
      WHEN b.legal_hold THEN 'Under legal hold'
      WHEN b.balance_due > 0.005 THEN 'Unpaid balance of ₹' || to_char(b.balance_due, 'FM999999990.00') || ' still due'
      WHEN COALESCE(b.e_way_bill_no, '') <> '' THEN 'Has an E-Way Bill'
      WHEN b.total_tax > 0 OR b.cgst > 0 OR b.sgst > 0 OR b.igst > 0 THEN 'Shows a GST amount — check the bill type'
      WHEN EXISTS (
        SELECT 1 FROM payments p
         WHERE p.company_id = b.company_id AND p.invoice_id = b.id
           AND (p.status = 'pending' OR (p.status = 'approved' AND p.account_id IS NULL))
      ) THEN 'Payment awaiting approval or collection'
      WHEN EXISTS (
        SELECT 1 FROM sales_returns sr
         WHERE sr.company_id = b.company_id AND sr.invoice_id = b.id AND sr.status <> 'cancelled'
      ) THEN 'Has a sales return'
      ELSE NULL END`;
  }
  // No per-bill balance check for purchases: supplier payments are settled
  // against the supplier's account (entities.outstanding_balance), never the
  // bill, so purchases.balance_due always equals grand_total. Deleting a bill
  // leaves that account and its ledger untouched.
  return `CASE
    WHEN b.legal_hold THEN 'Under legal hold'
    WHEN b.total_tax > 0 OR b.cgst > 0 OR b.sgst > 0 OR b.igst > 0 THEN 'Shows a GST amount (possible input credit) — check the bill type'
    WHEN EXISTS (
      SELECT 1 FROM purchase_returns pr
       WHERE pr.company_id = b.company_id AND pr.purchase_id = b.id AND pr.status <> 'cancelled'
    ) THEN 'Has a debit note (purchase return)'
    ELSE NULL END`;
}

// Every live Non-GST bill of this company in the range, each marked eligible
// or not. `lock` row-locks them for the duration of the caller's transaction
// so nothing can be paid/edited/returned between the check and the delete.
// `includeHidden` also lists bills an earlier normal delete already hid — a
// permanent delete removes those too.
export async function classifyBills(
  db: Queryable,
  companyId: number,
  category: CleanupCategory,
  range: DateRange,
  opts: { lock?: boolean; includeHidden?: boolean } = {},
): Promise<CleanupCandidate[]> {
  const t = TABLES[category];
  const { rows } = await db.query(
    `SELECT b.id, b.${t.noCol} AS record_no, b.${t.dateCol} AS record_date,
            b.${t.partyCol} AS party_name, b.grand_total AS amount,
            ${reasonSql(category)} AS reason
       FROM ${t.table} b
      WHERE b.company_id = $1
        AND b.${t.typeCol} = 'non_gst'
        AND b.status = 'saved'
        ${opts.includeHidden ? "" : "AND b.deleted_at IS NULL"}
        AND ($2::date IS NULL OR b.${t.dateCol} >= $2::date)
        AND b.${t.dateCol} < ($3::date + INTERVAL '1 day')
      ORDER BY b.${t.dateCol} ASC, b.id ASC
      ${opts.lock ? "FOR UPDATE OF b" : ""}`,
    [companyId, range.from, range.to],
  );
  return rows.map((r: any) => ({
    id: r.id,
    recordNo: r.record_no,
    recordDate: new Date(r.record_date).toISOString(),
    partyName: r.party_name ?? null,
    amount: Number(r.amount),
    reason: r.reason ?? null,
  }));
}

// Linked rows of the given bills, by kind. All are kept unchanged by a delete
// — shown in the preview so the admin can see nothing else is touched.
async function countLinkedRecords(db: Queryable, companyId: number, category: CleanupCategory, ids: number[]) {
  if (ids.length === 0) return {};
  if (category === "sales") {
    const { rows } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM invoice_items WHERE company_id = $1 AND invoice_id = ANY($2::int[]))::int AS "lineItems",
         (SELECT COUNT(*) FROM stock_movements WHERE company_id = $1 AND reference_type = 'invoice' AND reference_id = ANY($2::int[]))::int AS "stockMovements",
         (SELECT COUNT(*) FROM ledger_entries WHERE company_id = $1 AND type LIKE 'invoice%' AND reference_id = ANY($2::int[]))::int AS "ledgerEntries",
         (SELECT COUNT(*) FROM payment_allocations WHERE company_id = $1 AND invoice_id = ANY($2::int[]))::int AS "paymentAllocations",
         (SELECT COUNT(*) FROM payments WHERE company_id = $1 AND invoice_id = ANY($2::int[]))::int AS "payments",
         (SELECT COUNT(*) FROM expenses WHERE company_id = $1 AND invoice_id = ANY($2::int[]))::int AS "discountExpenses"`,
      [companyId, ids],
    );
    return rows[0];
  }
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM purchase_items WHERE company_id = $1 AND purchase_id = ANY($2::int[]))::int AS "lineItems",
       (SELECT COUNT(*) FROM stock_movements WHERE company_id = $1 AND reference_type = 'purchase' AND reference_id = ANY($2::int[]))::int AS "stockMovements",
       (SELECT COUNT(*) FROM ledger_entries WHERE company_id = $1 AND type = 'purchase' AND reference_id = ANY($2::int[]))::int AS "ledgerEntries",
       (SELECT COUNT(*) FROM purchase_attachments WHERE company_id = $1 AND purchase_id = ANY($2::int[]))::int AS "attachments"`,
    [companyId, ids],
  );
  return rows[0];
}

const PREVIEW_ROW_LIMIT = 500;

export async function previewCleanup(companyId: number, category: CleanupCategory, range: DateRange, permanent = false) {
  const all = await classifyBills(pool, companyId, category, range, { includeHidden: permanent });
  const eligible = all.filter((c) => c.reason === null);
  const excluded = all.filter((c) => c.reason !== null);
  const linkedRecords = await countLinkedRecords(pool, companyId, category, eligible.map((c) => c.id));
  return {
    category,
    permanent,
    dateFrom: range.from,
    dateTo: range.to,
    eligibleCount: eligible.length,
    eligibleValue: round2(eligible.reduce((s, c) => s + c.amount, 0)),
    excludedCount: excluded.length,
    excludedValue: round2(excluded.reduce((s, c) => s + c.amount, 0)),
    linkedRecords,
    eligible: eligible.slice(0, PREVIEW_ROW_LIMIT),
    excluded: excluded.slice(0, PREVIEW_ROW_LIMIT),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function insertJobItems(db: Queryable, companyId: number, jobId: number, items: CleanupCandidate[], outcome: (c: CleanupCandidate) => string) {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    await db.query(
      `INSERT INTO non_gst_cleanup_job_items (company_id, job_id, record_id, record_no, record_date, party_name, amount, outcome, reason)
       SELECT $1, $2, x.record_id, x.record_no, x.record_date, x.party_name, x.amount, x.outcome, x.reason
         FROM unnest($3::int[], $4::text[], $5::timestamptz[], $6::text[], $7::numeric[], $8::text[], $9::text[])
           AS x(record_id, record_no, record_date, party_name, amount, outcome, reason)`,
      [
        companyId, jobId,
        chunk.map((c) => c.id),
        chunk.map((c) => c.recordNo),
        chunk.map((c) => c.recordDate),
        chunk.map((c) => c.partyName),
        chunk.map((c) => c.amount),
        chunk.map(outcome),
        chunk.map((c) => c.reason),
      ],
    );
  }
}

const BATCH_SIZE = 500;

export interface RunDeleteParams {
  companyId: number;
  category: CleanupCategory;
  range: DateRange;
  trigger: "manual" | "scheduled";
  // Same key → same job; a double-click or a retried request never runs twice.
  idempotencyKey: string;
  operator: Operator;
  // true = remove the rows for good (see the header comment); default hides.
  permanent?: boolean;
  // Test seam: called after each batch inside the transaction.
  afterBatch?: (batchNo: number) => Promise<void>;
}

// Deletes every eligible bill in the range in ONE transaction: either all of
// them are deleted (and the job + its per-bill rows + audit entry are
// written) or, on any failure, none are and the job is marked failed.
export async function runDelete(p: RunDeleteParams) {
  const t = TABLES[p.category];
  const permanent = p.permanent === true;
  const created = await pool.query(
    `INSERT INTO non_gst_cleanup_jobs (company_id, category, trigger, action, date_from, date_to, status, idempotency_key, operator_user_id, operator_name)
     VALUES ($1, $2, $3, $9, $4, $5, 'running', $6, $7, $8)
     ON CONFLICT (company_id, idempotency_key) DO NOTHING
     RETURNING id`,
    [p.companyId, p.category, p.trigger, p.range.from, p.range.to, p.idempotencyKey, p.operator.userId, p.operator.name,
      permanent ? "permanent_delete" : "delete"],
  );
  if (created.rowCount === 0) {
    const existing = await pool.query(
      `SELECT * FROM non_gst_cleanup_jobs WHERE company_id = $1 AND idempotency_key = $2`,
      [p.companyId, p.idempotencyKey],
    );
    return { job: formatJob(existing.rows[0]), duplicate: true };
  }
  const jobId: number = created.rows[0].id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One cleanup at a time per company (manual and scheduled alike).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('non_gst_cleanup'), $1)`, [p.companyId]);

    // Re-check every rule on locked rows — the preview the admin saw may be
    // minutes old, and a scheduled run has no preview at all.
    const all = await classifyBills(client, p.companyId, p.category, p.range, { lock: true, includeHidden: permanent });
    const eligible = all.filter((c) => c.reason === null);
    const excluded = all.filter((c) => c.reason !== null);

    let deleted = 0;
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const ids = eligible.slice(i, i + BATCH_SIZE).map((c) => c.id);
      if (permanent) {
        deleted += await purgeBills(client, p.companyId, p.category, ids);
      } else {
        const res = await client.query(
          `UPDATE ${t.table}
              SET deleted_at = NOW(), deleted_by_user_id = $3, delete_job_id = $4
            WHERE company_id = $1 AND id = ANY($2::int[]) AND deleted_at IS NULL
              AND ${t.typeCol} = 'non_gst' AND status = 'saved'`,
          [p.companyId, ids, p.operator.userId, jobId],
        );
        deleted += res.rowCount ?? 0;
      }
      if (p.afterBatch) await p.afterBatch(i / BATCH_SIZE);
    }
    if (deleted !== eligible.length) {
      throw new Error(`Expected to delete ${eligible.length} bills but ${deleted} matched — aborted`);
    }

    await insertJobItems(client, p.companyId, jobId, eligible, () => "deleted");
    await insertJobItems(client, p.companyId, jobId, excluded, () => "excluded");

    const totalValue = round2(eligible.reduce((s, c) => s + c.amount, 0));
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        p.companyId,
        permanent ? `non_gst_${p.category}_permanently_deleted` : `non_gst_${p.category}_deleted`,
        permanent
          ? `${t.label} permanent delete (${p.trigger}): ${deleted} bill(s) worth ₹${totalValue.toFixed(2)} removed from every report, ${excluded.length} left alone — ${p.range.from ?? "start"} to ${p.range.to}. Stock, Cash Book and party balances unchanged.`
          : `${t.label} cleanup (${p.trigger}): ${deleted} bill(s) worth ₹${totalValue.toFixed(2)} deleted, ${excluded.length} left alone — ${p.range.from ?? "start"} to ${p.range.to}. Report totals, stock and ledgers unchanged.`,
        p.operator.userId,
        p.operator.name,
        JSON.stringify({
          jobId, category: p.category, trigger: p.trigger, permanent, dateFrom: p.range.from, dateTo: p.range.to,
          deletedCount: deleted, excludedCount: excluded.length, totalValue,
        }),
      ],
    );

    const done = await client.query(
      `UPDATE non_gst_cleanup_jobs
          SET status = 'succeeded', eligible_count = $2, processed_count = $3, excluded_count = $4,
              total_value = $5, finished_at = NOW()
        WHERE id = $1 RETURNING *`,
      [jobId, eligible.length, deleted, excluded.length, totalValue],
    );
    await client.query("COMMIT");
    return { job: formatJob(done.rows[0]), duplicate: false };
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err, jobId, companyId: p.companyId, category: p.category }, "Non-GST cleanup job failed — rolled back");
    const failed = await pool.query(
      `UPDATE non_gst_cleanup_jobs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1 RETURNING *`,
      [jobId, String(err?.message ?? err).slice(0, 500)],
    );
    await pool.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        p.companyId,
        `non_gst_${p.category}_delete_failed`,
        `${t.label} cleanup (${p.trigger}) failed and was rolled back — no bills changed`,
        p.operator.userId,
        p.operator.name,
        JSON.stringify({ jobId, error: String(err?.message ?? err).slice(0, 500) }),
      ],
    ).catch(() => {});
    return { job: formatJob(failed.rows[0]), duplicate: false };
  } finally {
    client.release();
  }
}

// Removes the given (already verified, row-locked) bills and the rows that
// only describe them. Stock movements, Cash Book, payments, party balances and
// commission are deliberately kept. Returns how many bills were removed.
async function purgeBills(db: Queryable, companyId: number, category: CleanupCategory, ids: number[]): Promise<number> {
  if (category === "sales") {
    // account_transactions.invoice_id has a real FK; the rest are loose refs.
    await db.query(`UPDATE account_transactions SET invoice_id = NULL WHERE company_id = $1 AND invoice_id = ANY($2::int[])`, [companyId, ids]);
    await db.query(`UPDATE payments SET invoice_id = NULL WHERE company_id = $1 AND invoice_id = ANY($2::int[])`, [companyId, ids]);
    await db.query(`DELETE FROM payment_allocations WHERE company_id = $1 AND invoice_id = ANY($2::int[])`, [companyId, ids]);
    await db.query(`DELETE FROM expenses WHERE company_id = $1 AND invoice_id = ANY($2::int[])`, [companyId, ids]);
    await db.query(`DELETE FROM ledger_entries WHERE company_id = $1 AND type LIKE 'invoice%' AND reference_id = ANY($2::int[])`, [companyId, ids]);
    // invoice_items and dispatches cascade.
    const res = await db.query(
      `DELETE FROM invoices WHERE company_id = $1 AND id = ANY($2::int[]) AND invoice_type = 'non_gst' AND status = 'saved'`,
      [companyId, ids],
    );
    return res.rowCount ?? 0;
  }
  await db.query(`DELETE FROM purchase_attachments WHERE company_id = $1 AND purchase_id = ANY($2::int[])`, [companyId, ids]);
  await db.query(`DELETE FROM ledger_entries WHERE company_id = $1 AND type = 'purchase' AND reference_id = ANY($2::int[])`, [companyId, ids]);
  // purchase_items cascade.
  const res = await db.query(
    `DELETE FROM purchases WHERE company_id = $1 AND id = ANY($2::int[]) AND bill_type = 'non_gst' AND status = 'saved'`,
    [companyId, ids],
  );
  return res.rowCount ?? 0;
}

export async function setLegalHold(companyId: number, category: CleanupCategory, ids: number[], hold: boolean, operator: Operator) {
  const t = TABLES[category];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE ${t.table} SET legal_hold = $3
        WHERE company_id = $1 AND id = ANY($2::int[]) AND ${t.typeCol} = 'non_gst'
        RETURNING id, ${t.noCol} AS record_no`,
      [companyId, ids, hold],
    );
    await client.query(
      `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        companyId,
        hold ? `non_gst_${category}_legal_hold_set` : `non_gst_${category}_legal_hold_released`,
        `${t.label}: legal hold ${hold ? "placed on" : "released from"} ${rows.map((r: any) => r.record_no).join(", ")}`,
        operator.userId,
        operator.name,
        JSON.stringify({ category, ids: rows.map((r: any) => r.id), hold }),
      ],
    );
    await client.query("COMMIT");
    return rows.length;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function formatJob(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    category: r.category,
    trigger: r.trigger,
    action: r.action,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    status: r.status,
    eligibleCount: r.eligible_count,
    processedCount: r.processed_count,
    excludedCount: r.excluded_count,
    totalValue: Number(r.total_value),
    operatorName: r.operator_name,
    error: r.error,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  };
}

export async function listJobs(companyId: number, category: CleanupCategory) {
  const { rows } = await pool.query(
    `SELECT * FROM non_gst_cleanup_jobs WHERE company_id = $1 AND category = $2 ORDER BY id DESC LIMIT 100`,
    [companyId, category],
  );
  return rows.map(formatJob);
}

export async function getJob(companyId: number, jobId: number) {
  const job = await pool.query(`SELECT * FROM non_gst_cleanup_jobs WHERE company_id = $1 AND id = $2`, [companyId, jobId]);
  if (job.rowCount === 0) return null;
  const items = await pool.query(
    `SELECT record_id, record_no, record_date, party_name, amount, outcome, reason
       FROM non_gst_cleanup_job_items WHERE company_id = $1 AND job_id = $2 ORDER BY outcome, record_date, record_id`,
    [companyId, jobId],
  );
  return {
    ...formatJob(job.rows[0]),
    items: items.rows.map((r: any) => ({
      recordId: r.record_id,
      recordNo: r.record_no,
      recordDate: r.record_date ? new Date(r.record_date).toISOString() : null,
      partyName: r.party_name,
      amount: Number(r.amount),
      outcome: r.outcome,
      reason: r.reason,
    })),
  };
}

// ── Schedules ──────────────────────────────────────────────────────────

// Scheduled runs fire at 02:00 server time: daily → tomorrow, weekly → next
// Monday, monthly → the 1st, yearly → 1 April (start of the financial year).
export function computeNextRun(frequency: ScheduleFrequency, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setHours(2, 0, 0, 0);
  switch (frequency) {
    case "daily":
      if (next <= from) next.setDate(next.getDate() + 1);
      break;
    case "weekly": {
      const daysToMonday = (8 - next.getDay()) % 7;
      next.setDate(next.getDate() + daysToMonday);
      if (next <= from) next.setDate(next.getDate() + 7);
      break;
    }
    case "monthly":
      next.setDate(1);
      if (next <= from) next.setMonth(next.getMonth() + 1);
      break;
    case "yearly":
      next.setMonth(3, 1);
      if (next <= from) next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

function formatSettings(category: CleanupCategory, r: any | undefined) {
  return {
    category,
    enabled: r?.enabled ?? false,
    frequency: (r?.frequency ?? "monthly") as ScheduleFrequency,
    minAgeDays: r?.min_age_days ?? 90,
    nextRunAt: r?.enabled && r?.next_run_at ? new Date(r.next_run_at).toISOString() : null,
    lastRunAt: r?.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastJob: r?.last_job_id ? formatJob(r.last_job) : null,
  };
}

export async function getSettings(companyId: number, category: CleanupCategory) {
  const { rows } = await pool.query(
    `SELECT s.*, row_to_json(j.*) AS last_job
       FROM non_gst_cleanup_settings s
       LEFT JOIN non_gst_cleanup_jobs j ON j.id = s.last_job_id AND j.company_id = s.company_id
      WHERE s.company_id = $1 AND s.category = $2`,
    [companyId, category],
  );
  return formatSettings(category, rows[0]);
}

export async function saveSettings(
  companyId: number,
  category: CleanupCategory,
  input: { enabled: boolean; frequency: ScheduleFrequency; minAgeDays: number },
  operator: Operator,
) {
  const nextRunAt = input.enabled ? computeNextRun(input.frequency) : null;
  await pool.query(
    `INSERT INTO non_gst_cleanup_settings (company_id, category, enabled, frequency, min_age_days, next_run_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (company_id, category) DO UPDATE
       SET enabled = EXCLUDED.enabled, frequency = EXCLUDED.frequency, min_age_days = EXCLUDED.min_age_days,
           next_run_at = EXCLUDED.next_run_at, updated_at = NOW()`,
    [companyId, category, input.enabled, input.frequency, input.minAgeDays, nextRunAt],
  );
  await pool.query(
    `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      companyId,
      `non_gst_${category}_schedule_updated`,
      `${TABLES[category].label} automatic cleanup ${input.enabled ? `enabled (${input.frequency}, bills older than ${input.minAgeDays} days)` : "disabled"}`,
      operator.userId,
      operator.name,
      JSON.stringify({ category, ...input }),
    ],
  );
  return getSettings(companyId, category);
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SCHEDULER_OPERATOR: Operator = { userId: 0, name: "Scheduled cleanup" };

// Runs every due schedule. Each run goes through the same runDelete as a
// manual delete, so tenant scoping, type check, legal hold and dependency
// rules are re-validated on locked rows at run time.
export async function runDueSchedules(now: Date = new Date()): Promise<number> {
  const due = await pool.query(
    `SELECT s.* FROM non_gst_cleanup_settings s
       JOIN companies c ON c.id = s.company_id
      WHERE s.enabled = true AND s.next_run_at IS NOT NULL AND s.next_run_at <= $1`,
    [now],
  );
  let ran = 0;
  for (const s of due.rows) {
    if (!isCategory(s.category)) continue;
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - Math.max(0, Number(s.min_age_days)));
    const scheduledFor = new Date(s.next_run_at).toISOString();
    try {
      const { job } = await runDelete({
        companyId: s.company_id,
        category: s.category,
        range: { from: null, to: isoDate(cutoff) },
        trigger: "scheduled",
        idempotencyKey: `scheduled:${s.category}:${scheduledFor}`,
        operator: SCHEDULER_OPERATOR,
      });
      await pool.query(
        `UPDATE non_gst_cleanup_settings SET last_run_at = $3, last_job_id = $4, next_run_at = $5
          WHERE company_id = $1 AND category = $2 AND enabled = true`,
        [s.company_id, s.category, now, job?.id ?? null, computeNextRun(s.frequency, now)],
      );
      ran++;
    } catch (err) {
      logger.error({ err, companyId: s.company_id, category: s.category }, "Scheduled Non-GST cleanup failed");
    }
  }
  return ran;
}
