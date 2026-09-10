// Verifies which side of a party's ledger a payment lands on, per
// applyEntityPayment (imported directly, not reimplemented):
//   vendor payout    -> DEBIT  (mirrors a purchase, which is a CREDIT)
//   customer receipt -> CREDIT (mirrors an invoice, which is a DEBIT)
//
// Run: pnpm --filter @workspace/scripts run verify-vendor-payment-ledger-side
//
// Everything happens inside one transaction that is rolled back at the end,
// under a throwaway company id, so nothing is left in the database.

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import { applyEntityPayment } from "../../artifacts/api-server/src/lib/entity-payment.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const TEST_COMPANY_ID = 999998;
let passed = 0;
let failed = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const a = typeof actual === "number" ? Math.round(actual * 100) / 100 : actual;
  const e = typeof expected === "number" ? Math.round(expected * 100) / 100 : expected;
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
  }
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");

  try {
    const [{ id: vendorId }] = (
      await client.query(
        `INSERT INTO entities (company_id, type, name, mobile) VALUES ($1, 'vendor', 'TEST Vendor', '9000000001') RETURNING id`,
        [TEST_COMPANY_ID],
      )
    ).rows;
    const [{ id: customerId }] = (
      await client.query(
        `INSERT INTO entities (company_id, type, name, mobile, pricing_tier) VALUES ($1, 'customer', 'TEST Cust', '9000000002', 'retail') RETURNING id`,
        [TEST_COMPANY_ID],
      )
    ).rows;

    // Vendor: a purchase (CREDIT) leaves us owing 10,000; then pay 4,000.
    await client.query(
      `UPDATE entities SET outstanding_balance = 10000 WHERE id = $1`,
      [vendorId],
    );
    await client.query(
      `INSERT INTO ledger_entries (company_id, entity_id, description, debit, credit, balance, type)
       VALUES ($1, $2, 'Purchase TEST', 0, 10000, 10000, 'purchase')`,
      [TEST_COMPANY_ID, vendorId],
    );

    await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID,
      entityId: vendorId,
      amount: 4000,
      mode: "cash",
      receiptNo: "TEST/V/1",
      referenceId: 1,
      isVendorPayout: true,
      description: "Payment made (cash)",
    });

    const vPay = (
      await client.query(
        `SELECT debit, credit, balance FROM ledger_entries WHERE company_id = $1 AND entity_id = $2 AND type = 'payment'`,
        [TEST_COMPANY_ID, vendorId],
      )
    ).rows[0];
    console.log("Vendor payout ledger row:");
    assertEqual("debit = 4000 (pays down the payable)", Number(vPay.debit), 4000);
    assertEqual("credit = 0", Number(vPay.credit), 0);
    assertEqual("balance snapshot = 6000", Number(vPay.balance), 6000);

    // Customer: an invoice (DEBIT) leaves them owing 5,000; then receive 2,000.
    await client.query(
      `UPDATE entities SET outstanding_balance = 5000 WHERE id = $1`,
      [customerId],
    );
    await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID,
      entityId: customerId,
      amount: 2000,
      mode: "cash",
      receiptNo: "TEST/C/1",
      referenceId: 2,
      isCustomerReceipt: true,
      description: "Payment received (cash)",
    });

    const cPay = (
      await client.query(
        `SELECT debit, credit, balance FROM ledger_entries WHERE company_id = $1 AND entity_id = $2 AND type = 'payment'`,
        [TEST_COMPANY_ID, customerId],
      )
    ).rows[0];
    console.log("Customer receipt ledger row (regression check):");
    assertEqual("debit = 0", Number(cPay.debit), 0);
    assertEqual("credit = 2000 (pays down the receivable)", Number(cPay.credit), 2000);
    assertEqual("balance snapshot = 3000", Number(cPay.balance), 3000);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
