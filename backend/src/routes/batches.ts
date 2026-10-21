import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import { createPreviewHandler } from '../controllers/previewController.js';
import { uploadSingleFile } from '../middleware/upload.js';

export function batchesRouter(config: AppConfig): Router {
  const router = Router();
  router.post('/preview', uploadSingleFile(config.limits.maxUploadBytes), createPreviewHandler(config));
  return router;
}
