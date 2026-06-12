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
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await ensureDatabaseReady();

  // Announce the deployment mode at boot so operators can confirm a dedicated
  // install is locked to the intended company.
  if (!isMultiCompanyMode()) {
    const company = await getCurrentCompany(getDefaultCompanyId());
    const companyName = company?.name ?? `id ${getDefaultCompanyId() ?? "(unset/invalid)"}`;
    logger.info(`Dedicated Company Mode Enabled for: ${companyName}`);
  } else {
    logger.info("Multi-Company Mode Enabled (shared SaaS)");
  }

  startSubscriptionScheduler();

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
}

start().catch((err) => {
  logger.error({ err }, "Fatal error during server startup");
  process.exit(1);
});
