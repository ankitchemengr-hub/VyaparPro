import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import {
  BillScanError,
  SCAN_MEDIA_TYPES,
  extractBill,
  matchItems,
  matchParty,
  saveAliases,
  type BillKind,
} from "../lib/bill-scan";

const router: IRouter = Router();

// Same roles that can create the document by hand: purchases → admin /
// accountant / store, sales (Billing page) → admin / store.
const ROLES_FOR: Record<BillKind, Set<string>> = {
  purchase: new Set(["admin", "accountant", "store", "super_admin"]),
  sale: new Set(["admin", "store", "super_admin"]),
};

// ~7 MB of file — the client downsizes photos to well under this; the global
// JSON body limit (10 MB) caps the base64 at the transport level anyway.
const MAX_BASE64_CHARS = 9_500_000;

const ScanBody = z.object({
  kind: z.enum(["purchase", "sale"]),
  mediaType: z.enum(SCAN_MEDIA_TYPES),
  data: z.string().min(100).max(MAX_BASE64_CHARS),
});

const AliasBody = z.object({
  kind: z.enum(["purchase", "sale"]),
  partyId: z.number().int().positive().nullable(),
  entries: z.array(z.object({
    rawName: z.string().min(1).max(300),
    productId: z.number().int().positive(),
  })).max(200),
});

// POST /bill-scan — read a bill photo/PDF and return the extracted bill plus
// suggested party/product matches. Saves nothing; the user reviews and then
// saves through the normal purchase/invoice flow.
router.post("/bill-scan", async (req, res): Promise<void> => {
  const parsed = ScanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send a JPG, PNG, WEBP or PDF bill (max ~7 MB)." });
    return;
  }
  const { kind, mediaType, data } = parsed.data;
  const role = (req as any).session?.role;
  if (!ROLES_FOR[kind].has(role)) {
    res.status(403).json({ error: "Not permitted" });
    return;
  }
  const companyId = getCompanyId(req);

  try {
    const { rows } = await pool.query(`SELECT name FROM companies WHERE id = $1`, [companyId]);
    const bill = await extractBill(kind, rows[0]?.name ?? "our company", data, mediaType);
    const party = await matchParty(companyId, kind, bill.party);
    const items = await matchItems(companyId, party.matched?.id ?? null, bill.items);
    res.json({ bill, party, items });
  } catch (err) {
    if (err instanceof BillScanError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    logger.error({ err }, "Bill scan failed");
    res.status(500).json({ error: "Bill scan failed" });
  }
});

// POST /bill-scan/aliases — remember "this name on this party's bill = this
// product", so the next scan from the same party maps itself.
router.post("/bill-scan/aliases", async (req, res): Promise<void> => {
  const parsed = AliasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const role = (req as any).session?.role;
  if (!ROLES_FOR[parsed.data.kind].has(role)) {
    res.status(403).json({ error: "Not permitted" });
    return;
  }
  const companyId = getCompanyId(req);
  if (parsed.data.partyId != null) {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM entities WHERE id = $1 AND company_id = $2`,
      [parsed.data.partyId, companyId],
    );
    if (!rowCount) {
      res.status(404).json({ error: "Party not found" });
      return;
    }
  }
  const saved = await saveAliases(companyId, parsed.data.partyId, parsed.data.entries);
  res.json({ saved });
});

export default router;
