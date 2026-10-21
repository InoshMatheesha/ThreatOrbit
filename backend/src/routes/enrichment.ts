import { Router } from 'express';
import type { Logger } from 'pino';
import { listAudit } from '../controllers/auditController.js';
import { batchHandlers } from '../controllers/batchController.js';
import { exportHandler } from '../controllers/exportController.js';
import { providerHandlers } from '../controllers/providerController.js';
import type { AppConfig } from '../config/env.js';
import { requireRole } from '../middleware/auth.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { unavailable } from './unavailable.js';

/** /api/results, /api/providers, /api/exports and /api/audit. */
export function enrichmentRouter(config: AppConfig, logger: Logger, service?: EnrichmentService): Router {
  const router = Router();
  if (!service) {
    router.use(['/results', '/providers', '/exports', '/audit'], unavailable);
    return router;
  }
  const batches = batchHandlers(config, service);
  const providers = providerHandlers(service);
  router.post('/results/:id/retry', batches.retryResult);
  router.get('/providers', providers.list);
  router.post('/providers/:id/test', requireRole('admin'), providers.test);
  router.get('/exports/:batchId', exportHandler(service, logger));
  router.get('/audit', requireRole('admin'), listAudit);
  return router;
}
