import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { loadRiskRules } from './config/riskRules.js';
import { connectDatabase } from './db/connection.js';
import { createLogger } from './lib/logger.js';
import { ProviderRegistry } from './providers/registry.js';
import { createLookupQueue } from './queue/index.js';
import { EnrichmentService } from './services/enrichmentService.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);

async function main() {
  const db = await connectDatabase(config, logger);
  const queue = await createLookupQueue(config, logger);
  const registry = new ProviderRegistry(config);
  const enrichment = new EnrichmentService({ config, logger, registry, queue, rules: loadRiskRules(config.enrichment.riskRulesPath) });
  await enrichment.start();

  for (const r of registry.all()) {
    if (!r.adapter.synthetic) logger.info({ provider: r.adapter.id, state: r.state, perMinute: r.limits.requestsPerMinute }, 'Provider');
  }

  // Works from both src/ (tsx) and dist/ (node): both sit one level below backend/.
  const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  const app = createApp(config, logger, { staticDir, enrichment, databaseMode: db.mode });

  const server = app.listen(config.port, config.host, () => {
    logger.info({ url: `http://${config.host}:${config.port}` }, 'Threat Intel Hub listening');
    if (config.allowUnauthenticatedRemote) {
      logger.warn('ALLOW_UNAUTHENTICATED_REMOTE is enabled: the API has no authentication');
    }
  });

  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Shutting down');
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close();
    await enrichment.stop().catch(() => {});
    await db.close().catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'Failed to start');
  process.exit(1);
});
