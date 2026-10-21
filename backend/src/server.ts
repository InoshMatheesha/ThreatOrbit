import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const app = createApp(config, logger);

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port }, 'Threat Intel Hub API listening');
  if (config.allowUnauthenticatedRemote) {
    logger.warn('ALLOW_UNAUTHENTICATED_REMOTE is enabled: the API has no authentication');
  }
});

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
