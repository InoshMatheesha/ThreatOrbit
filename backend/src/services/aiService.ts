import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { AiExplanation, type BatchDoc, type ExplanationScope } from '../models/index.js';
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
import { audit } from './audit.js';
import type { Principal } from './authService.js';
import { reserveRequest } from './providerUsage.js';
import type { ItemView } from './resultViews.js';

const REQUEST_TIMEOUT_MS = 40_000;
const MAX_OUTPUT_TOKENS = 4096;

export interface AiRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}

/** The only thing the service needs from a model: JSON text for a schema. Faked in tests. */
export interface AiClient {
  generate(request: AiRequest): Promise<{ text: string; model: string }>;
}

/** A failure the reader can be told about in plain words; the technical cause stays in the logs. */
export class AiClientError extends Error {
  constructor(
    readonly kind: 'refused' | 'busy' | 'rejected_key' | 'truncated' | 'failed',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}

export function createAnthropicClient(config: AppConfig['ai']): AiClient {
  const client = new Anthropic({ apiKey: config.apiKey ?? '', timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
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

interface Deps {
  config: AppConfig;
  logger: Logger;
  /** Defaults to Anthropic when an API key is configured. */
  client?: AiClient;
}

type BatchInput = Pick<BatchDoc, '_id' | 'totals' | 'counters' | 'providers'>;

export class AiService {
  private readonly client: AiClient | null;

  constructor(private readonly deps: Deps) {
    this.client = deps.client ?? (deps.config.ai.apiKey ? createAnthropicClient(deps.config.ai) : null);
  }

  get enabled() {
    return this.client !== null;
  }

  get info() {
    const { model, dailyLimit } = this.deps.config.ai;
    return { enabled: this.enabled, model, dailyLimit };
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
    if (!this.client) {
      throw new ApiError(
        503,
        'AI_NOT_CONFIGURED',
        'Plain-English explanations are not switched on. An administrator needs to add ANTHROPIC_API_KEY.',
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
      result = await this.client.generate(request);
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
        return new ApiError(502, 'AI_UNAVAILABLE', "The server's AI key was rejected. An administrator should check ANTHROPIC_API_KEY.");
      case 'truncated':
        return new ApiError(502, 'AI_UNAVAILABLE', 'The AI ran out of room while writing. Try again.');
      default:
        return new ApiError(502, 'AI_UNAVAILABLE', 'The AI service could not be reached. Try again shortly.');
    }
  }
}
