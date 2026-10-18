import { logger } from "./logger";
import { runDueSchedules } from "./non-gst-cleanup";

// Checks every 15 minutes for Non-GST cleanup schedules that are due (see
// non_gst_cleanup_settings.next_run_at). A missed run — server was off — fires
// on the first check after it comes back.
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const ran = await runDueSchedules();
    if (ran > 0) logger.info({ ran }, "Scheduled Non-GST cleanup runs completed");
  } catch (err) {
    logger.error({ err }, "Non-GST cleanup scheduler tick failed");
  } finally {
    running = false;
  }
}

export function startNonGstCleanupScheduler(): void {
  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
  logger.info("Non-GST cleanup scheduler started");
}
