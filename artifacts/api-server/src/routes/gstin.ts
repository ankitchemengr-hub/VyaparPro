import { Router, type IRouter } from "express";
import { LookupGstinQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// Indian state code (first 2 digits of GSTIN) -> state name, used as a fallback
// when an external provider isn't configured.
const STATE_CODES: Record<string, string> = {
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
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// GET /gstin-lookup?gstin=...
// Optional enrichment: if APPYFLOW_GST_API_KEY is set we proxy Appyflow to fetch
// the registered business details; otherwise we degrade gracefully, returning at
// least the state derived from the GSTIN prefix so the caller can still autofill.
router.get("/gstin-lookup", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const parsed = LookupGstinQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const gstin = parsed.data.gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) {
    res.json({ found: false, error: "Invalid GSTIN format" });
    return;
  }

  const stateFromCode = STATE_CODES[gstin.slice(0, 2)];
  const apiKey = process.env.APPYFLOW_GST_API_KEY;

  if (!apiKey) {
    // No provider configured — return what we can derive locally.
    res.json({ found: false, gstin, state: stateFromCode, error: "GST lookup not configured" });
    return;
  }

  try {
    const url = `https://appyflow.in/api/verifyGST?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      req.log.warn({ status: resp.status }, "GSTIN lookup provider returned non-OK");
      res.json({ found: false, gstin, state: stateFromCode, error: "Lookup provider error" });
      return;
    }

    const data: any = await resp.json();
    if (data?.error || !data?.taxpayerInfo) {
      res.json({ found: false, gstin, state: stateFromCode, error: data?.message ?? "GSTIN not found" });
      return;
    }

    const info = data.taxpayerInfo;
    req.log.info({ lgnm: info.lgnm, tradeNam: info.tradeNam, allKeys: Object.keys(info) }, "GSTIN raw taxpayerInfo fields");
    const pradr = info.pradr?.addr ?? {};
    const addressParts = [
      pradr.bno, pradr.bnm, pradr.st, pradr.loc, pradr.dst, pradr.stcd, pradr.pncd,
    ].filter((p: any) => p && String(p).trim().length > 0);

    res.json({
      found: true,
      gstin,
      legalName: info.lgnm ?? undefined,
      tradeName: info.tradeNam ?? undefined,
      address: addressParts.length > 0 ? addressParts.join(", ") : undefined,
      state: pradr.stcd ?? stateFromCode,
      pinCode: pradr.pncd ? String(pradr.pncd) : undefined,
    });
  } catch (err) {
    req.log.warn({ err }, "GSTIN lookup failed");
    res.json({ found: false, gstin, state: stateFromCode, error: "Lookup failed" });
  }
});

export default router;
