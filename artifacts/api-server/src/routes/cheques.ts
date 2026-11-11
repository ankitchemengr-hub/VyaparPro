import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { todayIst } from "../lib/books";
import { addTxn, bookPartyMoney, reversePartyMoney, dropTxn, ReconError, type ReconUser } from "../lib/bank-recon";

// Cheque / PDC register (Books & Audit). A cheque is noted when received or
// issued (post-dated ones wait for their date); clearing books it in the Cash
// Book on the clearing day, against the chosen bank account — a customer's
// cheque clears their bills, a supplier's cheque their dues (the same booking
// as Bank Reconciliation). A bounce after clearing takes the booking back.
const router: IRouter = Router();

const READ_ROLES = new Set(["admin", "accountant", "super_admin"]);
const WRITE_ROLES = new Set(["admin", "super_admin"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function formatCheque(r: any, today: string) {
  const date = r.cheque_day as string;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return {
    id: r.id,
    direction: r.direction,
    entityId: r.entity_id ?? null,
    partyName: r.party_name,
    chequeNo: r.cheque_no,
    bankName: r.bank_name ?? null,
    chequeDate: date,
    daysToDate: days,
    amount: Number(r.amount),
    invoiceId: r.invoice_id ?? null,
    invoiceNo: r.invoice_no ?? null,
    status: r.status,
    accountId: r.account_id ?? null,
    accountName: r.account_name ?? null,
    receiptNo: r.receipt_no ?? null,
    clearedOn: r.cleared_day ?? null,
    bouncedOn: r.bounced_day ?? null,
    bounceReason: r.bounce_reason ?? null,
    notes: r.notes ?? null,
    createdByName: r.created_by_name ?? null,
  };
}

// GET /cheques?status=pending|cleared|bounced|cancelled|all&direction=received|issued
router.get("/cheques", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  const status = String(req.query.status ?? "all");
  const direction = String(req.query.direction ?? "");
  const where = ["c.company_id = $1"];
  const params: any[] = [companyId];
  if (["pending", "cleared", "bounced", "cancelled"].includes(status)) { params.push(status); where.push(`c.status = $${params.length}`); }
  if (direction === "received" || direction === "issued") { params.push(direction); where.push(`c.direction = $${params.length}`); }
  try {
    const { rows } = await pool.query(
      `SELECT c.*, c.cheque_date::text AS cheque_day, c.cleared_on::text AS cleared_day, c.bounced_on::text AS bounced_day,
              a.name AS account_name, i.invoice_no
         FROM cheques c
         LEFT JOIN accounts a ON a.id = c.account_id AND a.company_id = c.company_id
         LEFT JOIN invoices i ON i.id = c.invoice_id AND i.company_id = c.company_id
        WHERE ${where.join(" AND ")}
        ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.cheque_date, c.id
        LIMIT 2000`,
      params,
    );
    const today = todayIst();
    const list = rows.map((r: any) => formatCheque(r, today));
    const pending = list.filter((c: any) => c.status === "pending");
    const sum = (xs: any[]) => Math.round(xs.reduce((a, c) => a + c.amount, 0) * 100) / 100;
    res.json({
      cheques: list,
      summary: {
        dueNow: pending.filter((c: any) => c.daysToDate <= 0).length,
        receivedPending: sum(pending.filter((c: any) => c.direction === "received")),
        issuedPending: sum(pending.filter((c: any) => c.direction === "issued")),
        bounced: list.filter((c: any) => c.status === "bounced").length,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /cheques failed");
    res.status(500).json({ error: "Could not load cheques" });
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

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// POST /cheques { direction, entityId?, partyName?, chequeNo, bankName?, chequeDate, amount, invoiceId?, notes? }
router.post("/cheques", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const b = req.body ?? {};
  await inTxn(res, "add cheque", async (client) => {
    const direction = b.direction === "issued" ? "issued" : "received";
    const amount = Math.round(Number(b.amount) * 100) / 100;
    if (!(amount > 0)) throw new ReconError("Enter the cheque amount");
    const chequeNo = text(b.chequeNo, 30);
    if (!chequeNo) throw new ReconError("Enter the cheque number");
    if (!DATE_RE.test(String(b.chequeDate ?? ""))) throw new ReconError("Enter the cheque date");
    let entityId: number | null = null;
    let partyName = text(b.partyName, 120);
    if (b.entityId) {
      const e = (await client.query(
        `SELECT id, name, type FROM entities WHERE company_id = $1 AND id = $2 AND type IN ('customer', 'vendor')`,
        [companyId, Number(b.entityId)],
      )).rows[0];
      if (!e) throw new ReconError("Pick a customer or supplier");
      entityId = e.id;
      partyName = e.name;
    }
    if (!partyName) throw new ReconError("Enter who the cheque is from / to");
    let invoiceId: number | null = null;
    if (b.invoiceId) {
      if (direction !== "received" || !entityId) throw new ReconError("A bill can only be picked for a customer's cheque");
      const inv = (await client.query(
        `SELECT id FROM invoices WHERE id = $1 AND company_id = $2 AND customer_id = $3 AND status <> 'cancelled' AND deleted_at IS NULL`,
        [Number(b.invoiceId), companyId, entityId],
      )).rows[0];
      if (!inv) throw new ReconError("That bill is not this customer's");
      invoiceId = inv.id;
    }
    const r = (await client.query(
      `INSERT INTO cheques (company_id, direction, entity_id, party_name, cheque_no, bank_name, cheque_date, amount, invoice_id, notes, created_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [companyId, direction, entityId, partyName, chequeNo, text(b.bankName, 80) || null, b.chequeDate, amount, invoiceId,
       text(b.notes, 300) || null, userOf(req).name],
    )).rows[0];
    return { id: r.id };
  });
});

async function lockCheque(client: any, companyId: number, id: number) {
  const c = (await client.query(
    `SELECT c.*, c.cheque_date::text AS cheque_day FROM cheques c WHERE c.company_id = $1 AND c.id = $2 FOR UPDATE`,
    [companyId, id],
  )).rows[0];
  if (!c) throw new ReconError("Cheque not found");
  return c;
}

// The booking a cleared cheque made, taken back (bounce or undo).
async function unbook(client: any, companyId: number, c: any, what: string) {
  const credit = c.direction === "received";
  if (c.entity_id) {
    await reversePartyMoney(client, companyId, { entityId: c.entity_id, credit, txnId: c.account_txn_id, receiptNo: c.receipt_no, amount: Number(c.amount), what });
  } else {
    await dropTxn(client, companyId, c.account_txn_id);
  }
}

// POST /cheques/:id/clear { accountId, date }
router.post("/cheques/:id/clear", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const user = userOf(req);
  await inTxn(res, "clear cheque", async (client) => {
    const c = await lockCheque(client, companyId, Number(req.params.id));
    if (c.status !== "pending") throw new ReconError("Only a pending cheque can be cleared");
    const date = DATE_RE.test(String(req.body?.date ?? "")) ? req.body.date : todayIst();
    const acct = (await client.query(
      `SELECT id, name, type FROM accounts WHERE company_id = $1 AND id = $2 AND is_active = true FOR UPDATE`,
      [companyId, Number(req.body?.accountId)],
    )).rows[0];
    if (!acct) throw new ReconError("Pick the bank account the cheque went through");
    const credit = c.direction === "received";
    const notes = `Cheque ${c.cheque_no}${c.bank_name ? ` (${c.bank_name})` : ""} dated ${c.cheque_day}`;
    let txnId: number;
    let receiptNo: string;
    if (c.entity_id) {
      const r = await bookPartyMoney(client, {
        companyId, accountId: acct.id, accountType: acct.type, entityId: c.entity_id, credit, amount: Number(c.amount), date, user,
        invoiceId: c.invoice_id, notes, via: "cheque", mode: "cheque",
      });
      txnId = r.txnId; receiptNo = r.receiptNo;
    } else {
      const t = await addTxn(client, {
        companyId, accountId: acct.id, direction: credit ? "in" : "out", amount: Number(c.amount), mode: "cheque", date, user,
        partyName: c.party_name, notes,
      });
      txnId = t.id; receiptNo = t.receiptNo;
    }
    await client.query(
      `UPDATE cheques SET status = 'cleared', account_id = $3, account_txn_id = $4, receipt_no = $5, cleared_on = $6, bounced_on = NULL, bounce_reason = NULL
        WHERE company_id = $1 AND id = $2`,
      [companyId, c.id, acct.id, txnId, receiptNo, date],
    );
    return { receiptNo };
  });
});

// POST /cheques/:id/bounce { date, reason } — pending or cleared.
router.post("/cheques/:id/bounce", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  await inTxn(res, "bounce cheque", async (client) => {
    const c = await lockCheque(client, companyId, Number(req.params.id));
    if (c.status !== "pending" && c.status !== "cleared") throw new ReconError("Only a pending or cleared cheque can bounce");
    if (c.status === "cleared") await unbook(client, companyId, c, `Cheque ${c.cheque_no} bounced`);
    const date = DATE_RE.test(String(req.body?.date ?? "")) ? req.body.date : todayIst();
    await client.query(
      `UPDATE cheques SET status = 'bounced', bounced_on = $3, bounce_reason = $4, account_txn_id = NULL, receipt_no = NULL, cleared_on = NULL
        WHERE company_id = $1 AND id = $2`,
      [companyId, c.id, date, text(req.body?.reason, 200) || null],
    );
  });
});

// POST /cheques/:id/cancel — a pending cheque that won't be presented.
router.post("/cheques/:id/cancel", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  await inTxn(res, "cancel cheque", async (client) => {
    const c = await lockCheque(client, companyId, Number(req.params.id));
    if (c.status !== "pending") throw new ReconError("Only a pending cheque can be cancelled");
    await client.query(`UPDATE cheques SET status = 'cancelled' WHERE company_id = $1 AND id = $2`, [companyId, c.id]);
  });
});

// POST /cheques/:id/undo — back to pending (a cleared one's booking is taken back).
router.post("/cheques/:id/undo", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  await inTxn(res, "undo cheque", async (client) => {
    const c = await lockCheque(client, companyId, Number(req.params.id));
    if (c.status === "pending") throw new ReconError("This cheque is already pending");
    if (c.status === "cleared") await unbook(client, companyId, c, `Cheque ${c.cheque_no} clearing undone`);
    await client.query(
      `UPDATE cheques SET status = 'pending', account_txn_id = NULL, receipt_no = NULL, cleared_on = NULL, bounced_on = NULL, bounce_reason = NULL
        WHERE company_id = $1 AND id = $2`,
      [companyId, c.id],
    );
  });
});

// DELETE /cheques/:id — a pending or cancelled one, entered by mistake.
router.delete("/cheques/:id", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const r = await pool.query(
    `DELETE FROM cheques WHERE company_id = $1 AND id = $2 AND status IN ('pending', 'cancelled') RETURNING id`,
    [companyId, Number(req.params.id)],
  );
  if (!r.rows.length) { res.status(400).json({ error: "Only a pending or cancelled cheque can be deleted" }); return; }
  res.json({ ok: true });
});

export default router;
