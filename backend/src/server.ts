import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
// Works from both src/ (tsx) and dist/ (node): both sit one level below backend/.
const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url));
const app = createApp(config, logger, { staticDir });

const server = app.listen(config.port, config.host, () => {
  logger.info({ url: `http://${config.host}:${config.port}` }, 'Threat Intel Hub listening');
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
