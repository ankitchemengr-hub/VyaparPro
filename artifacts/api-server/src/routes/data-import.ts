import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { todayIst } from "../lib/books";
import { importParties, importItems, MAX_ROWS } from "../lib/data-import";
import { lookupGstin, gstLookupConfigured } from "../lib/gstin-lookup";

// Settings → Data Import (admin only). POST { rows, dryRun, … } — dryRun
// (the default) only reports what each row would do.
const router: IRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function run(req: any, res: any, what: "parties" | "items"): Promise<void> {
  const session = req.session;
  if (session?.role !== "admin") { res.status(403).json({ error: "Only admin can import data" }); return; }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length) { res.status(400).json({ error: "No rows to import" }); return; }
  if (rows.length > MAX_ROWS) { res.status(400).json({ error: `At most ${MAX_ROWS} rows at a time — split the file` }); return; }
  const dryRun = req.body?.dryRun !== false;
  const asOn = typeof req.body?.asOn === "string" && DATE_RE.test(req.body.asOn) ? req.body.asOn : todayIst();
  const rowsIn = rows.map((r: any, i: number) => ({ ...(r && typeof r === "object" ? r : {}), row: Number(r?.row) || i + 2 }));

  const companyId = getCompanyId(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('data_import'), $1)`, [companyId]);
    const userId = session?.userId ?? null;
    const out = what === "parties"
      ? await importParties(client, companyId, {
          rows: rowsIn, asOn, dryRun, userId, userName: session?.name ?? null,
          defaultType: req.body?.defaultType === "vendor" ? "vendor" : "customer",
          pricingTier: req.body?.pricingTier === "wholesale" ? "wholesale" : "retail",
          lookup: req.body?.fillFromGst === true ? (g: string) => lookupGstin(g, req.log) : undefined,
        })
      : await importItems(client, companyId, { rows: rowsIn, dryRun, userId });
    if (dryRun) {
      await client.query("ROLLBACK");
    } else {
      await client.query(
        `INSERT INTO audit_log (company_id, action, description, user_id, user_name, metadata) VALUES ($1, $2, $3, $4, $5, $6)`,
        [companyId, `${what}_imported`, `Data Import: ${out.created} ${what === "parties" ? "parties" : "items"} added from a file`,
         userId ?? 1, session?.name ?? "Unknown",
         JSON.stringify({ created: out.created, asOn, names: out.results.filter((r) => r.status === "new").map((r) => r.name).slice(0, 200) })],
      );
      await client.query("COMMIT");
    }
    res.json({ dryRun, asOn, gstLookup: gstLookupConfigured(), ...out });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, `POST /data-import/${what} failed`);
    res.status(500).json({ error: "Import failed — nothing was saved" });
  } finally {
    client.release();
  }
}

router.post("/data-import/parties", (req, res) => run(req, res, "parties"));
router.post("/data-import/items", (req, res) => run(req, res, "items"));

export default router;
