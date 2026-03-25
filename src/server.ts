import { createRuntime } from "./runtime.js";
import { logger } from "./logger.js";

async function main() {
  const runtime = await createRuntime({ installSignalHandlers: true });
  await runtime.start();
  logger.info(
    `multivibe listening on ${runtime.config.host}:${runtime.config.port}`,
  );
  logger.info(
    `store=${runtime.config.storePath} oauth=${runtime.config.oauthStatePath} trace=${runtime.config.traceFilePath} traceStats=${runtime.config.traceStatsHistoryPath} redirect=${runtime.config.oauthConfig.redirectUri} openaiUpstream=${runtime.config.openaiBaseUrl} mistralUpstream=${runtime.config.mistralBaseUrl}${runtime.config.mistralUpstreamPath}`,
  );
}

main().catch((err) => {
  logger.error({ err }, "startup_error");
  process.exit(1);
});
