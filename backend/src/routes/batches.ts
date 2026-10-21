import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { batchHandlers } from '../controllers/batchController.js';
import { createPreviewHandler } from '../controllers/previewController.js';
import { uploadSingleFile } from '../middleware/upload.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { unavailable } from './unavailable.js';

export function batchesRouter(config: AppConfig, service?: EnrichmentService): Router {
  const router = Router();
  const upload = uploadSingleFile(config.limits.maxUploadBytes);
  router.post('/preview', upload, createPreviewHandler(config));
  if (!service) {
    router.use(unavailable);
    return router;
  }
  const h = batchHandlers(config, service);
  router.post('/', upload, h.create);
  router.get('/', h.list);
  router.delete('/', h.removeAll);
  router.get('/:id', h.get);
  router.get('/:id/results', h.results);
  router.get('/:id/items/:index', h.item);
  router.get('/:id/events', h.events);
  router.post('/:id/cancel', h.cancel);
  router.post('/:id/retry-failed', h.retryFailed);
  router.delete('/:id', h.remove);
  return router;
}
