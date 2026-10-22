import { Router } from 'express';
import { settingsHandlers } from '../controllers/settingsController.js';
import { requireRole } from '../middleware/auth.js';
import type { AiService } from '../services/aiService.js';

export function settingsRouter(ai: AiService): Router {
  const router = Router();
  const h = settingsHandlers(ai);
  router.use(requireRole('admin'));
  router.get('/ai', h.get);
  router.put('/ai', h.put);
  router.delete('/ai', h.remove);
  router.get('/ai/models', h.models);
  return router;
}
