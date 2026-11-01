import { Router, type IRouter } from "express";
import { LookupGstinQueryParams } from "@workspace/api-zod";
import { lookupGstin } from "../lib/gstin-lookup";

const router: IRouter = Router();

// GET /gstin-lookup?gstin=...
// Optional enrichment: if APPYFLOW_GST_API_KEY is set we proxy Appyflow to fetch
// the registered business details; otherwise we degrade gracefully, returning at
// least the state derived from the GSTIN prefix so the caller can still autofill
// (see lib/gstin-lookup.ts).
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
  res.json(await lookupGstin(parsed.data.gstin, req.log));
});

export default router;
