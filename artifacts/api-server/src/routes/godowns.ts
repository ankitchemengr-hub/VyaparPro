import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import { todayIst } from "../lib/books";

// Godowns (Books & Audit). Billing and purchases keep moving the product's
// total stock (products.current_stock); the godowns added here hold part of
// it, moved there by a transfer. The main godown is simply the rest:
// total stock − what sits in the other godowns. A transfer never changes the
// total, so nothing else in the app has to know about godowns.
const router: IRouter = Router();

const READ_ROLES = new Set(["admin", "accountant", "super_admin"]);
const WRITE_ROLES = new Set(["admin", "super_admin"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class GodownError extends Error {}

function allowed(req: any, res: any, roles: Set<string>): boolean {
  if (!roles.has(req.session?.role)) {
    res.status(403).json({ error: roles === WRITE_ROLES ? "Only admin can do this" : "Forbidden" });
    return false;
  }
  return true;
}

const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Names are unique regardless of case ("Back Godown" = "back godown").
async function nameTaken(companyId: number, name: string, exceptId = 0): Promise<boolean> {
  const r = await pool.query(`SELECT 1 FROM godowns WHERE company_id = $1 AND lower(name) = lower($2) AND id <> $3`, [companyId, name, exceptId]);
  return r.rows.length > 0;
}

// GET /godowns — the godowns with their item count and total qty.
router.get("/godowns", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.address, g.is_active,
              COUNT(s.product_id) FILTER (WHERE s.qty <> 0)::int AS items, COALESCE(SUM(s.qty), 0)::float AS qty
         FROM godowns g LEFT JOIN godown_stock s ON s.godown_id = g.id AND s.company_id = g.company_id
        WHERE g.company_id = $1 GROUP BY g.id ORDER BY g.is_active DESC, g.name`,
      [companyId],
    );
    res.json(rows.map((g: any) => ({ id: g.id, name: g.name, address: g.address ?? null, isActive: g.is_active, items: g.items, qty: g.qty })));
  } catch (err) {
    logger.error({ err }, "GET /godowns failed");
    res.status(500).json({ error: "Could not load godowns" });
  }
});

// POST /godowns { name, address } · PUT /godowns/:id { name, address, isActive }
router.post("/godowns", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const name = text(req.body?.name, 60);
  if (!name) { res.status(400).json({ error: "Enter the godown name" }); return; }
  if (/^main( godown)?$/i.test(name)) { res.status(400).json({ error: "\"Main\" is the shop / store itself — pick another name" }); return; }
  try {
    if (await nameTaken(companyId, name)) { res.status(409).json({ error: "A godown with this name already exists" }); return; }
    const r = await pool.query(
      `INSERT INTO godowns (company_id, name, address) VALUES ($1, $2, $3) RETURNING id`,
      [companyId, name, text(req.body?.address, 200) || null],
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "A godown with this name already exists" }); return; }
    logger.error({ err }, "POST /godowns failed");
    res.status(500).json({ error: "Could not save" });
  }
});

router.put("/godowns/:id", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  const name = text(req.body?.name, 60);
  if (!name) { res.status(400).json({ error: "Enter the godown name" }); return; }
  try {
    if (await nameTaken(companyId, name, id)) { res.status(409).json({ error: "A godown with this name already exists" }); return; }
    if (req.body?.isActive === false) {
      const held = await pool.query(`SELECT 1 FROM godown_stock WHERE company_id = $1 AND godown_id = $2 AND qty <> 0 LIMIT 1`, [companyId, id]);
      if (held.rows.length) { res.status(400).json({ error: "Move this godown's stock out before closing it" }); return; }
    }
    const r = await pool.query(
      `UPDATE godowns SET name = $3, address = $4, is_active = $5 WHERE company_id = $1 AND id = $2 RETURNING id`,
      [companyId, id, name, text(req.body?.address, 200) || null, req.body?.isActive !== false],
    );
    if (!r.rows.length) { res.status(404).json({ error: "Godown not found" }); return; }
    res.json({ ok: true });
  } catch (err: any) {
    if (err?.code === "23505") { res.status(409).json({ error: "A godown with this name already exists" }); return; }
    logger.error({ err }, "PUT /godowns failed");
    res.status(500).json({ error: "Could not save" });
  }
});

// GET /godowns/stock — every product's total, main and per-godown qty.
router.get("/godowns/stock", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  try {
    const [products, held] = await Promise.all([
      pool.query(
        `SELECT id, name, unit, current_stock::float AS stock FROM products WHERE company_id = $1 AND item_type <> 'service' ORDER BY name`,
        [companyId],
      ),
      pool.query(`SELECT godown_id, product_id, qty::float AS qty FROM godown_stock WHERE company_id = $1 AND qty <> 0`, [companyId]),
    ]);
    const byProduct = new Map<number, Record<number, number>>();
    for (const h of held.rows) byProduct.set(h.product_id, { ...(byProduct.get(h.product_id) ?? {}), [h.godown_id]: h.qty });
    res.json(products.rows.map((p: any) => {
      const g = byProduct.get(p.id) ?? {};
      const away = Object.values(g).reduce((a, n) => a + n, 0);
      return { productId: p.id, name: p.name, unit: p.unit, total: p.stock, main: r3(p.stock - away), godowns: g };
    }));
  } catch (err) {
    logger.error({ err }, "GET /godowns/stock failed");
    res.status(500).json({ error: "Could not load stock" });
  }
});

// GET /godowns/transfers?from=&to=
router.get("/godowns/transfers", async (req, res): Promise<void> => {
  if (!allowed(req, res, READ_ROLES)) return;
  const companyId = getCompanyId(req);
  const from = DATE_RE.test(String(req.query.from ?? "")) ? String(req.query.from) : "2000-01-01";
  const to = DATE_RE.test(String(req.query.to ?? "")) ? String(req.query.to) : "2100-01-01";
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.transfer_date::text AS date, t.from_godown_id, t.to_godown_id, f.name AS from_name, d.name AS to_name,
              t.product_name, t.qty::float AS qty, t.note, t.created_by_name
         FROM godown_transfers t
         LEFT JOIN godowns f ON f.id = t.from_godown_id
         LEFT JOIN godowns d ON d.id = t.to_godown_id
        WHERE t.company_id = $1 AND t.transfer_date BETWEEN $2 AND $3
        ORDER BY t.transfer_date DESC, t.id DESC LIMIT 1000`,
      [companyId, from, to],
    );
    res.json(rows.map((t: any) => ({
      id: t.id, date: t.date, from: t.from_name ?? "Main", to: t.to_name ?? "Main",
      productName: t.product_name, qty: t.qty, note: t.note ?? null, createdByName: t.created_by_name ?? null,
    })));
  } catch (err) {
    logger.error({ err }, "GET /godowns/transfers failed");
    res.status(500).json({ error: "Could not load transfers" });
  }
});

// POST /godowns/transfer { fromGodownId (0 = main), toGodownId (0 = main), date, note, items: [{ productId, qty }] }
router.post("/godowns/transfer", async (req, res): Promise<void> => {
  if (!allowed(req, res, WRITE_ROLES)) return;
  const companyId = getCompanyId(req);
  const fromId = Number(req.body?.fromGodownId) || 0;
  const toId = Number(req.body?.toGodownId) || 0;
  const date = DATE_RE.test(String(req.body?.date ?? "")) ? req.body.date : todayIst();
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 300) : [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (fromId === toId) throw new GodownError("Pick two different godowns");
    if (!items.length) throw new GodownError("Add at least one item");
    for (const gid of [fromId, toId].filter(Boolean)) {
      const g = (await client.query(`SELECT id, is_active FROM godowns WHERE company_id = $1 AND id = $2`, [companyId, gid])).rows[0];
      if (!g || !g.is_active) throw new GodownError("Godown not found or closed");
    }
    const user = (req as any).session?.name ?? (req as any).session?.username ?? null;
    for (const it of items) {
      const qty = r3(Number(it?.qty));
      if (!(qty > 0)) throw new GodownError("Every item needs a quantity above 0");
      const p = (await client.query(
        `SELECT id, name, current_stock::float AS stock FROM products WHERE company_id = $1 AND id = $2 FOR UPDATE`,
        [companyId, Number(it?.productId)],
      )).rows[0];
      if (!p) throw new GodownError("Item not found");
      let available: number;
      if (fromId) {
        available = Number((await client.query(
          `SELECT qty::float AS qty FROM godown_stock WHERE godown_id = $1 AND product_id = $2 FOR UPDATE`, [fromId, p.id],
        )).rows[0]?.qty ?? 0);
      } else {
        const away = Number((await client.query(
          `SELECT COALESCE(SUM(qty), 0)::float AS qty FROM godown_stock WHERE company_id = $1 AND product_id = $2`, [companyId, p.id],
        )).rows[0].qty);
        available = r3(p.stock - away);
      }
      if (qty > available + 0.0005) throw new GodownError(`${p.name}: only ${available} in stock there`);
      if (fromId) {
        await client.query(`UPDATE godown_stock SET qty = qty - $3 WHERE godown_id = $1 AND product_id = $2`, [fromId, p.id, qty]);
      }
      if (toId) {
        await client.query(
          `INSERT INTO godown_stock (company_id, godown_id, product_id, qty) VALUES ($1, $2, $3, $4)
           ON CONFLICT (godown_id, product_id) DO UPDATE SET qty = godown_stock.qty + EXCLUDED.qty`,
          [companyId, toId, p.id, qty],
        );
      }
      await client.query(
        `INSERT INTO godown_transfers (company_id, transfer_date, from_godown_id, to_godown_id, product_id, product_name, qty, note, created_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [companyId, date, fromId || null, toId || null, p.id, p.name, qty, text(req.body?.note, 200) || null, user],
      );
    }
    await client.query("COMMIT");
    res.json({ ok: true, items: items.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err instanceof GodownError) { res.status(400).json({ error: err.message }); return; }
    logger.error({ err }, "POST /godowns/transfer failed");
    res.status(500).json({ error: "Could not save — nothing was changed" });
  } finally {
    client.release();
  }
});

export default router;
