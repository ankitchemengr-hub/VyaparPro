// GSTIN lookup (lib/gstin-lookup.ts) against a faked provider: the asked
// GSTIN's details are returned, and a provider answer for some other GSTIN
// (its own sample record) is refused rather than filled into a form.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { lookupGstin } from "../src/lib/gstin-lookup";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.APPYFLOW_GST_API_KEY; });

function provider(gstin: string, addr: Record<string, string>) {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    taxpayerInfo: { gstin, lgnm: "RAM KUMAR", tradeNam: "Ram Traders", sts: "Active", pradr: { addr } },
  }), { status: 200 })) as typeof fetch;
}

test("without a key only the state is known", async () => {
  const d = await lookupGstin("27AAACR5055K1Z7");
  assert.deepEqual(d, { found: false, gstin: "27AAACR5055K1Z7", state: "Maharashtra", error: "GST lookup not configured" });
});

test("fills the asked GSTIN's name and address", async () => {
  process.env.APPYFLOW_GST_API_KEY = "k";
  provider("27AAACR5055K1Z7", { flno: "2nd Floor", bno: "12", bnm: "", st: "MG Road", loc: "Camp", city: "", dst: "Pune", stcd: "Maharashtra", pncd: "411001" });
  const d = await lookupGstin("27aaacr5055k1z7");
  assert.equal(d.found, true);
  assert.equal(d.legalName, "RAM KUMAR");
  assert.equal(d.address, "2nd Floor, 12, MG Road, Camp, Pune, Maharashtra, 411001");
  assert.equal(d.city, "Pune");
  assert.equal(d.pinCode, "411001");
  assert.equal(d.status, "Active");
});

test("an answer for a different GSTIN is refused", async () => {
  process.env.APPYFLOW_GST_API_KEY = "k";
  provider("03DOXPM4071K1ZE", { dst: "Ludhiana", stcd: "Punjab" });
  const d = await lookupGstin("27AAACR5055K1Z7");
  assert.equal(d.found, false);
  assert.equal(d.legalName, undefined);
  assert.match(d.error ?? "", /another GSTIN \(03DOXPM4071K1ZE\)/);
});
