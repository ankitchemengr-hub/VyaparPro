// One-off data fix: historical vendor-payout ledger rows were written with the
// amount on the CREDIT side (same as a purchase) instead of the DEBIT side.
// The running `balance` snapshot on each row was always correct — only the
// debit/credit display columns are wrong — so this just moves credit -> debit
// on the affected rows. Idempotent: only touches `type = 'payment'` rows for
// `vendor` entities that still have `credit > 0 AND debit = 0`.
//
// Dry run:  pnpm --filter @workspace/scripts run backfill-vendor-payment-ledger-side
// Apply:    pnpm --filter @workspace/scripts run backfill-vendor-payment-ledger-side -- --apply

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const APPLY = process.argv.includes("--apply");

const SELECT = `
  SELECT le.id, le.company_id, le.entity_id, e.name AS vendor, le.description,
         le.credit, le.balance, le.date
  FROM ledger_entries le
  JOIN entities e ON e.id = le.entity_id AND e.company_id = le.company_id
  WHERE le.type = 'payment'
    AND e.type = 'vendor'
    AND le.credit > 0
    AND le.debit = 0
  ORDER BY le.company_id, le.entity_id, le.date
`;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const rows = (await client.query(SELECT)).rows;
  if (rows.length === 0) {
    console.log("Nothing to fix — no misfiled vendor-payment ledger rows.");
    await client.end();
    return;
  }

  console.log(`${rows.length} vendor-payment ledger row(s) to move credit -> debit:\n`);
  for (const r of rows) {
    console.log(
      `  #${r.id}  ${new Date(r.date).toISOString().slice(0, 10)}  ${r.vendor}  ` +
        `"${r.description}"  ₹${Number(r.credit).toFixed(2)}  (balance ₹${Number(r.balance).toFixed(2)} — unchanged)`,
    );
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with  -- --apply  to write these changes.");
    await client.end();
    return;
  }

  await client.query("BEGIN");
  try {
    const res = await client.query(`
      UPDATE ledger_entries le
      SET debit = le.credit, credit = 0
      FROM entities e
      WHERE e.id = le.entity_id AND e.company_id = le.company_id
        AND le.type = 'payment' AND e.type = 'vendor'
        AND le.credit > 0 AND le.debit = 0
    `);
    await client.query("COMMIT");
    console.log(`\nApplied — ${res.rowCount} row(s) updated.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
