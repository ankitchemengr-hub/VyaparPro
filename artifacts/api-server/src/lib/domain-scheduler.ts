// Background DNS check for customers' pending custom domains, so a domain goes
// live (and the customer gets the "your domain is live" email) without anyone
// pressing "Check DNS now". Runs every 15 minutes:
//   • added in the last 3 days  → checked every run (DNS usually lands fast)
//   • older                     → at most every 6 hours
//   • older than 30 days        → left alone (the customer can still check)
// The same check the portal button runs (custom-domains.ts checkDomainNow),
// so activation, Railway attach and emails behave identically.
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { checkDomainNow } from "./custom-domains";

const INTERVAL_MS = 15 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

let running = false;

export async function runDomainChecks(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { rows } = await pool.query(
      `SELECT company_id, domain FROM company_domains
       WHERE status = 'pending'
         AND created_at > NOW() - INTERVAL '30 days'
         AND (created_at > NOW() - INTERVAL '3 days'
              OR last_checked_at IS NULL
              OR last_checked_at < NOW() - INTERVAL '6 hours')
       ORDER BY created_at DESC`,
    );
    let activated = 0;
    for (const r of rows) {
      try {
        const state = await checkDomainNow(r.company_id);
        if (state.active?.domain === r.domain) activated++;
      } catch (err) {
        logger.warn({ err, domain: r.domain }, "Scheduled domain check failed");
      }
    }
    if (rows.length) logger.info({ checked: rows.length, activated }, "Scheduled custom-domain DNS check done");
  } catch (err) {
    logger.error({ err }, "Scheduled custom-domain DNS check errored");
  } finally {
    running = false;
  }
}

export function startDomainScheduler(): void {
  setTimeout(() => {
    void runDomainChecks();
    setInterval(() => void runDomainChecks(), INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
  logger.info("Custom-domain DNS scheduler started (every 15 min)");
}
