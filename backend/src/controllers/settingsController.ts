import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AiService } from '../services/aiService.js';

const putSchema = z.strictObject({
  provider: z.enum(['gemini', 'anthropic']),
  // Optional so the model can be changed without pasting the key again.
  apiKey: z.string().trim().min(8).max(300).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

/** Administrator-only settings. Responses never contain the API key itself. */
export function settingsHandlers(ai: AiService) {
  const get: RequestHandler = async (_req, res) => {
    res.json({ data: await ai.describe() });
  };
  const put: RequestHandler = async (req, res) => {
    const body = putSchema.parse(req.body ?? {});
    res.json({ data: await ai.saveSettings(body, req.user!) });
  };
  const remove: RequestHandler = async (req, res) => {
    res.json({ data: await ai.removeSettings(req.user!) });
  };
  const models: RequestHandler = async (_req, res) => {
    res.json({ data: await ai.listModels() });
  };
  return { get, put, remove, models };
}
