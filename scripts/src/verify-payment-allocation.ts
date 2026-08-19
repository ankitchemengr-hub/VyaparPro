// Standalone verification script for FIFO invoice payment allocation.
// Run with: pnpm --filter @workspace/scripts run verify-payment-allocation
//
// Exercises the real allocatePaymentAcrossInvoices/applyEntityPayment
// functions (imported directly, not reimplemented) against a throwaway
// customer + set of invoices created under a dedicated test company id, all
// inside one transaction that's rolled back at the end — so nothing is left
// behind in the database regardless of pass/fail.
//
// Mirrors the user's own worked example: 4 invoices totalling ₹1,00,000
// (₹20k/₹25k/₹30k/₹25k), then a sequence of payments run against them in
// order, asserting the invoice-wise state after each — which naturally
// covers scenarios 1, 2, 3, 5, 6 and 8 as one continuous narrative, plus a
// 5th invoice added specifically for scenario 4 (overpay a pinned invoice),
// and a final reprint check for scenario 7.

import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";
import { Client } from "pg";
import { applyEntityPayment, allocatePaymentAcrossInvoices } from "../../artifacts/api-server/src/lib/entity-payment.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const TEST_COMPANY_ID = 999999; // distinctive id, unlikely to collide with a real company
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
    // ---- Setup: one customer, five invoices ----
    const [{ id: customerId }] = (
      await client.query(
        `INSERT INTO entities (company_id, type, name, mobile, pricing_tier)
         VALUES ($1, 'customer', 'TEST FIFO Customer', '9999999999', 'retail') RETURNING id`,
        [TEST_COMPANY_ID],
      )
    ).rows;

    async function makeInvoice(no: string, amount: number, daysAgo: number): Promise<number> {
      const res = await client.query(
        `INSERT INTO invoices
           (company_id, invoice_no, invoice_type, invoice_date, customer_id, customer_name,
            subtotal, grand_total, amount_paid, balance_due, status)
         VALUES ($1,$2,'gst', NOW() - ($3 || ' days')::interval, $4, 'TEST FIFO Customer',
                 $5, $5, 0, $5, 'saved')
         RETURNING id`,
        [TEST_COMPANY_ID, no, String(daysAgo), customerId, amount],
      );
      return res.rows[0].id;
    }

    const invA = await makeInvoice("TEST-INV-A", 20000, 5);
    const invB = await makeInvoice("TEST-INV-B", 25000, 4);
    const invC = await makeInvoice("TEST-INV-C", 30000, 3);
    const invD = await makeInvoice("TEST-INV-D", 25000, 2);
    const invE = await makeInvoice("TEST-INV-E", 10000, 1); // used only for scenario 4 (overpay spillover)

    const getInvoice = async (id: number) =>
      (await client.query(`SELECT amount_paid, balance_due FROM invoices WHERE id = $1`, [id])).rows[0];

    // ---- Scenario 1: exact invoice payment ----
    console.log("\nScenario 1 — exact invoice payment (₹20,000 against ₹20,000 invoice)");
    const r1 = await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID, entityId: customerId, amount: 20000, mode: "cash",
      receiptNo: "TEST-001", referenceId: 1, isCustomerReceipt: true, startInvoiceId: null,
    });
    assertEqual("1 allocation made", r1.allocations.length, 1);
    assertEqual("allocated to invoice A", r1.allocations[0]?.invoiceId, invA);
    assertEqual("A fully paid", r1.allocations[0]?.status, "paid");
    const a1 = await getInvoice(invA);
    assertEqual("A.balance_due = 0", Number(a1.balance_due), 0);
    assertEqual("A.amount_paid = 20000", Number(a1.amount_paid), 20000);

    // ---- Scenario 2: partial invoice payment ----
    console.log("\nScenario 2 — partial invoice payment (₹5,000 against ₹25,000 invoice)");
    const r2 = await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID, entityId: customerId, amount: 5000, mode: "cash",
      receiptNo: "TEST-002", referenceId: 2, isCustomerReceipt: true, startInvoiceId: null,
    });
    assertEqual("allocated to invoice B", r2.allocations[0]?.invoiceId, invB);
    assertEqual("B partially paid", r2.allocations[0]?.status, "partially_paid");
    let b = await getInvoice(invB);
    assertEqual("B.balance_due = 20000", Number(b.balance_due), 20000);
    assertEqual("B.amount_paid = 5000", Number(b.amount_paid), 5000);

    // ---- Scenario 5: multiple partial payments over time on the same invoice ----
    console.log("\nScenario 5 — second partial payment on the same invoice (another ₹5,000 on B)");
    await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID, entityId: customerId, amount: 5000, mode: "cash",
      receiptNo: "TEST-003", referenceId: 3, isCustomerReceipt: true, startInvoiceId: null,
    });
    b = await getInvoice(invB);
    assertEqual("B.balance_due = 15000 (cumulative)", Number(b.balance_due), 15000);
    assertEqual("B.amount_paid = 10000 (cumulative)", Number(b.amount_paid), 10000);

    // ---- Scenario 3: payment covering multiple invoices ----
    console.log("\nScenario 3 — one payment spans multiple invoices (₹45,000 finishes B, fully pays C)");
    const r4 = await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID, entityId: customerId, amount: 45000, mode: "cash",
      receiptNo: "TEST-004", referenceId: 4, isCustomerReceipt: true, startInvoiceId: null,
    });
    assertEqual("2 invoices touched", r4.allocations.length, 2);
    assertEqual("first allocation is B (₹15,000, finishing it)", r4.allocations[0]?.invoiceId, invB);
    assertEqual("B allocation amount", r4.allocations[0]?.allocatedAmount, 15000);
    assertEqual("second allocation is C (₹30,000, fully)", r4.allocations[1]?.invoiceId, invC);
    assertEqual("C allocation amount", r4.allocations[1]?.allocatedAmount, 30000);
    b = await getInvoice(invB);
    const c = await getInvoice(invC);
    const d0 = await getInvoice(invD);
    assertEqual("B fully paid now", Number(b.balance_due), 0);
    assertEqual("C fully paid", Number(c.balance_due), 0);
    assertEqual("D untouched so far", Number(d0.amount_paid), 0);

    // ---- Scenario 4: payment greater than one pinned invoice — spills over ----
    console.log("\nScenario 4 — pin invoice D and overpay it (₹30,000 against a ₹25,000 balance, spills ₹5,000 to E)");
    const r5 = await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID, entityId: customerId, amount: 30000, mode: "cash",
      receiptNo: "TEST-005", referenceId: 5, isCustomerReceipt: true, startInvoiceId: invD,
    });
    assertEqual("2 invoices touched", r5.allocations.length, 2);
    assertEqual("D paid first (pinned)", r5.allocations[0]?.invoiceId, invD);
    assertEqual("D allocation = 25000", r5.allocations[0]?.allocatedAmount, 25000);
    assertEqual("remainder spilled to E", r5.allocations[1]?.invoiceId, invE);
    assertEqual("E allocation = 5000", r5.allocations[1]?.allocatedAmount, 5000);
    const d1 = await getInvoice(invD);
    let e = await getInvoice(invE);
    assertEqual("D fully paid", Number(d1.balance_due), 0);
    assertEqual("E partially paid (5000 of 10000)", Number(e.balance_due), 5000);

    // ---- Scenario 6: fully-paid status flip ----
    console.log("\nScenario 6 — finishing payment flips E to fully paid");
    await applyEntityPayment(client, {
      companyId: TEST_COMPANY_ID, entityId: customerId, amount: 5000, mode: "cash",
      receiptNo: "TEST-006", referenceId: 6, isCustomerReceipt: true, startInvoiceId: null,
    });
    e = await getInvoice(invE);
    const eGrandTotal = 10000;
    // Same derivation invoices.tsx's getPayStatus uses: balanceDue<=0 && grandTotal>0 => "paid".
    const eStatus = Number(e.balance_due) <= 0 && eGrandTotal > 0 ? "paid" : "not_paid";
    assertEqual("E now derives to \"paid\"", eStatus, "paid");

    // ---- Scenario 7: receipt reprint stays historically accurate ----
    console.log("\nScenario 7 — reprinting TEST-002 shows the same breakdown as when it happened, unaffected by later payments");
    const reprint = await client.query(
      `SELECT invoice_id, allocated_amount, previous_paid_at_allocation, balance_after_allocation
       FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2`,
      [TEST_COMPANY_ID, "TEST-002"],
    );
    assertEqual("TEST-002 still has exactly 1 allocation row", reprint.rows.length, 1);
    assertEqual("still points at invoice B", reprint.rows[0]?.invoice_id, invB);
    assertEqual("still shows ₹5,000 allocated", Number(reprint.rows[0]?.allocated_amount), 5000);
    assertEqual("still shows ₹0 previously paid (B's real state at that moment)", Number(reprint.rows[0]?.previous_paid_at_allocation), 0);
    assertEqual("still shows ₹20,000 remaining (not B's current ₹0)", Number(reprint.rows[0]?.balance_after_allocation), 20000);

    // ---- Scenario 8: customer ledger reconciliation ----
    console.log("\nScenario 8 — ledger and allocation totals reconcile");
    const ledgerSum = await client.query(
      `SELECT COALESCE(SUM(credit), 0) AS total FROM ledger_entries
       WHERE company_id = $1 AND entity_id = $2 AND type = 'payment'`,
      [TEST_COMPANY_ID, customerId],
    );
    const totalPaid = 20000 + 5000 + 5000 + 45000 + 30000 + 5000; // 110000
    assertEqual("sum of ledger credits equals sum of all payments", Number(ledgerSum.rows[0].total), totalPaid);

    const allocSum004 = await client.query(
      `SELECT COALESCE(SUM(allocated_amount), 0) AS total FROM payment_allocations
       WHERE company_id = $1 AND receipt_no = $2`,
      [TEST_COMPANY_ID, "TEST-004"],
    );
    assertEqual("TEST-004's allocations sum to its own payment amount (45000)", Number(allocSum004.rows[0].total), 45000);

    // Test invoices were inserted directly via SQL (not through the normal
    // invoice-creation flow, which would also raise outstanding_balance),
    // so it starts at 0 here — each payment only ever subtracts from it.
    const entityBal = await client.query(`SELECT outstanding_balance FROM entities WHERE id = $1`, [customerId]);
    assertEqual("customer outstanding_balance decreased by exactly the sum of all payments", Number(entityBal.rows[0].outstanding_balance), -totalPaid);

    // ---- Bonus (not one of the 8, but exercises real code written this
    // session): editing an amount reverses the old allocation(s) and
    // re-runs FIFO fresh with the corrected amount. ----
    console.log("\nBonus — correcting a multi-invoice payment's amount reverses + re-derives its allocations");
    // Reverse TEST-004's old allocations exactly like the PATCH route does,
    // then re-run with a smaller corrected amount (30000 instead of 45000).
    const oldAllocs = await client.query(
      `SELECT invoice_id, allocated_amount FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2`,
      [TEST_COMPANY_ID, "TEST-004"],
    );
    for (const row of oldAllocs.rows) {
      await client.query(
        `UPDATE invoices SET amount_paid = GREATEST(0, amount_paid - $1), balance_due = LEAST(grand_total, balance_due + $1)
         WHERE id = $2`,
        [Number(row.allocated_amount), row.invoice_id],
      );
    }
    await client.query(`DELETE FROM payment_allocations WHERE company_id = $1 AND receipt_no = $2`, [TEST_COMPANY_ID, "TEST-004"]);
    const corrected = await allocatePaymentAcrossInvoices(client, {
      companyId: TEST_COMPANY_ID, customerId, amount: 30000, startInvoiceId: null, receiptNo: "TEST-004",
    });
    assertEqual("corrected TEST-004 covers only B (₹15,000) and part of C (₹15,000)", corrected.length, 2);
    assertEqual("corrected allocation to C is partial now", corrected[1]?.allocatedAmount, 15000);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Verification script crashed:", err);
  process.exitCode = 1;
});
