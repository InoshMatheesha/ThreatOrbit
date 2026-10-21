import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { loadRiskRules } from './config/riskRules.js';
import { connectDatabase } from './db/connection.js';
import { createLogger } from './lib/logger.js';
import { User } from './models/User.js';
import { ProviderRegistry } from './providers/registry.js';
import { AuthService } from './services/authService.js';
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
  const auth = new AuthService(config, logger);
  await auth.bootstrapAdmin();
  if ((await User.estimatedDocumentCount()) === 0) {
    logger.warn('No user accounts exist. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the first admin.');
  }

  for (const r of registry.all()) {
    logger.info({ provider: r.adapter.id, state: r.state, perMinute: r.limits.requestsPerMinute }, 'Provider');
  }

  // Works from both src/ (tsx) and dist/ (node): both sit one level below backend/.
  const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url));
  const app = createApp(config, logger, { staticDir, enrichment, auth, databaseMode: db.mode });

  const server = app.listen(config.port, config.host, () => {
    logger.info({ url: `http://${config.host}:${config.port}` }, 'ThreatOrbit listening');
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
