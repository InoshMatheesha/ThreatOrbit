import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { AiExplanation, Setting, type BatchDoc, type ExplanationScope } from '../models/index.js';
import {
  BATCH_SCHEMA,
  batchEvidence,
  batchPrompt,
  ITEM_SCHEMA,
  itemEvidence,
  itemPrompt,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from './aiPrompts.js';
import { AiClientError, type AiClient, type AiModelInfo, type AiRequest } from './aiClient.js';
import { createGeminiClient, pickDefaultGeminiModel } from './geminiClient.js';
import { createOpenAiCompatibleClient } from './openaiCompatibleClient.js';
import { audit } from './audit.js';
import type { Principal } from './authService.js';
import { reserveRequest } from './providerUsage.js';
import type { ItemView } from './resultViews.js';

export { AiClientError, type AiClient, type AiRequest } from './aiClient.js';

const REQUEST_TIMEOUT_MS = 40_000;
const MAX_OUTPUT_TOKENS = 4096;

export function createAnthropicClient(config: { apiKey: string; model: string }): AiClient {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  return {
    async generate({ system, prompt, schema }) {
      try {
        const response = await client.beta.messages.create({
          model: config.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
        });
        if (response.stop_reason === 'refusal') throw new AiClientError('refused', 'The model declined the request');
        if (response.stop_reason === 'max_tokens') throw new AiClientError('truncated', 'The model ran out of room');
        const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        return { text, model: response.model };
      } catch (err) {
        if (err instanceof AiClientError) throw err;
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new AiClientError('rejected_key', 'The Anthropic API key was rejected', err.status);
        }
        if (err instanceof Anthropic.RateLimitError) throw new AiClientError('busy', 'Rate limited by Anthropic', err.status);
        if (err instanceof Anthropic.APIError) throw new AiClientError('failed', `Anthropic API error: ${err.message}`, err.status);
        throw new AiClientError('failed', (err as Error).message);
      }
    },
    async listModels() {
      try {
        const page = await client.models.list({ limit: 100 });
        return page.data.map((m) => ({ id: m.id, name: m.display_name }));
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new AiClientError('rejected_key', 'The Anthropic API key was rejected', err.status);
        }
        throw new AiClientError('failed', (err as Error).message);
      }
    },
  };
}

const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const steps = z.array(text(240)).transform((l) => l.filter(Boolean).slice(0, 5));

const itemSchema = z.object({
  headline: text(140),
  whatIsIt: text(500),
  whyItMatters: text(500),
  confidence: z.enum(['low', 'medium', 'high']),
  nextSteps: steps,
});
const batchSchema = z.object({
  headline: text(140),
  overview: text(900),
  keyPoints: steps,
  nextSteps: steps,
  indicators: z.array(z.object({ value: text(2100), headline: text(140), explanation: text(500), nextSteps: steps })),
});

export type ItemExplanation = z.infer<typeof itemSchema>;
export type BatchExplanation = z.infer<typeof batchSchema>;

export interface ExplanationResult<T> {
  explanation: T;
  model: string;
  generatedAt: Date;
  stale: boolean;
  cached: boolean;
}

const hash = (value: unknown) =>
  createHash('sha256')
    .update(`v${PROMPT_VERSION}:${JSON.stringify(value)}`)
    .digest('hex');

export type AiProvider = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'kimi' | 'custom';

export interface ProviderMeta {
  name: string;
  defaultModel: string;
  signupUrl: string;
  defaultBaseUrl?: string;
  requiresBaseUrl?: boolean;
  description?: string;
}

export const AI_PROVIDERS: Record<AiProvider, ProviderMeta> = {
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    signupUrl: 'https://aistudio.google.com/apikey',
    description: 'Fast and free tier friendly.',
  },
  openai: {
    name: 'OpenAI (ChatGPT)',
    defaultModel: 'gpt-4o-mini',
    signupUrl: 'https://platform.openai.com/api-keys',
    defaultBaseUrl: 'https://api.openai.com/v1',
    description: 'GPT-4o, GPT-4o-mini, o3-mini.',
  },
  anthropic: {
    name: 'Anthropic Claude',
    defaultModel: 'claude-3-5-sonnet-20241022',
    signupUrl: 'https://console.anthropic.com/',
    description: 'Claude 3.5 Sonnet, Claude 3.7 Sonnet, Opus.',
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'openai/gpt-4o-mini',
    signupUrl: 'https://openrouter.ai/keys',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    description: 'Access ChatGPT, Claude, DeepSeek, and free models with one key.',
  },
  kimi: {
    name: 'Kimi (Moonshot AI)',
    defaultModel: 'moonshot-v1-8k',
    signupUrl: 'https://platform.moonshot.cn/',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    description: 'Moonshot v1 8k, 32k, 128k.',
  },
  custom: {
    name: 'Custom / OpenAI-Compatible API',
    defaultModel: 'default',
    signupUrl: 'https://github.com/InoshMatheesha/ThreatOrbit',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresBaseUrl: true,
    description: 'Any OpenAI-compatible endpoint (DeepSeek, Groq, Ollama, vLLM).',
  },
};

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export type ClientFactory = (settings: AiSettings) => AiClient;

const defaultFactory: ClientFactory = (s) => {
  switch (s.provider) {
    case 'gemini':
      return createGeminiClient({ apiKey: s.apiKey, model: s.model });
    case 'anthropic':
      return createAnthropicClient(s);
    case 'openai':
      return createOpenAiCompatibleClient({
        baseUrl: s.baseUrl || 'https://api.openai.com/v1',
        apiKey: s.apiKey,
        model: s.model,
        providerName: 'OpenAI',
      });
    case 'openrouter':
      return createOpenAiCompatibleClient({
        baseUrl: s.baseUrl || 'https://openrouter.ai/api/v1',
        apiKey: s.apiKey,
        model: s.model,
        providerName: 'OpenRouter',
      });
    case 'kimi':
      return createOpenAiCompatibleClient({
        baseUrl: s.baseUrl || 'https://api.moonshot.cn/v1',
        apiKey: s.apiKey,
        model: s.model,
        providerName: 'Kimi (Moonshot AI)',
      });
    case 'custom':
      return createOpenAiCompatibleClient({
        baseUrl: s.baseUrl || 'https://api.openai.com/v1',
        apiKey: s.apiKey,
        model: s.model,
        providerName: 'Custom AI API',
      });
    default:
      return createGeminiClient({ apiKey: s.apiKey, model: s.model });
  }
};

/** Smart model auto-detection across all providers (with free-model prioritization). */
export function pickBestModel(
  provider: AiProvider,
  models: AiModelInfo[],
  preferFree = false,
): string {
  const ids = models.map((m) => m.id);
  if (ids.length === 0) return AI_PROVIDERS[provider].defaultModel;

  if (provider === 'openrouter') {
    const freeModels = models.filter((m) => m.free || m.id.endsWith(':free') || m.id.includes(':free'));

    if (preferFree && freeModels.length > 0) {
      const freePreferences = [
        /gemini-2/i,
        /gemini-1\.5-flash/i,
        /deepseek.*chat/i,
        /deepseek.*v3/i,
        /deepseek.*r1/i,
        /llama-3\.3-70b/i,
        /llama-3\.1-70b/i,
        /qwen.*72b/i,
        /qwen.*32b/i,
        /llama-3/i,
      ];
      for (const re of freePreferences) {
        const found = freeModels.find((m) => re.test(m.id));
        if (found) return found.id;
      }
      const firstFree = freeModels[0];
      if (firstFree) return firstFree.id;
    }

    const openRouterPref = [
      /^openai\/gpt-4o-mini/i,
      /^google\/gemini-2\.5-flash/i,
      /^google\/gemini-2\.0-flash/i,
      /^deepseek\/deepseek-chat/i,
      /^anthropic\/claude-3\.5-haiku/i,
      /^meta-llama\/llama-3\.3-70b-instruct/i,
    ];
    for (const re of openRouterPref) {
      const found = ids.find((id) => re.test(id));
      if (found) return found;
    }

    const firstFree = freeModels[0];
    if (firstFree) {
      return firstFree.id;
    }
  }

  if (provider === 'gemini') {
    return pickDefaultGeminiModel(ids) ?? 'gemini-2.5-flash';
  }

  if (provider === 'openai') {
    const pref = [/^gpt-4o-mini$/i, /^gpt-4o$/i, /^o3-mini$/i, /^gpt-4-turbo$/i, /^gpt-3\.5-turbo$/i];
    for (const re of pref) {
      const found = ids.find((id) => re.test(id));
      if (found) return found;
    }
  }

  if (provider === 'anthropic') {
    const pref = [/claude-3-5-sonnet/i, /claude-3-7-sonnet/i, /claude-3-5-haiku/i, /claude-3-haiku/i, /claude-opus/i];
    for (const re of pref) {
      const found = ids.find((id) => re.test(id));
      if (found) return found;
    }
  }

  if (provider === 'kimi') {
    const pref = [/^moonshot-v1-8k$/i, /^moonshot-v1-32k$/i, /^moonshot-v1-128k$/i];
    for (const re of pref) {
      const found = ids.find((id) => re.test(id));
      if (found) return found;
    }
  }

  if (preferFree) {
    const free = ids.find((id) => /free/i.test(id));
    if (free) return free;
  }

  const firstId = ids[0];
  return firstId || AI_PROVIDERS[provider].defaultModel;
}

// ---- Data Normalization Helpers (Prevent Schema Validation Crashes) ----

function normalizeString(val: unknown, fallback = ''): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return fallback;
}

function normalizeArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => normalizeString(v)).filter(Boolean);
  }
  if (typeof val === 'string' && val.trim()) {
    return val
      .split(/\r?\n/)
      .map((s) => s.replace(/^[-*•\d.]+\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeConfidence(val: unknown): 'low' | 'medium' | 'high' {
  if (typeof val === 'string') {
    const s = val.toLowerCase().trim();
    if (s.includes('high')) return 'high';
    if (s.includes('low')) return 'low';
    if (s.includes('med')) return 'medium';
  }
  return 'medium';
}

export function normalizeBatchExplanation(raw: unknown, top: Array<{ value: string }> = []): BatchExplanation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return batchSchema.parse(raw);
  }
  const obj = raw as Record<string, unknown>;

  const headline = normalizeString(obj.headline ?? obj.title);
  const overview = normalizeString(obj.overview ?? obj.summary ?? obj.description);
  const rawKeyPoints = obj.keyPoints ?? obj.key_points ?? obj.points ?? obj.highlights;
  const rawNextSteps = obj.nextSteps ?? obj.next_steps ?? obj.recommendations ?? obj.actions;
  const rawIndicators = obj.indicators ?? obj.results;

  const order = new Map(top.map((v, i) => [v.value, i]));

  const indicators = Array.isArray(rawIndicators)
    ? rawIndicators
        .map((ind: unknown, idx: number) => {
          const i = (ind && typeof ind === 'object' ? ind : {}) as Record<string, unknown>;
          const fallbackValue = top[idx]?.value ?? '';
          const value = normalizeString(i.value ?? i.indicator) || fallbackValue;
          return {
            value,
            headline: normalizeString(i.headline ?? i.title) || 'Indicator assessment',
            explanation:
              normalizeString(i.explanation ?? i.summary ?? i.description) ||
              'Examined against threat intelligence sources.',
            nextSteps: normalizeArray(i.nextSteps ?? i.next_steps ?? i.recommendations) ?? [],
          };
        })
        .filter((i) => order.has(i.value))
        .sort((a, b) => order.get(a.value)! - order.get(b.value)!)
    : undefined;

  return batchSchema.parse({
    headline,
    overview,
    keyPoints: rawKeyPoints !== undefined ? normalizeArray(rawKeyPoints) : undefined,
    nextSteps: rawNextSteps !== undefined ? normalizeArray(rawNextSteps) : undefined,
    indicators,
  });
}

export function normalizeItemExplanation(raw: unknown, defaultHeadline = 'Indicator analysis'): ItemExplanation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return itemSchema.parse(raw);
  }
  const obj = raw as Record<string, unknown>;

  const headline = normalizeString(obj.headline ?? obj.title) || defaultHeadline;
  const rawWhat = obj.whatIsIt ?? obj.what_is_it ?? obj.description ?? obj.summary;
  const rawWhy = obj.whyItMatters ?? obj.why_it_matters ?? obj.impact ?? obj.risk_summary;
  const rawNextSteps = obj.nextSteps ?? obj.next_steps ?? obj.recommendations ?? obj.actions;

  return itemSchema.parse({
    headline,
    whatIsIt: rawWhat !== undefined ? normalizeString(rawWhat) : undefined,
    whyItMatters: rawWhy !== undefined ? normalizeString(rawWhy) : undefined,
    confidence: normalizeConfidence(obj.confidence),
    nextSteps: rawNextSteps !== undefined ? normalizeArray(rawNextSteps) : undefined,
  });
}

const SETTING_ID = 'ai';
const SETTINGS_TTL_MS = 10_000;

interface Deps {
  config: AppConfig;
  logger: Logger;
  client?: AiClient;
  factory?: ClientFactory;
}

type BatchInput = Pick<BatchDoc, '_id' | 'totals' | 'counters' | 'providers'>;

interface Resolved {
  client: AiClient;
  provider: AiProvider;
  model: string;
  source: 'database' | 'environment' | 'injected';
}

export interface AiStatus {
  enabled: boolean;
  provider: AiProvider | null;
  providerName: string | null;
  model: string | null;
  dailyLimit: number;
}

export class AiService {
  private readonly factory: ClientFactory;
  private resolved: { at: number; value: Resolved | null } | null = null;

  constructor(private readonly deps: Deps) {
    this.factory = deps.factory ?? defaultFactory;
  }

  // ---- configuration ----

  async resolve(): Promise<Resolved | null> {
    if (this.deps.client) {
      return { client: this.deps.client, provider: 'anthropic', model: this.deps.config.ai.model, source: 'injected' };
    }
    if (this.resolved && Date.now() - this.resolved.at < SETTINGS_TTL_MS) return this.resolved.value;
    const stored = await this.stored();
    const { apiKey, model } = this.deps.config.ai;
    const value: Resolved | null = stored
      ? { client: this.factory(stored), provider: stored.provider, model: stored.model, source: 'database' }
      : apiKey
        ? { client: this.factory({ provider: 'anthropic', apiKey, model }), provider: 'anthropic', model, source: 'environment' }
        : null;
    this.resolved = { at: Date.now(), value };
    return value;
  }

  private async stored(): Promise<(AiSettings & { updatedAt: Date; updatedBy?: { id: string; name: string } }) | null> {
    const doc = await Setting.findById(SETTING_ID).lean();
    const v = doc?.value as Partial<AiSettings> | undefined;
    if (!doc || !v?.apiKey || !v.model || !v.provider || !Object.prototype.hasOwnProperty.call(AI_PROVIDERS, v.provider)) {
      return null;
    }
    return {
      provider: v.provider as AiProvider,
      apiKey: v.apiKey,
      model: v.model,
      baseUrl: v.baseUrl,
      updatedAt: doc.updatedAt,
      ...(doc.updatedBy ? { updatedBy: doc.updatedBy } : {}),
    };
  }

  async status(): Promise<AiStatus> {
    const r = await this.resolve();
    return {
      enabled: r !== null,
      provider: r?.provider ?? null,
      providerName: r ? AI_PROVIDERS[r.provider].name : null,
      model: r?.model ?? null,
      dailyLimit: this.deps.config.ai.dailyLimit,
    };
  }

  async describe() {
    const stored = await this.stored();
    const r = await this.resolve();
    const key = stored?.apiKey ?? this.deps.config.ai.apiKey ?? null;
    return {
      configured: r !== null,
      source: r?.source ?? null,
      provider: r?.provider ?? null,
      model: r?.model ?? null,
      baseUrl: stored?.baseUrl ?? null,
      keyHint: key ? `...${key.slice(-4)}` : null,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy?.name ?? null,
      providers: Object.entries(AI_PROVIDERS).map(([id, p]) => ({ id: id as AiProvider, ...p })),
    };
  }

  async listModels(): Promise<AiModelInfo[]> {
    const r = await this.resolve();
    if (!r) throw new ApiError(503, 'AI_NOT_CONFIGURED', 'Add an AI key first.');
    try {
      return (await r.client.listModels?.()) ?? [];
    } catch (err) {
      throw this.toApiError(err);
    }
  }

  async saveSettings(
    input: {
      provider: AiProvider;
      apiKey?: string | undefined;
      model?: string | undefined;
      baseUrl?: string | undefined;
      preferFree?: boolean | undefined;
      autoDetect?: boolean | undefined;
    },
    actor: Principal,
  ) {
    const current = await this.stored();
    const sameProvider = current?.provider === input.provider ? current : null;
    const apiKey = input.apiKey?.trim() || sameProvider?.apiKey;
    if (!apiKey) throw new ApiError(400, 'VALIDATION_ERROR', 'Paste an API key.');

    const meta = AI_PROVIDERS[input.provider] ?? AI_PROVIDERS.gemini;
    const baseUrl = input.baseUrl?.trim() || sameProvider?.baseUrl || meta.defaultBaseUrl;

    const probe = this.factory({
      provider: input.provider,
      apiKey,
      model: input.model ?? sameProvider?.model ?? meta.defaultModel,
      baseUrl,
    });

    let models: AiModelInfo[];
    try {
      models = (await probe.listModels?.()) ?? [];
    } catch (err) {
      const kind = err instanceof AiClientError ? err.kind : 'failed';
      this.deps.logger.warn({ kind, err: (err as Error).message }, 'AI key check failed');
      if (kind === 'rejected_key') {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          `${meta.name} rejected this key. Check that you copied all of it.`,
        );
      }
      throw this.toApiError(err);
    }

    const ids = models.map((m) => m.id);

    // Auto-detect model if requested, or if no model was explicitly passed and no existing model was saved
    let model: string;
    if (input.autoDetect || (!input.model && !sameProvider?.model)) {
      model = pickBestModel(input.provider, models, Boolean(input.preferFree));
    } else {
      model =
        input.model?.trim() ||
        sameProvider?.model ||
        pickBestModel(input.provider, models, Boolean(input.preferFree));
    }

    if (ids.length > 0 && !ids.includes(model) && input.provider !== 'custom' && input.provider !== 'openrouter') {
      throw new ApiError(400, 'VALIDATION_ERROR', `The model "${model}" is not available for this key. Pick one from the list.`);
    }

    await Setting.updateOne(
      { _id: SETTING_ID },
      {
        $set: {
          value: { provider: input.provider, apiKey, model, ...(baseUrl ? { baseUrl } : {}) },
          updatedAt: new Date(),
          updatedBy: { id: actor.id, name: actor.name },
        },
      },
      { upsert: true },
    );
    this.resolved = null;
    await audit(this.deps.logger, 'settings.ai_update', actor, undefined, { provider: input.provider, model });
    return this.describe();
  }

  async removeSettings(actor: Principal) {
    await Setting.deleteOne({ _id: SETTING_ID });
    this.resolved = null;
    await audit(this.deps.logger, 'settings.ai_remove', actor);
    return this.describe();
  }

  // ---- batch summary ----

  async getBatch(batch: BatchInput, views: ItemView[]): Promise<ExplanationResult<BatchExplanation> | null> {
    const { payload } = batchEvidence(batch, views);
    return this.cached('batch', batch._id, -1, hash(payload), batchSchema);
  }

  async explainBatch(
    batch: BatchInput,
    views: ItemView[],
    actor: Principal,
    refresh = false,
  ): Promise<ExplanationResult<BatchExplanation>> {
    const { payload, top } = batchEvidence(batch, views);
    const inputHash = hash(payload);
    if (!refresh) {
      const hit = await this.cached('batch', batch._id, -1, inputHash, batchSchema);
      if (hit && !hit.stale) return hit;
    }
    const raw = await this.generate({ system: SYSTEM_PROMPT, prompt: batchPrompt(payload), schema: BATCH_SCHEMA });
    // Normalize and validate, guaranteeing strict schema compatibility across all models
    const explanation = normalizeBatchExplanation(raw.json, top);
    return this.store('batch', batch._id, -1, inputHash, explanation, raw.model, actor);
  }

  // ---- single indicator ----

  async getItem(batch: BatchInput, item: ItemView): Promise<ExplanationResult<ItemExplanation> | null> {
    const names = new Map<string, string>(batch.providers.map((p) => [p.id, p.name]));
    return this.cached('item', batch._id, item.index, hash(itemEvidence(item, names, 'full')), itemSchema);
  }

  async explainItem(batch: BatchInput, item: ItemView, actor: Principal, refresh = false): Promise<ExplanationResult<ItemExplanation>> {
    const names = new Map<string, string>(batch.providers.map((p) => [p.id, p.name]));
    const payload = itemEvidence(item, names, 'full');
    const inputHash = hash(payload);
    if (!refresh) {
      const hit = await this.cached('item', batch._id, item.index, inputHash, itemSchema);
      if (hit && !hit.stale) return hit;
    }
    const raw = await this.generate({ system: SYSTEM_PROMPT, prompt: itemPrompt(payload), schema: ITEM_SCHEMA });
    // Normalize and validate, guaranteeing strict schema compatibility across all models
    const explanation = normalizeItemExplanation(raw.json, item.value);
    return this.store('item', batch._id, item.index, inputHash, explanation, raw.model, actor);
  }

  // ---- internals ----

  private async cached<T>(
    scope: ExplanationScope,
    batchId: string,
    itemIndex: number,
    inputHash: string,
    schema: z.ZodType<T>,
  ): Promise<ExplanationResult<T> | null> {
    const doc = await AiExplanation.findOne({ batchId, scope, itemIndex }).lean();
    if (!doc) return null;
    const parsed = schema.safeParse(doc.data);
    if (!parsed.success) return null;
    return { explanation: parsed.data, model: doc.model, generatedAt: doc.createdAt, stale: doc.inputHash !== inputHash, cached: true };
  }

  private async store<T>(
    scope: ExplanationScope,
    batchId: string,
    itemIndex: number,
    inputHash: string,
    explanation: T,
    model: string,
    actor: Principal,
  ): Promise<ExplanationResult<T>> {
    const generatedAt = new Date();
    await AiExplanation.updateOne(
      { batchId, scope, itemIndex },
      { $set: { inputHash, data: explanation as Record<string, unknown>, model, createdAt: generatedAt } },
      { upsert: true },
    );
    await audit(this.deps.logger, 'ai.explain', actor, batchId, { scope, model });
    return { explanation, model, generatedAt, stale: false, cached: false };
  }

  private async generate(request: AiRequest): Promise<{ json: unknown; model: string }> {
    const resolved = await this.resolve();
    if (!resolved) {
      throw new ApiError(
        503,
        'AI_NOT_CONFIGURED',
        'Plain-English explanations are not switched on. An administrator can add an AI key under Sources.',
      );
    }
    const { dailyLimit } = this.deps.config.ai;
    if (!(await reserveRequest('ai', dailyLimit))) {
      throw new ApiError(
        429,
        'AI_LIMIT_REACHED',
        `The team has used today's ${dailyLimit} explanations. Saved explanations still open; new ones are available tomorrow (UTC).`,
      );
    }
    let result: { text: string; model: string };
    try {
      result = await resolved.client.generate(request);
    } catch (err) {
      throw this.toApiError(err);
    }
    try {
      const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      return { json: JSON.parse(cleaned), model: result.model };
    } catch {
      this.deps.logger.error({ model: result.model, text: result.text.slice(0, 500) }, 'AI returned text that is not valid JSON');
      throw new ApiError(502, 'AI_UNAVAILABLE', 'The AI gave an answer ThreatOrbit could not read. Try again.');
    }
  }

  private toApiError(err: unknown): ApiError {
    const kind = err instanceof AiClientError ? err.kind : 'failed';
    this.deps.logger.error(
      { kind, status: err instanceof AiClientError ? err.status : undefined, err: (err as Error).message },
      'AI request failed',
    );
    switch (kind) {
      case 'refused':
        return new ApiError(502, 'AI_UNAVAILABLE', 'The AI declined to explain this one. The evidence below is still accurate.');
      case 'busy':
        return new ApiError(503, 'AI_UNAVAILABLE', 'The AI service is busy right now. Try again in a minute.');
      case 'rejected_key':
        return new ApiError(502, 'AI_UNAVAILABLE', 'The AI key was rejected. An administrator can update it under Sources.');
      case 'bad_model':
        return new ApiError(
          502,
          'AI_UNAVAILABLE',
          'The selected AI model is not available. An administrator can pick another under Sources.',
        );
      case 'truncated':
        return new ApiError(502, 'AI_UNAVAILABLE', 'The AI ran out of room while writing. Try again.');
      default: {
        const detail = err instanceof AiClientError ? err.message.replace(/\s+/g, ' ').slice(0, 180) : '';
        const code = err instanceof AiClientError && err.status ? ` (HTTP ${err.status})` : '';
        return new ApiError(
          502,
          'AI_UNAVAILABLE',
          detail
            ? `The AI service had a problem${code}: ${detail}. Try again shortly.`
            : 'The AI service could not be reached. Try again shortly.',
        );
      }
    }
  }
}
