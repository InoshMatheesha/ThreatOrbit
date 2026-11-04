import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AiService } from '../services/aiService.js';

const putSchema = z.strictObject({
  provider: z.enum(['gemini', 'openai', 'anthropic', 'openrouter', 'kimi', 'custom']),
  // Optional so the model can be changed without pasting the key again.
  apiKey: z.string().trim().min(8).max(500).optional(),
  model: z.string().trim().min(1).max(150).optional(),
  baseUrl: z.string().trim().max(300).optional(),
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
  const remove: RequestHandler = async (_req, res) => {
    res.json({ data: await ai.removeSettings(_req.user!) });
  };
  const models: RequestHandler = async (_req, res) => {
    res.json({ data: await ai.listModels() });
  };
  return { get, put, remove, models };
}
