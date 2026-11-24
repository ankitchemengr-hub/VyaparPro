import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { getSession } from "../lib/tenant";
import { logger } from "../lib/logger";

// "Seen" marks for the Menu badges: the highest new-order / new-customer id
// each user has already looked at. A badge counts only what came after it,
// so opening Customer Orders (or Customers) clears it — on every device.
const router: IRouter = Router();
const KEYS = ["orders", "customers"] as const;

let ready: Promise<void> | null = null;
function ensureSeenSchema(): Promise<void> {
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS user_seen (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      last_id INTEGER NOT NULL DEFAULT 0,
      seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, key)
    )
  `).then(() => undefined).catch((err) => {
    ready = null;
    logger.error({ err }, "Could not ensure user_seen schema");
    throw err;
  });
  return ready;
}

// GET /seen → { orders: number | null, customers: number | null } (null = never opened)
router.get("/seen", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  await ensureSeenSchema();
  const { rows } = await pool.query(`SELECT key, last_id FROM user_seen WHERE user_id = $1`, [session.userId]);
  const out: Record<string, number | null> = { orders: null, customers: null };
  for (const r of rows) if ((KEYS as readonly string[]).includes(r.key)) out[r.key] = Number(r.last_id);
  res.json(out);
});

// PUT /seen/:key { lastId } — never moves backwards.
router.put("/seen/:key", async (req, res): Promise<void> => {
  const session = getSession(req);
  if (!session?.userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const key = String(req.params.key);
  const lastId = Number(req.body?.lastId);
  if (!(KEYS as readonly string[]).includes(key) || !Number.isInteger(lastId) || lastId < 0) {
    res.status(400).json({ error: "Invalid seen mark" });
    return;
  }
  await ensureSeenSchema();
  const { rows: [r] } = await pool.query(
    `INSERT INTO user_seen (user_id, key, last_id, seen_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, key) DO UPDATE SET last_id = GREATEST(user_seen.last_id, EXCLUDED.last_id), seen_at = NOW()
     RETURNING last_id`,
    [session.userId, key, lastId],
  );
  res.json({ key, lastId: Number(r.last_id) });
});

export default router;
