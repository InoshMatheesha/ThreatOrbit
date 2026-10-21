import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import type { AppConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { batchesRouter } from './routes/batches.js';
import { healthRouter } from './routes/health.js';

export function createApp(config: AppConfig, logger: Logger = createLogger(config.logLevel)): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(requestLogger(logger));
  app.use('/api', apiRateLimit(config.limits.apiRateLimitPerMinute));
  // Pasted text is held to the same budget as an uploaded file (plus JSON overhead).
  app.use(express.json({ limit: config.limits.maxUploadBytes + 64 * 1024 }));

  app.use('/api/health', healthRouter());
  app.use('/api/batches', batchesRouter(config));

  app.use('/api', notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
