import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { logger } from "../lib/logger";
import {
  isCategory,
  validateRange,
  previewCleanup,
  runDelete,
  setLegalHold,
  listJobs,
  getJob,
  getSettings,
  saveSettings,
  SCHEDULE_FREQUENCIES,
  STATUTORY_RETENTION_YEARS,
  type CleanupCategory,
  type Operator,
  type ScheduleFrequency,
} from "../lib/non-gst-cleanup";

// Settings → Data Management → Non-GST Data Cleanup. Company admins only —
// the role is re-read from the users row so a stale or disabled admin session
// can't reach it. companyId always comes from the session, never the request.
const router: IRouter = Router();

async function requireCompanyAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [current] = await db.select().from(usersTable).where(eq(usersTable.id, session.userId));
  if (!current || !current.isActive || current.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  if (!isCategory(req.params.category)) {
    res.status(404).json({ error: "Unknown category" });
    return;
  }
  next();
}

function operatorOf(req: Request): Operator {
  const session = (req as any).session;
  return { userId: session.userId, name: session.name ?? "Admin" };
}

function categoryOf(req: Request): CleanupCategory {
  return req.params.category as CleanupCategory;
}

function idList(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const ids = v.map(Number);
  return ids.every((n) => Number.isInteger(n) && n > 0) ? ids : null;
}

const BASE = "/non-gst-cleanup/:category";

router.get(`${BASE}/settings`, requireCompanyAdmin, async (req, res): Promise<void> => {
  const settings = await getSettings(getCompanyId(req), categoryOf(req));
  res.json({ ...settings, retentionYears: STATUTORY_RETENTION_YEARS });
});

router.put(`${BASE}/settings`, requireCompanyAdmin, async (req, res): Promise<void> => {
  const { enabled, frequency, minAgeDays } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be true or false" });
    return;
  }
  if (!SCHEDULE_FREQUENCIES.includes(frequency)) {
    res.status(400).json({ error: "frequency must be daily, weekly, monthly or yearly" });
    return;
  }
  const age = Number(minAgeDays);
  if (!Number.isInteger(age) || age < 0 || age > 36500) {
    res.status(400).json({ error: "minAgeDays must be a whole number of days" });
    return;
  }
  const settings = await saveSettings(
    getCompanyId(req),
    categoryOf(req),
    { enabled, frequency: frequency as ScheduleFrequency, minAgeDays: age },
    operatorOf(req),
  );
  res.json({ ...settings, retentionYears: STATUTORY_RETENTION_YEARS });
});

router.get(`${BASE}/preview`, requireCompanyAdmin, async (req, res): Promise<void> => {
  const range = validateRange({ from: req.query.from, to: req.query.to });
  if (typeof range === "string") {
    res.status(400).json({ error: range });
    return;
  }
  res.json(await previewCleanup(getCompanyId(req), categoryOf(req), range));
});

// POST body: { from, to, idempotencyKey, confirm: "DELETE" }
router.post(`${BASE}/delete`, requireCompanyAdmin, async (req, res): Promise<void> => {
  const { from, to, idempotencyKey, confirm } = req.body ?? {};
  if (confirm !== "DELETE") {
    res.status(400).json({ error: "Confirmation missing — type DELETE to confirm" });
    return;
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
    res.status(400).json({ error: "idempotencyKey is required" });
    return;
  }
  const range = validateRange({ from, to });
  if (typeof range === "string") {
    res.status(400).json({ error: range });
    return;
  }
  try {
    const result = await runDelete({
      companyId: getCompanyId(req),
      category: categoryOf(req),
      range,
      trigger: "manual",
      idempotencyKey: `manual:${idempotencyKey}`,
      operator: operatorOf(req),
    });
    res.status(result.job?.status === "failed" ? 500 : 200).json(result);
  } catch (err) {
    logger.error({ err }, "Non-GST delete request failed");
    res.status(500).json({ error: "Delete failed — nothing was changed" });
  }
});

// POST body: { ids: number[], hold: boolean }
router.post(`${BASE}/legal-hold`, requireCompanyAdmin, async (req, res): Promise<void> => {
  const ids = idList(req.body?.ids);
  if (!ids || ids.length === 0 || typeof req.body?.hold !== "boolean") {
    res.status(400).json({ error: "ids and hold are required" });
    return;
  }
  const updated = await setLegalHold(getCompanyId(req), categoryOf(req), ids, req.body.hold, operatorOf(req));
  res.json({ updated });
});

router.get(`${BASE}/jobs`, requireCompanyAdmin, async (req, res): Promise<void> => {
  res.json(await listJobs(getCompanyId(req), categoryOf(req)));
});

router.get(`${BASE}/jobs/:jobId`, requireCompanyAdmin, async (req, res): Promise<void> => {
  const jobId = Number(req.params.jobId);
  const job = Number.isInteger(jobId) ? await getJob(getCompanyId(req), jobId) : null;
  if (!job || job.category !== categoryOf(req)) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

export default router;
