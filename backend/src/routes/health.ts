import { Router } from 'express';

const startedAt = Date.now();

export function healthRouter(): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({
      data: {
        status: 'ok',
        service: 'threat-intel-hub',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        time: new Date().toISOString(),
      },
    });
  });
  return router;
}
