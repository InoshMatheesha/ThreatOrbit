import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { aiHandlers } from '../controllers/aiController.js';
import { batchHandlers } from '../controllers/batchController.js';
import { createPreviewHandler } from '../controllers/previewController.js';
import { requireRole } from '../middleware/auth.js';
import { uploadSingleFile } from '../middleware/upload.js';
import type { AiService } from '../services/aiService.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { unavailable } from './unavailable.js';

export function batchesRouter(config: AppConfig, service?: EnrichmentService, ai?: AiService): Router {
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
  router.delete('/', requireRole('admin'), h.removeAll);
  router.get('/:id', h.get);
  router.get('/:id/results', h.results);
  router.get('/:id/items/:index', h.item);
  router.get('/:id/events', h.events);
  if (ai) {
    const a = aiHandlers(service, ai);
    router.get('/:id/explanation', a.getBatch);
    router.post('/:id/explanation', a.explainBatch);
    router.get('/:id/items/:index/explanation', a.getItem);
    router.post('/:id/items/:index/explanation', a.explainItem);
  }
  router.post('/:id/cancel', h.cancel);
  router.post('/:id/retry-failed', h.retryFailed);
  router.delete('/:id', h.remove);
  return router;
}
