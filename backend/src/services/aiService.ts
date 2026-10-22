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
          // If the safety layer declines an innocent-looking indicator, retry on the server-chosen fallback model.
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
  /** The lookups changed after this was written. */
  stale: boolean;
  /** Served from the stored copy; no AI request was made. */
  cached: boolean;
}

const hash = (value: unknown) =>
  createHash('sha256')
    .update(`v${PROMPT_VERSION}:${JSON.stringify(value)}`)
    .digest('hex');

export type AiProvider = 'gemini' | 'anthropic';

export const AI_PROVIDERS: Record<AiProvider, { name: string; defaultModel: string; signupUrl: string }> = {
  gemini: { name: 'Google Gemini', defaultModel: 'gemini-2.5-flash', signupUrl: 'https://aistudio.google.com/apikey' },
  anthropic: { name: 'Anthropic Claude', defaultModel: 'claude-opus-5-5', signupUrl: 'https://console.anthropic.com/' },
};

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

export type ClientFactory = (settings: AiSettings) => AiClient;

const defaultFactory: ClientFactory = (s) => (s.provider === 'gemini' ? createGeminiClient(s) : createAnthropicClient(s));

const SETTING_ID = 'ai';
/** How long a function instance trusts what it read from the database before asking again. */
const SETTINGS_TTL_MS = 10_000;

interface Deps {
  config: AppConfig;
  logger: Logger;
  /** Use this client no matter what is stored (tests). */
  client?: AiClient;
  /** Builds a client for a provider and key. Replaced in tests. */
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

  /** The key an administrator saved, else the one from the environment. */
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
    if (!doc || !v?.apiKey || !v.model || (v.provider !== 'gemini' && v.provider !== 'anthropic')) return null;
    return {
      provider: v.provider,
      apiKey: v.apiKey,
      model: v.model,
      updatedAt: doc.updatedAt,
      ...(doc.updatedBy ? { updatedBy: doc.updatedBy } : {}),
    };
  }

  /** Safe for any signed-in user: never includes the key. */
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

  /** For administrators: how it is set up, with only the last four characters of the key. */
  async describe() {
    const stored = await this.stored();
    const r = await this.resolve();
    const key = stored?.apiKey ?? this.deps.config.ai.apiKey ?? null;
    return {
      configured: r !== null,
      source: r?.source ?? null,
      provider: r?.provider ?? null,
      model: r?.model ?? null,
      keyHint: key ? `...${key.slice(-4)}` : null,
      updatedAt: stored?.updatedAt ?? null,
      updatedBy: stored?.updatedBy?.name ?? null,
      providers: Object.entries(AI_PROVIDERS).map(([id, p]) => ({ id, ...p })),
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

  /** Check the key against the provider, then store it. Nothing is saved if the check fails. */
  async saveSettings(input: { provider: AiProvider; apiKey?: string | undefined; model?: string | undefined }, actor: Principal) {
    const current = await this.stored();
    const sameProvider = current?.provider === input.provider ? current : null;
    const apiKey = input.apiKey?.trim() || sameProvider?.apiKey;
    if (!apiKey) throw new ApiError(400, 'VALIDATION_ERROR', 'Paste an API key.');

    const probe = this.factory({ provider: input.provider, apiKey, model: input.model ?? AI_PROVIDERS[input.provider].defaultModel });
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
          `${AI_PROVIDERS[input.provider].name} rejected this key. Check that you copied all of it.`,
        );
      }
      throw this.toApiError(err);
    }

    const ids = models.map((m) => m.id);
    const model =
      input.model ??
      sameProvider?.model ??
      (input.provider === 'gemini' ? pickDefaultGeminiModel(ids) : null) ??
      AI_PROVIDERS[input.provider].defaultModel;
    if (ids.length > 0 && !ids.includes(model)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `The model "${model}" is not available for this key. Pick one from the list.`);
    }

    await Setting.updateOne(
      { _id: SETTING_ID },
      {
        $set: { value: { provider: input.provider, apiKey, model }, updatedAt: new Date(), updatedBy: { id: actor.id, name: actor.name } },
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
    const parsed = batchSchema.parse(raw.json);
    // Keep only entries for indicators that were actually sent: the model cannot add its own.
    const order = new Map(top.map((v, i) => [v.value, i]));
    const indicators = parsed.indicators.filter((i) => order.has(i.value)).sort((a, b) => order.get(a.value)! - order.get(b.value)!);
    const explanation: BatchExplanation = { ...parsed, indicators };
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
    return this.store('item', batch._id, item.index, inputHash, itemSchema.parse(raw.json), raw.model, actor);
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
      return { json: JSON.parse(result.text), model: result.model };
    } catch {
      this.deps.logger.error({ model: result.model }, 'AI returned text that is not valid JSON');
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
      default:
        return new ApiError(502, 'AI_UNAVAILABLE', 'The AI service could not be reached. Try again shortly.');
    }
  }
}
