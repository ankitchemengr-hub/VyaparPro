// GSTIN → registered business details (name, address, state, PIN), from
// Cashfree (CASHFREE_CLIENT_ID + CASHFREE_CLIENT_SECRET) when set, else
// Appyflow (APPYFLOW_GST_API_KEY). With neither, only the state (from the
// GSTIN's first two digits) is known. Each lookup uses one provider credit,
// so callers look up only on a user's request.
import { publicEncrypt, constants } from "node:crypto";

export const STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "28": "Andhra Pradesh",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh",
};

// Lightweight structural validation: 15 chars, 2-digit state + PAN + entity/check chars.
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export interface GstinDetails {
  found: boolean;
  gstin?: string;
  legalName?: string;
  tradeName?: string;
  address?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  status?: string;
  error?: string;
}

const cashfreeConfigured = () => !!(process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET);
export const gstLookupConfigured = () => cashfreeConfigured() || !!process.env.APPYFLOW_GST_API_KEY;

type Log = { warn: (o: object, msg: string) => void };

async function getJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return { ok: resp.ok, status: resp.status, data: await resp.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

const joinAddress = (parts: unknown[]) => {
  const out = parts.map((p) => String(p ?? "").trim()).filter((p, i, all) => p.length > 0 && all.indexOf(p) === i);
  return out.length ? out.join(", ") : undefined;
};

// Cashfree Secure ID: POST /verification/gstin. Production calls must come
// from a whitelisted IP or carry x-cf-signature — Railway has no fixed IP, so
// set CASHFREE_PUBLIC_KEY (the PEM key from Cashfree's dashboard) to sign.
// CASHFREE_ENV=sandbox uses the test server.
async function cashfreeLookup(gstin: string, stateFromCode: string | undefined, log?: Log): Promise<GstinDetails> {
  const clientId = process.env.CASHFREE_CLIENT_ID!;
  const base = process.env.CASHFREE_ENV === "sandbox" ? "https://sandbox.cashfree.com" : "https://api.cashfree.com";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-client-id": clientId,
    "x-client-secret": process.env.CASHFREE_CLIENT_SECRET!,
  };
  // Pasted into Railway on one line, the PEM's line breaks arrive as "\n".
  const pem = process.env.CASHFREE_PUBLIC_KEY?.replace(/\\n/g, "\n").trim();
  if (pem) {
    // clientId.unixTimestamp, RSA-OAEP (SHA-1) with Cashfree's public key.
    headers["x-cf-signature"] = publicEncrypt(
      { key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
      Buffer.from(`${clientId}.${Math.floor(Date.now() / 1000)}`),
    ).toString("base64");
  }
  try {
    const { ok, status, data } = await getJson(`${base}/verification/gstin`, { method: "POST", headers, body: JSON.stringify({ GSTIN: gstin }) });
    if (!ok) {
      log?.warn({ status, message: data?.message, code: data?.code ?? data?.error_code }, "Cashfree GSTIN lookup returned non-OK");
      const why = status === 401 || status === 403 ? `Cashfree refused the request (${data?.message ?? status}) — check the client id / secret and IP whitelist or public key` : (data?.message ?? "Lookup provider error");
      return { found: false, gstin, state: stateFromCode, error: why };
    }
    if (!data?.valid) return { found: false, gstin, state: stateFromCode, error: data?.message ?? "GSTIN not found" };
    const answered = String(data.GSTIN ?? "").trim().toUpperCase();
    if (answered && answered !== gstin) {
      log?.warn({ asked: gstin, answered }, "GSTIN lookup provider answered for a different GSTIN");
      return { found: false, gstin, state: stateFromCode, error: `The GST lookup service sent details of another GSTIN (${answered}).` };
    }
    const a = data.principal_place_split_address ?? {};
    return {
      found: true,
      gstin,
      legalName: data.legal_name_of_business || undefined,
      tradeName: data.trade_name_of_business || undefined,
      address: data.principal_place_address?.trim() || joinAddress([a.flat_number, a.building_number, a.building_name, a.street, a.location, a.city, a.district, a.state, a.pincode]),
      city: (a.city || a.district || a.location) ? String(a.city || a.district || a.location) : undefined,
      state: a.state || stateFromCode,
      pinCode: a.pincode ? String(a.pincode) : undefined,
      status: data.gst_in_status || undefined,
    };
  } catch (err) {
    log?.warn({ err }, "Cashfree GSTIN lookup failed");
    return { found: false, gstin, state: stateFromCode, error: "Lookup failed" };
  }
}

export async function lookupGstin(raw: string, log?: Log): Promise<GstinDetails> {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) return { found: false, error: "Invalid GSTIN format" };
  const stateFromCode = STATE_CODES[gstin.slice(0, 2)];
  if (cashfreeConfigured()) return cashfreeLookup(gstin, stateFromCode, log);
  const apiKey = process.env.APPYFLOW_GST_API_KEY;
  // No provider configured — return what we can derive locally.
  if (!apiKey) return { found: false, gstin, state: stateFromCode, error: "GST lookup not configured" };

  try {
    const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) {
      log?.warn({ status: resp.status }, "GSTIN lookup provider returned non-OK");
      return { found: false, gstin, state: stateFromCode, error: "Lookup provider error" };
    }
    const data: any = await resp.json();
    if (data?.error || !data?.taxpayerInfo) return { found: false, gstin, state: stateFromCode, error: data?.message ?? "GSTIN not found" };

    const info = data.taxpayerInfo;
    // Never fill a form with another business's details: the provider has
    // answered with its own sample record (AppyFlow Technologies) instead of
    // the GSTIN asked for, e.g. on a trial key.
    const answered = String(info.gstin ?? "").trim().toUpperCase();
    if (answered && answered !== gstin) {
      log?.warn({ asked: gstin, answered }, "GSTIN lookup provider answered for a different GSTIN");
      return { found: false, gstin, state: stateFromCode, error: `The GST lookup service sent details of another GSTIN (${answered}). Check the API key / plan on appyflow.in.` };
    }
    const pradr = info.pradr?.addr ?? {};
    const addressParts = [pradr.flno, pradr.bno, pradr.bnm, pradr.st, pradr.loc, pradr.city, pradr.dst, pradr.stcd, pradr.pncd]
      .map((p: any) => String(p ?? "").trim())
      .filter((p: string, i: number, all: string[]) => p.length > 0 && all.indexOf(p) === i);
    return {
      found: true,
      gstin,
      legalName: info.lgnm ?? undefined,
      tradeName: info.tradeNam ?? undefined,
      address: addressParts.length > 0 ? addressParts.join(", ") : undefined,
      city: (pradr.city || pradr.dst || pradr.loc) ? String(pradr.city || pradr.dst || pradr.loc) : undefined,
      state: pradr.stcd ?? stateFromCode,
      pinCode: pradr.pncd ? String(pradr.pncd) : undefined,
      status: info.sts ?? undefined,
    };
  } catch (err) {
    log?.warn({ err }, "GSTIN lookup failed");
    return { found: false, gstin, state: stateFromCode, error: "Lookup failed" };
  }
}
