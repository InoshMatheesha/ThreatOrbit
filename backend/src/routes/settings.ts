import { Router } from 'express';
import { providerKeyHandlers } from '../controllers/providerKeyController.js';
import { settingsHandlers } from '../controllers/settingsController.js';
import { requireRole } from '../middleware/auth.js';
import type { AiService } from '../services/aiService.js';
import type { EnrichmentService } from '../services/enrichmentService.js';

/** /api/settings: administrator-only configuration (AI assistant and provider API keys). */
export function settingsRouter(ai?: AiService, enrichment?: EnrichmentService): Router {
  const router = Router();
  router.use(requireRole('admin'));

  if (ai) {
    const h = settingsHandlers(ai);
    router.get('/ai', h.get);
    router.put('/ai', h.put);
    router.delete('/ai', h.remove);
    router.get('/ai/models', h.models);
  }

  if (enrichment) {
    const k = providerKeyHandlers(enrichment);
    router.get('/provider-keys', k.list);
    router.post('/provider-keys', k.create);
    router.patch('/provider-keys/:id', k.update);
    router.delete('/provider-keys/:id', k.remove);
    router.post('/provider-keys/:id/test', k.test);
  }

  return router;
}
