import { Router, type IRouter } from "express";
import { LookupGstinQueryParams } from "@workspace/api-zod";
import { lookupGstin, GSTIN_RE } from "../lib/gstin-lookup";
import { getCachedGstin, saveCachedGstin } from "../lib/gstin-cache";

const router: IRouter = Router();

// GET /gstin-lookup?gstin=...[&refresh=1]
// Answers from our own registry cache (lib/gstin-cache.ts) when it has a recent
// record, else asks the paid provider (lib/gstin-lookup.ts) and keeps the
// answer. refresh=1 (a user pressing Fetch) skips the cache. Without a provider
// only the state derived from the GSTIN prefix comes back.
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
  const refresh = req.query["refresh"] === "1";
  if (!refresh && GSTIN_RE.test(gstin)) {
    const cached = await getCachedGstin(gstin).catch((err) => {
      req.log.warn({ err }, "GSTIN cache read failed");
      return null;
    });
    if (cached) {
      res.json(cached);
      return;
    }
  }
  const details = await lookupGstin(gstin, req.log);
  if (details.found) {
    await saveCachedGstin(details).catch((err) => req.log.warn({ err }, "GSTIN cache write failed"));
  }
  res.json(details);
});

export default router;
