import app from "./app";
import { ensureDatabaseReady } from "./lib/bootstrap";
import { logger } from "./lib/logger";
import { startSubscriptionScheduler } from "./lib/subscription-scheduler";
import { isMultiCompanyMode, getDefaultCompanyId } from "./lib/system-config";
import { getCurrentCompany } from "./lib/company";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${rawPort}`);
}

async function start(): Promise<void> {
  await ensureDatabaseReady();
  // Actually start the HTTP server
  app.listen(port, () => {
    logger.info(`🚀 Server running on http://localhost:${port}`);
  });
}

// Execute the start function
start().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});