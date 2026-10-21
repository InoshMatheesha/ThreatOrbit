import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { loadRiskRules } from './config/riskRules.js';
import { connectServerless } from './db/connection.js';
import { createLogger } from './lib/logger.js';
import { ProviderRegistry } from './providers/registry.js';
import { DatabaseLookupQueue } from './queue/databaseQueue.js';
import { AuthService } from './services/authService.js';
import { EnrichmentService } from './services/enrichmentService.js';

/**
 * Entry point for serverless hosting (Vercel Functions). The API runs on the
 * same domain as the website, lookups are queued in MongoDB, and processing
 * happens in short bursts via POST /api/queue/tick (and optionally a scheduler
 * calling /api/cron/tick).
 */
let ready: Promise<Express> | undefined;

/** Vercel function limit set in scripts/build-vercel.mjs (maxDuration). */
const FUNCTION_LIMIT_MS = 60_000;

async function init(): Promise<Express> {
  const config = loadConfig({
    // Sensible serverless defaults; explicit environment variables still win.
    NODE_ENV: 'production',
    QUEUE_MODE: 'database',
    TRUST_PROXY: '1',
    COOKIE_SECURE: 'true',
    MONGODB_EMBEDDED_FALLBACK: 'false',
    ...process.env,
  });
  if (config.queue.mode !== 'database') throw new Error('Serverless hosting requires QUEUE_MODE=database');
  // A lookup started at the end of a tick may run for the full provider timeout.
  config.queue.tickBudgetMs = Math.min(config.queue.tickBudgetMs, FUNCTION_LIMIT_MS - config.enrichment.timeoutMs - 5_000);
  const logger = createLogger(config.logLevel);
  await connectServerless(config);

  const registry = new ProviderRegistry(config);
  const queue = new DatabaseLookupQueue(logger);
  const enrichment = new EnrichmentService({ config, logger, registry, queue, rules: loadRiskRules(config.enrichment.riskRulesPath) });
  await enrichment.start({ background: false, recover: false });
  const auth = new AuthService(config, logger);
  await auth.bootstrapAdmin();

  return createApp(config, logger, { enrichment, auth, databaseMode: 'external' });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    ready ??= init();
    const app = await ready;
    app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
  } catch (err) {
    // Let the next request retry initialisation (e.g. the database was briefly unreachable).
    ready = undefined;
    console.error('Startup failed:', (err as Error).message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Service is starting or the database is unreachable. Try again shortly.' },
      }),
    );
  }
}
