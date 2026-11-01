// GSTIN lookup (lib/gstin-lookup.ts) against a faked provider: the asked
// GSTIN's details are returned, and a provider answer for some other GSTIN
// (its own sample record) is refused rather than filled into a form.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { lookupGstin } from "../src/lib/gstin-lookup";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ["APPYFLOW_GST_API_KEY", "CASHFREE_CLIENT_ID", "CASHFREE_CLIENT_SECRET", "CASHFREE_PUBLIC_KEY", "CASHFREE_ENV"]) delete process.env[k];
});

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

test("Cashfree is used when its keys are set, with the split address and status", async () => {
  process.env.APPYFLOW_GST_API_KEY = "k";
  process.env.CASHFREE_CLIENT_ID = "cid";
  process.env.CASHFREE_CLIENT_SECRET = "sec";
  const { generateKeyPairSync, privateDecrypt, constants } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // One line with literal "\n", as it gets pasted into Railway.
  process.env.CASHFREE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString().replace(/\n/g, "\\n");
  let seen: { url: string; headers: Record<string, string>; body: any } | null = null;
  globalThis.fetch = (async (url: string, init: any) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({
      GSTIN: "27BFTPC0657J1Z5", legal_name_of_business: "C SOME NAME", trade_name_of_business: "SOME TRADERS", gst_in_status: "Active",
      principal_place_address: "", valid: true, message: "GSTIN Exists",
      principal_place_split_address: { flat_number: "1", building_name: "Om Plaza", street: "Station Rd", location: "", district: "Solapur", city: "Solapur", state: "Maharashtra", pincode: "413001" },
    }), { status: 200 });
  }) as typeof fetch;
  const d = await lookupGstin("27BFTPC0657J1Z5");
  assert.equal(seen!.url, "https://api.cashfree.com/verification/gstin");
  assert.deepEqual(seen!.body, { GSTIN: "27BFTPC0657J1Z5" });
  assert.equal(seen!.headers["x-client-id"], "cid");
  const signed = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, Buffer.from(seen!.headers["x-cf-signature"], "base64")).toString();
  assert.match(signed, /^cid\.\d{10}$/);
  assert.deepEqual(
    { found: d.found, legalName: d.legalName, tradeName: d.tradeName, address: d.address, city: d.city, state: d.state, pinCode: d.pinCode, status: d.status },
    { found: true, legalName: "C SOME NAME", tradeName: "SOME TRADERS", address: "1, Om Plaza, Station Rd, Solapur, Maharashtra, 413001", city: "Solapur", state: "Maharashtra", pinCode: "413001", status: "Active" },
  );
});

test("Cashfree: unknown GSTIN and refused key give clear errors", async () => {
  process.env.CASHFREE_CLIENT_ID = "cid";
  process.env.CASHFREE_CLIENT_SECRET = "sec";
  globalThis.fetch = (async () => new Response(JSON.stringify({ GSTIN: "27BFTPC0657J1Z5", message: "GSTIN Doesn't Exist" }), { status: 200 })) as typeof fetch;
  assert.equal((await lookupGstin("27BFTPC0657J1Z5")).error, "GSTIN Doesn't Exist");
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "IP not whitelisted" }), { status: 403 })) as typeof fetch;
  assert.match((await lookupGstin("27BFTPC0657J1Z5")).error ?? "", /Cashfree refused the request \(IP not whitelisted\)/);
});
