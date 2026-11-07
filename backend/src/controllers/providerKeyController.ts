import type { RequestHandler } from 'express';
import { z } from 'zod';
import { PROVIDER_IDS } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import type { EnrichmentService } from '../services/enrichmentService.js';

const TEST_COOLDOWN_MS = 10_000;

/** Printable ASCII without spaces: every supported provider's key format, and safe in an HTTP header. */
const apiKey = z
  .string()
  .trim()
  .min(8, 'API key is too short')
  .max(500)
  .regex(/^[\x21-\x7e]+$/, 'API keys contain no spaces or special characters. Check that you copied only the key.');
const label = z.string().trim().min(1, 'Give the key a name').max(120);
const requestsPerMinute = z.number().int().min(1).max(10_000).nullable().optional();
const dailyLimit = z.number().int().min(1).max(10_000_000).nullable().optional();
const keyId = z.string().regex(/^(?:env:[a-z]+|[0-9a-f-]{36})$/, 'Invalid key id');

const createSchema = z.strictObject({ provider: z.enum(PROVIDER_IDS), label, apiKey, requestsPerMinute, dailyLimit });
const updateSchema = z
  .strictObject({ label: label.optional(), apiKey: apiKey.optional(), active: z.boolean().optional(), requestsPerMinute, dailyLimit })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

/**
 * Administrator-only management of provider API keys (mounted behind requireRole('admin')).
 * Responses never contain a key, only its last four characters.
 */
export function providerKeyHandlers(service: EnrichmentService) {
  const keys = service.keyService;
  const lastTest = new Map<string, number>();

  const list: RequestHandler = async (_req, res) => {
    res.json({ data: await keys.list(), meta: { encryptionAvailable: keys.encryptionAvailable } });
  };

  const create: RequestHandler = async (req, res) => {
    const body = createSchema.parse(req.body ?? {});
    const key = await keys.create(body, req.user!);
    await service.refreshProviders();
    res.status(201).json({ data: key });
  };

  const update: RequestHandler = async (req, res) => {
    const id = keyId.parse(req.params.id);
    const body = updateSchema.parse(req.body ?? {});
    const key = await keys.update(id, body, req.user!);
    await service.refreshProviders();
    res.json({ data: key });
  };

  const remove: RequestHandler = async (req, res) => {
    await keys.remove(keyId.parse(req.params.id), req.user!);
    await service.refreshProviders();
    res.status(204).end();
  };

  const test: RequestHandler = async (req, res) => {
    const id = keyId.parse(req.params.id);
    const since = Date.now() - (lastTest.get(id) ?? 0);
    if (since < TEST_COOLDOWN_MS) {
      throw new ApiError(429, 'RATE_LIMITED', `Wait ${Math.ceil((TEST_COOLDOWN_MS - since) / 1000)}s before testing this key again`);
    }
    lastTest.set(id, Date.now());
    const result = await keys.test(id, req.user!);
    await service.refreshProviders();
    res.json({ data: result });
  };

  return { list, create, update, remove, test };
}
