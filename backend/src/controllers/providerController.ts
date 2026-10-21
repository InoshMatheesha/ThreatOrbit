import type { RequestHandler } from 'express';
import { z } from 'zod';
import { PROVIDER_IDS } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { usageToday } from '../services/providerUsage.js';

const TEST_COOLDOWN_MS = 15_000;

export function providerHandlers(service: EnrichmentService) {
  const lastTest = new Map<string, number>();

  /** Provider status for the UI. Exposes state and limits, never credentials. */
  const list: RequestHandler = async (_req, res) => {
    const usage = await usageToday();
    res.json({
      data: service.registry.all().map((r) => ({
        ...service.registry.info(r.adapter.id),
        usedToday: usage.get(r.adapter.id) ?? 0,
      })),
      meta: { queueMode: service.queueMode },
    });
  };

  const test: RequestHandler = async (req, res) => {
    const id = z.enum(PROVIDER_IDS).parse(req.params.id);
    const since = Date.now() - (lastTest.get(id) ?? 0);
    if (since < TEST_COOLDOWN_MS) {
      throw new ApiError(429, 'RATE_LIMITED', `Wait ${Math.ceil((TEST_COOLDOWN_MS - since) / 1000)}s before testing this provider again`);
    }
    lastTest.set(id, Date.now());
    res.json({ data: await service.testProvider(id, req.sessionId) });
  };

  return { list, test };
}
