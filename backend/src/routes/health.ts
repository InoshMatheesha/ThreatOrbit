import { Router } from 'express';
import mongoose from 'mongoose';
import type { AppConfig } from '../config/env.js';
import type { EnrichmentService } from '../services/enrichmentService.js';

const startedAt = Date.now();

export interface HealthInfo {
  config?: AppConfig;
  databaseMode?: 'external' | 'embedded';
  service?: EnrichmentService;
}

/** Public liveness probe (used by the host). Internal details only for signed-in users. */
export function healthRouter(info: HealthInfo = {}): Router {
  const router = Router();
  router.get('/', (req, res) => {
    const dbConnected = mongoose.connection.readyState === 1;
    const status = info.service && !dbConnected ? 'degraded' : 'ok';
    if (!req.user) {
      res.status(status === 'ok' ? 200 : 503).json({ data: { status, service: 'threat-intel-hub' } });
      return;
    }
    res.json({
      data: {
        status,
        service: 'threat-intel-hub',
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        time: new Date().toISOString(),
        enrichment: info.service
          ? {
              database: { connected: dbConnected, mode: info.databaseMode ?? 'external' },
              queue: { mode: info.service.queueMode },
              ...(info.config
                ? {
                    settings: {
                      maxBatchSize: info.config.limits.maxBatchSize,
                      retentionDays: info.config.retention.days,
                      cacheTtlHours: Math.round(info.config.enrichment.cacheTtlMs / 3_600_000),
                    },
                  }
                : {}),
            }
          : null,
      },
    });
  });
  return router;
}
