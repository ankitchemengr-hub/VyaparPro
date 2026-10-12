import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { pool } from "@workspace/db";
import { logger } from "./logger";

// Photo → structured bill. Claude reads the bill image/PDF and returns JSON
// in a fixed schema; we then match the party and every line item against the
// company's own entities/products so the review screen can pre-select them.
// Nothing is saved here — the user confirms in the UI and the normal
// purchase/invoice save path books stock + ledger exactly like a manual bill.

export type BillKind = "purchase" | "sale";

const MODEL = "claude-opus-5-5";

export const SCAN_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export type ScanMediaType = typeof SCAN_MEDIA_TYPES[number];

// Every field is required (missing → "" or 0) so the schema stays within the
// structured-outputs subset and the model can't skip keys.
const BILL_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["party", "billNo", "billDate", "isGstBill", "placeOfSupply", "items", "totals", "confidence", "warnings"],
  properties: {
    party: {
      type: "object",
      additionalProperties: false,
      required: ["name", "gstin", "mobile", "address", "state"],
      properties: {
        name: { type: "string" },
        gstin: { type: "string" },
        mobile: { type: "string" },
        address: { type: "string" },
        state: { type: "string" },
      },
    },
    billNo: { type: "string" },
    billDate: { type: "string", description: "YYYY-MM-DD, or empty if unreadable" },
    isGstBill: { type: "boolean" },
    placeOfSupply: { type: "string", description: "Indian state name" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "hsn", "qty", "unit", "rate", "discountPct", "taxPct", "amount"],
        properties: {
          name: { type: "string" },
          hsn: { type: "string" },
          qty: { type: "number" },
          unit: { type: "string" },
          rate: { type: "number", description: "Per-unit rate BEFORE GST" },
          discountPct: { type: "number" },
          taxPct: { type: "number", description: "Total GST % (CGST+SGST or IGST)" },
          amount: { type: "number", description: "Line taxable value (qty × rate − discount), before GST" },
        },
      },
    },
    totals: {
      type: "object",
      additionalProperties: false,
      required: ["taxable", "cgst", "sgst", "igst", "freight", "roundOff", "grandTotal"],
      properties: {
        taxable: { type: "number" },
        cgst: { type: "number" },
        sgst: { type: "number" },
        igst: { type: "number" },
        freight: { type: "number" },
        roundOff: { type: "number" },
        grandTotal: { type: "number" },
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    warnings: { type: "array", items: { type: "string" } },
  },
} as const;

const ExtractedBill = z.object({
  party: z.object({
    name: z.string(), gstin: z.string(), mobile: z.string(), address: z.string(), state: z.string(),
  }),
  billNo: z.string(),
  billDate: z.string(),
  isGstBill: z.boolean(),
  placeOfSupply: z.string(),
  items: z.array(z.object({
    name: z.string(), hsn: z.string(), qty: z.number(), unit: z.string(),
    rate: z.number(), discountPct: z.number(), taxPct: z.number(), amount: z.number(),
  })),
  totals: z.object({
    taxable: z.number(), cgst: z.number(), sgst: z.number(), igst: z.number(),
    freight: z.number(), roundOff: z.number(), grandTotal: z.number(),
  }),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string()),
});
export type ExtractedBill = z.infer<typeof ExtractedBill>;

// Raised for problems the user should see as-is (bad photo, no API key, ...).
export class BillScanError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "BillScanError";
    this.status = status;
  }
}

function systemPrompt(kind: BillKind, company: { name: string }): string {
  const party = kind === "purchase"
    ? "the SELLER / supplier who issued this bill to us"
    : "the BUYER / customer this bill was issued to";
  return [
    `You read Indian business bills (GST tax invoices, cash memos, kachcha/handwritten bills) for "${company.name}", an Indian business.`,
    `This is a ${kind === "purchase" ? "PURCHASE bill we received" : "SALE bill we issued"}. "party" is ${party} — never "${company.name}" itself.`,
    "Transcribe exactly what is printed or written; do not invent values. Use \"\" or 0 for anything unreadable or absent, and say so in warnings.",
    "Hindi/Marathi text: keep item and party names as written (Devanagari is fine).",
    "Rates: `rate` must be the per-unit price before GST. If the bill shows GST-inclusive rates, back out the tax. `amount` is the line's taxable value before GST.",
    "taxPct is the total GST rate for the line (e.g. 9% CGST + 9% SGST → 18). Use 0 when the bill has no GST.",
    "isGstBill is true only when the bill charges GST (CGST/SGST/IGST lines or GST % per item).",
    "Dates as YYYY-MM-DD (Indian bills are day-first: 05/03/2026 is 2026-03-05).",
    "Freight/transport/packing charges go in totals.freight, not as items.",
    "Set confidence to low when the photo is blurry, cropped, or not a bill at all; then add a warning explaining why.",
  ].join("\n");
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new BillScanError("Bill scanning is not set up on the server (ANTHROPIC_API_KEY missing).", 503);
  }
  client ??= new Anthropic();
  return client;
}

export async function extractBill(
  kind: BillKind,
  companyName: string,
  data: string,
  mediaType: ScanMediaType,
): Promise<ExtractedBill> {
  const fileBlock: Anthropic.Beta.BetaContentBlockParam = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data } };

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: systemPrompt(kind, { name: companyName }),
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: BILL_JSON_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{
        role: "user",
        content: [fileBlock, { type: "text", text: "Extract this bill." }],
      }],
    });
  } catch (err) {
    if (err instanceof BillScanError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new BillScanError("Bill scanning API key is invalid.", 503);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new BillScanError("Too many scans right now — try again in a minute.", 429);
    }
    if (err instanceof Anthropic.BadRequestError) {
      logger.warn({ err: err.message }, "Bill scan rejected by API");
      throw new BillScanError("Could not read this file. Try a clearer photo (JPG/PNG) or a PDF.", 422);
    }
    logger.error({ err }, "Bill scan API call failed");
    throw new BillScanError("Bill scanning service is unavailable. Please try again.", 502);
  }

  if (response.stop_reason === "refusal") {
    throw new BillScanError("This image could not be processed. Please photograph only the bill.", 422);
  }
  if (response.stop_reason === "max_tokens") {
    throw new BillScanError("The bill is too long to read in one go. Try scanning it page by page.", 422);
  }
  const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    throw new BillScanError("Could not read the bill. Try a clearer photo.", 422);
  }
  const result = ExtractedBill.safeParse(parsed);
  if (!result.success) {
    logger.warn({ issues: result.error.issues.slice(0, 5) }, "Bill scan returned unexpected shape");
    throw new BillScanError("Could not read the bill. Try a clearer photo.", 422);
  }
  return result.data;
}

// ─────────────────────────── matching ───────────────────────────

// One-time table: item names as they appear on a party's bills → our product.
// Filled when the user confirms a scan, so the same supplier's next bill maps
// itself. partyId 0 = "any party" (used when the bill's party wasn't matched).
pool.query(`
  CREATE TABLE IF NOT EXISTS bill_scan_aliases (
    id SERIAL PRIMARY KEY,
    company_id INTEGER NOT NULL,
    party_id INTEGER NOT NULL DEFAULT 0,
    raw_name TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS bill_scan_aliases_uq ON bill_scan_aliases(company_id, party_id, raw_name);
`).catch((err: any) => logger.warn({ err }, "Could not ensure bill_scan_aliases table"));

export function normalizeName(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

// Bills write units every which way: "1Ltr", "1 ltr", "1L", "1 litre".
const UNIT_SYNONYMS: Record<string, string> = {
  l: "l", lt: "l", ltr: "l", ltrs: "l", liter: "l", litre: "l", liters: "l", litres: "l",
  ml: "ml", kg: "kg", kgs: "kg", g: "g", gm: "g", gms: "g", pc: "pcs", pcs: "pcs", nos: "pcs",
};

function tokens(s: string): Set<string> {
  const spaced = normalizeName(s)
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2");
  return new Set(spaced.split(" ").filter((t) => t.length > 0).map((t) => UNIT_SYNONYMS[t] ?? t));
}

// Token overlap (Dice coefficient), plus partial credit for prefix matches so
// "castrol gtx 20w50 1ltr" still lines up with "Castrol GTX 20W-50 1L".
function similarity(a: string, b: string): number {
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const x of ta) {
    if (tb.has(x)) { hits += 1; continue; }
    for (const y of tb) {
      if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) { hits += 0.7; break; }
    }
  }
  return (2 * hits) / (ta.size + tb.size);
}

const MATCH_THRESHOLD = 0.75;

export interface PartyMatch {
  matched: { id: number; name: string; gstin: string | null; mobile: string | null; state: string | null } | null;
  matchedBy: "gstin" | "mobile" | "name" | null;
  suggestions: { id: number; name: string; score: number }[];
}

export async function matchParty(companyId: number, kind: BillKind, party: ExtractedBill["party"]): Promise<PartyMatch> {
  const type = kind === "purchase" ? "vendor" : "customer";
  const { rows } = await pool.query(
    `SELECT id, name, gstin, mobile, state FROM entities
     WHERE company_id = $1 AND type = $2 AND is_active = true`,
    [companyId, type],
  );
  const gstin = party.gstin.trim().toUpperCase();
  if (gstin.length === 15) {
    const hit = rows.find((r: any) => (r.gstin ?? "").trim().toUpperCase() === gstin);
    if (hit) return { matched: hit, matchedBy: "gstin", suggestions: [] };
  }
  const mobile = party.mobile.replace(/\D/g, "").slice(-10);
  if (mobile.length === 10) {
    const hit = rows.find((r: any) => (r.mobile ?? "").replace(/\D/g, "").slice(-10) === mobile);
    if (hit) return { matched: hit, matchedBy: "mobile", suggestions: [] };
  }
  const scored = party.name.trim()
    ? rows.map((r: any) => ({ id: r.id, name: r.name, score: similarity(party.name, r.name), row: r }))
        .filter((s) => s.score > 0.3)
        .sort((a, b) => b.score - a.score)
    : [];
  if (scored[0] && scored[0].score >= 0.85) {
    return { matched: scored[0].row, matchedBy: "name", suggestions: [] };
  }
  return {
    matched: null,
    matchedBy: null,
    suggestions: scored.slice(0, 3).map(({ id, name, score }) => ({ id, name, score: Math.round(score * 100) / 100 })),
  };
}

export interface ItemMatch {
  productId: number | null;
  matchedBy: "learned" | "name" | "code" | null;
  score: number;
  suggestions: { id: number; name: string; score: number }[];
}

export async function matchItems(
  companyId: number,
  partyId: number | null,
  items: ExtractedBill["items"],
): Promise<ItemMatch[]> {
  const [{ rows: products }, { rows: aliases }] = await Promise.all([
    pool.query(
      `SELECT id, name, item_code, hsn_code FROM products
       WHERE company_id = $1 AND deleted_at IS NULL`,
      [companyId],
    ),
    pool.query(
      `SELECT party_id, raw_name, product_id FROM bill_scan_aliases
       WHERE company_id = $1 AND party_id = ANY($2)`,
      [companyId, [0, partyId ?? 0]],
    ),
  ]);
  const productIds = new Set(products.map((p: any) => p.id));
  // Party-specific mapping wins over the "any party" one.
  const aliasMap = new Map<string, number>();
  for (const a of aliases.sort((x: any, y: any) => x.party_id - y.party_id)) {
    if (productIds.has(a.product_id)) aliasMap.set(a.raw_name, a.product_id);
  }

  return items.map((item) => {
    const key = normalizeName(item.name);
    const learned = aliasMap.get(key);
    if (learned != null) return { productId: learned, matchedBy: "learned", score: 1, suggestions: [] };

    const raw = ` ${key} `;
    const byCode = products.find((p: any) => {
      const code = normalizeName(p.item_code ?? "");
      return code.length >= 3 && raw.includes(` ${code} `);
    });
    if (byCode) return { productId: byCode.id, matchedBy: "code", score: 1, suggestions: [] };

    const hsn = item.hsn.replace(/\D/g, "");
    const scored = products
      .map((p: any) => {
        let score = similarity(item.name, p.name);
        if (hsn.length >= 4 && (p.hsn_code ?? "").replace(/\D/g, "").startsWith(hsn.slice(0, 4))) score += 0.1;
        return { id: p.id as number, name: p.name as string, score: Math.min(1, score) };
      })
      .filter((s) => s.score > 0.35)
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    // Only auto-pick when the winner is clearly ahead of the runner-up.
    if (best && best.score >= MATCH_THRESHOLD && (!scored[1] || best.score - scored[1].score >= 0.1)) {
      return { productId: best.id, matchedBy: "name", score: Math.round(best.score * 100) / 100, suggestions: [] };
    }
    return {
      productId: null,
      matchedBy: null,
      score: 0,
      suggestions: scored.slice(0, 4).map((s) => ({ ...s, score: Math.round(s.score * 100) / 100 })),
    };
  });
}

export async function saveAliases(
  companyId: number,
  partyId: number | null,
  entries: { rawName: string; productId: number }[],
): Promise<number> {
  let saved = 0;
  for (const e of entries) {
    const key = normalizeName(e.rawName);
    if (!key) continue;
    // Never point an alias at another company's product.
    const res = await pool.query(
      `INSERT INTO bill_scan_aliases (company_id, party_id, raw_name, product_id)
       SELECT $1, $2, $3, p.id FROM products p WHERE p.id = $4 AND p.company_id = $1
       ON CONFLICT (company_id, party_id, raw_name)
       DO UPDATE SET product_id = EXCLUDED.product_id, updated_at = NOW()`,
      [companyId, partyId ?? 0, key, e.productId],
    );
    saved += res.rowCount ?? 0;
  }
  return saved;
}
