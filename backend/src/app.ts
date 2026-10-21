import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { sessionMiddleware } from './middleware/session.js';
import { batchesRouter } from './routes/batches.js';
import { enrichmentRouter } from './routes/enrichment.js';
import { healthRouter } from './routes/health.js';
import type { EnrichmentService } from './services/enrichmentService.js';

export interface AppOptions {
  /** Built frontend (frontend/dist). When present, the UI is served from the same origin as the API. */
  staticDir?: string;
  /** Without it the app runs in preview-only mode (no database, enrichment routes return 503). */
  enrichment?: EnrichmentService;
  databaseMode?: 'external' | 'embedded';
}

export function createApp(
  config: AppConfig,
  logger: Logger = createLogger(config.logLevel),
  options: AppOptions = {},
): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Served over plain http on loopback, so upgrading subresources to https would break the UI.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use(requestLogger(logger));
  app.use('/api', apiRateLimit(config.limits.apiRateLimitPerMinute));
  // Pasted text is held to the same budget as an uploaded file (plus JSON overhead).
  app.use(express.json({ limit: config.limits.maxUploadBytes + 64 * 1024 }));
  app.use('/api', sessionMiddleware);

  app.use('/api/health', healthRouter({ config, ...(options.enrichment ? { service: options.enrichment } : {}), ...(options.databaseMode ? { databaseMode: options.databaseMode } : {}) }));
  app.use('/api/batches', batchesRouter(config, options.enrichment));
  app.use('/api', enrichmentRouter(config, logger, options.enrichment));

  app.use('/api', notFoundHandler);

  const { staticDir } = options;
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: 'index.html', maxAge: '1h' }));
    // Single-page app: unknown non-API GETs get the shell.
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use(errorHandler(logger));
  return app;
}
