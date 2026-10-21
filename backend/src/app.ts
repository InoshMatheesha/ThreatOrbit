import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { authenticate, originCheck, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { queueHandlers } from './controllers/queueController.js';
import { authRouter, usersRouter } from './routes/auth.js';
import { batchesRouter } from './routes/batches.js';
import { enrichmentRouter } from './routes/enrichment.js';
import { healthRouter } from './routes/health.js';
import type { AuthService } from './services/authService.js';
import type { EnrichmentService } from './services/enrichmentService.js';

export interface AppOptions {
  /** Built frontend (frontend/dist). When present, the UI is served from the same origin as the API. */
  staticDir?: string;
  /** Without it the app runs in preview-only mode (no database, enrichment routes return 503). */
  enrichment?: EnrichmentService;
  /** Sign-in. When present, every endpoint except health and login requires a session. */
  auth?: AuthService;
  databaseMode?: 'external' | 'embedded';
}

export function createApp(config: AppConfig, logger: Logger = createLogger(config.logLevel), options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind Vercel/Render the client IP arrives in X-Forwarded-For; trust exactly that many hops.
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(requestLogger(logger));
  app.use('/api', apiRateLimit(config.limits.apiRateLimitPerMinute));
  // Pasted text is held to the same budget as an uploaded file (plus JSON overhead).
  app.use(express.json({ limit: config.limits.maxUploadBytes + 64 * 1024 }));

  const { auth, enrichment } = options;
  if (auth) {
    app.use('/api', originCheck(config), authenticate(config, auth));
  }

  app.use(
    '/api/health',
    healthRouter({
      config,
      ...(enrichment ? { service: enrichment } : {}),
      ...(options.databaseMode ? { databaseMode: options.databaseMode } : {}),
    }),
  );
  if (enrichment) {
    // Before the auth gate: authenticated by its own shared secret.
    app.all('/api/cron/tick', queueHandlers(config, enrichment).cron);
  }
  if (auth) {
    app.use('/api/auth', authRouter(config, auth));
    app.use('/api', requireAuth);
    app.use('/api/users', usersRouter(logger));
  }
  if (enrichment) app.post('/api/queue/tick', queueHandlers(config, enrichment).tick);
  app.use('/api/batches', batchesRouter(config, enrichment));
  app.use('/api', enrichmentRouter(config, logger, enrichment));

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
