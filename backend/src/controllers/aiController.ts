import type { RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import type { AiService } from '../services/aiService.js';
import type { EnrichmentService } from '../services/enrichmentService.js';
import { batchIdSchema, loadBatchWithViews } from './batchController.js';

const booleanish = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const bodySchema = z.strictObject({ refresh: booleanish.optional() });
const indexSchema = z.coerce.number().int().min(0);

async function present<T extends { generatedAt: Date }>(result: T | null, ai: AiService) {
  return { data: result, meta: await ai.status() };
}

export function aiHandlers(service: EnrichmentService, ai: AiService) {
  const load = async (id: unknown) => {
    const { batch, views } = await loadBatchWithViews(service, String(batchIdSchema.parse(id)));
    return { batch, views };
  };
  const find = (views: Awaited<ReturnType<typeof load>>['views'], index: unknown) => {
    const view = views.find((v) => v.index === indexSchema.parse(index));
    if (!view) throw new ApiError(404, 'NOT_FOUND', 'Indicator not found in this batch');
    return view;
  };

  const getBatch: RequestHandler = async (req, res) => {
    const { batch, views } = await load(req.params.id);
    const enabled = (await ai.status()).enabled;
    res.json(await present(enabled ? await ai.getBatch(batch, views) : null, ai));
  };

  const explainBatch: RequestHandler = async (req, res) => {
    const { refresh } = bodySchema.parse(req.body ?? {});
    const { batch, views } = await load(req.params.id);
    res.json(await present(await ai.explainBatch(batch, views, req.user!, refresh), ai));
  };

  const getItem: RequestHandler = async (req, res) => {
    const { batch, views } = await load(req.params.id);
    const item = find(views, req.params.index);
    const enabled = (await ai.status()).enabled;
    res.json(await present(enabled ? await ai.getItem(batch, item) : null, ai));
  };

  const explainItem: RequestHandler = async (req, res) => {
    const { refresh } = bodySchema.parse(req.body ?? {});
    const { batch, views } = await load(req.params.id);
    const item = find(views, req.params.index);
    res.json(await present(await ai.explainItem(batch, item, req.user!, refresh), ai));
  };

  return { getBatch, explainBatch, getItem, explainItem };
}
