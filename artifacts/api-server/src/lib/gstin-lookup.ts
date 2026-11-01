// GSTIN → registered business details (name, address, state, PIN). Needs
// APPYFLOW_GST_API_KEY; without it only the state (from the GSTIN's first
// two digits) is known. Each lookup uses one provider credit, so callers
// look up only on a user's request.

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

export const gstLookupConfigured = () => !!process.env.APPYFLOW_GST_API_KEY;

export async function lookupGstin(raw: string, log?: { warn: (o: object, msg: string) => void }): Promise<GstinDetails> {
  const gstin = raw.trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) return { found: false, error: "Invalid GSTIN format" };
  const stateFromCode = STATE_CODES[gstin.slice(0, 2)];
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
    const pradr = info.pradr?.addr ?? {};
    const addressParts = [pradr.bno, pradr.bnm, pradr.st, pradr.loc, pradr.dst, pradr.stcd, pradr.pncd]
      .filter((p: any) => p && String(p).trim().length > 0);
    return {
      found: true,
      gstin,
      legalName: info.lgnm ?? undefined,
      tradeName: info.tradeNam ?? undefined,
      address: addressParts.length > 0 ? addressParts.join(", ") : undefined,
      city: (pradr.dst || pradr.loc) ? String(pradr.dst || pradr.loc) : undefined,
      state: pradr.stcd ?? stateFromCode,
      pinCode: pradr.pncd ? String(pradr.pncd) : undefined,
      status: info.sts ?? undefined,
    };
  } catch (err) {
    log?.warn({ err }, "GSTIN lookup failed");
    return { found: false, gstin, state: stateFromCode, error: "Lookup failed" };
  }
}
