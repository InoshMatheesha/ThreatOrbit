import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import type { EnrichmentService } from '../services/enrichmentService.js';

function sameSecret(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time regardless of length.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function queueHandlers(config: AppConfig, service: EnrichmentService) {
  const run = async () => {
    const result = await service.tick(config.queue.tickBudgetMs);
    return { mode: service.queueMode, processed: result?.processed ?? 0, pending: result?.pending ?? null };
  };

  /** Called by the dashboard while a batch is active (database queue mode). */
  const tick: RequestHandler = async (_req, res) => {
    res.json({ data: await run() });
  };

  /** Called by an external scheduler with `Authorization: Bearer <CRON_SECRET>`. */
  const cron: RequestHandler = async (req, res) => {
    const secret = config.queue.cronSecret;
    if (!secret) throw new ApiError(404, 'NOT_FOUND', 'Scheduled processing is not enabled (set CRON_SECRET)');
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !sameSecret(token, secret)) throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid scheduler secret');
    res.json({ data: await run() });
  };

  return { tick, cron };
}
