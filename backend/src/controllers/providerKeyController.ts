import type { RequestHandler } from 'express';
import { z } from 'zod';
import { PROVIDER_IDS } from '../config/env.js';
import type { ProviderKeyService } from '../services/providerKeyService.js';

const createKeySchema = z.strictObject({
  provider: z.enum(PROVIDER_IDS),
  label: z.string().trim().min(1).max(120),
  apiKey: z.string().trim().min(4).max(500),
  requestsPerMinute: z.number().int().positive().max(5000).optional(),
  dailyLimit: z.number().int().positive().max(1_000_000).optional(),
});

const updateKeySchema = z.strictObject({
  label: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().min(4).max(500).optional(),
  active: z.boolean().optional(),
  requestsPerMinute: z.number().int().positive().max(5000).nullable().optional(),
  dailyLimit: z.number().int().positive().max(1_000_000).nullable().optional(),
});

export function providerKeyHandlers(service: ProviderKeyService) {
  const list: RequestHandler = async (_req, res) => {
    const keys = await service.listKeys();
    res.json({ data: keys });
  };

  const create: RequestHandler = async (req, res) => {
    const body = createKeySchema.parse(req.body ?? {});
    const key = await service.addKey(body, req.user!);
    res.status(201).json({ data: key });
  };

  const update: RequestHandler = async (req, res) => {
    const body = updateKeySchema.parse(req.body ?? {});
    const key = await service.updateKey(String(req.params.id), body, req.user!);
    res.json({ data: key });
  };

  const remove: RequestHandler = async (req, res) => {
    await service.deleteKey(String(req.params.id), req.user!);
    res.json({ data: { ok: true } });
  };

  const test: RequestHandler = async (req, res) => {
    const result = await service.testKey(String(req.params.id), req.user!);
    res.json({ data: result });
  };

  return { list, create, update, remove, test };
}

