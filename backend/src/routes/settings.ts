import { Router } from 'express';
import { settingsHandlers } from '../controllers/settingsController.js';
import { providerKeyHandlers } from '../controllers/providerKeyController.js';
import { requireRole } from '../middleware/auth.js';
import type { AiService } from '../services/aiService.js';
import type { ProviderKeyService } from '../services/providerKeyService.js';

export function settingsRouter(ai?: AiService, keyService?: ProviderKeyService): Router {
  const router = Router();
  router.use(requireRole('admin'));

  if (ai) {
    const h = settingsHandlers(ai);
    router.get('/ai', h.get);
    router.put('/ai', h.put);
    router.delete('/ai', h.remove);
    router.get('/ai/models', h.models);
  }

  if (keyService) {
    const kh = providerKeyHandlers(keyService);
    router.get('/provider-keys', kh.list);
    router.post('/provider-keys', kh.create);
    router.patch('/provider-keys/:id', kh.update);
    router.delete('/provider-keys/:id', kh.remove);
    router.post('/provider-keys/:id/test', kh.test);
  }

  return router;
}
