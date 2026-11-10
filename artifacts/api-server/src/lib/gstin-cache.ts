// Shared store of GST registry answers. Every successful paid lookup (see
// gstin-lookup.ts) is kept here, so the next time any company enters the same
// GSTIN — the same distributors and suppliers turn up across many shops — it
// is filled from our own database for free. Only the registry's public fields
// (name, address, state, PIN, status) are stored, never anything a company
// typed about its own party.

import { pool } from "@workspace/db";
import type { GstinDetails } from "./gstin-lookup";

// Registry status (Active / Cancelled / Suspended) can change, so an answer
// is reused for this long and then fetched again from the provider.
const MAX_AGE_DAYS = 30;

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ready ??= pool
    .query(
      `CREATE TABLE IF NOT EXISTS gstin_registry_cache (
         gstin TEXT PRIMARY KEY,
         details JSONB NOT NULL,
         fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    )
    .then(() => undefined)
    .catch((err) => {
      ready = null;
      throw err;
    });
  return ready;
}

export async function getCachedGstin(gstin: string): Promise<GstinDetails | null> {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT details FROM gstin_registry_cache
      WHERE gstin = $1 AND fetched_at > now() - ($2 || ' days')::interval`,
    [gstin, String(MAX_AGE_DAYS)],
  );
  return rows[0] ? (rows[0].details as GstinDetails) : null;
}

export async function saveCachedGstin(d: GstinDetails): Promise<void> {
  if (!d.found || !d.gstin) return;
  await ensureTable();
  const { found, gstin, legalName, tradeName, address, city, state, pinCode, status } = d;
  await pool.query(
    `INSERT INTO gstin_registry_cache (gstin, details, fetched_at) VALUES ($1, $2, now())
     ON CONFLICT (gstin) DO UPDATE SET details = EXCLUDED.details, fetched_at = now()`,
    [gstin, JSON.stringify({ found, gstin, legalName, tradeName, address, city, state, pinCode, status })],
  );
}
