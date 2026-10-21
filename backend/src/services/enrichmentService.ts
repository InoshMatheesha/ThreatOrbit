import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import type { Logger } from 'pino';
import type { AppConfig, ProviderId } from '../config/env.js';
import type { RiskRules } from '../config/riskRules.js';
import { ApiError } from '../lib/errors.js';
import {
  AuditEvent,
  Batch,
  EnrichmentResult,
  Indicator,
  ProviderUsage,
  TERMINAL_BATCH_STATUSES,
  type BatchDoc,
  type BatchItem,
  type BatchStatus,
  type EnrichmentResultDoc,
  type LookupCounters,
  type ProviderSnapshot,
} from '../models/index.js';
import type { ParseResult } from '../parser/types.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { isRetryableKind, ProviderError, type ErrorKind, type ProviderFinding } from '../providers/types.js';
import type { LookupJob, LookupQueue, ProcessOutcome } from '../queue/types.js';
import { audit } from './audit.js';
import { reserveRequest } from './providerUsage.js';

/** A 429 asking us to wait longer than this is a quota, not a burst limit. */
const QUOTA_RETRY_AFTER_MS = 10 * 60_000;
const MAX_BACKOFF_MS = 60_000;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const SWEEP_INTERVAL_MS = 30_000;
const RETENTION_INTERVAL_MS = 60 * 60_000;
const MAX_LINES_PER_ITEM = 100;
const MAX_ORIGINALS_PER_ITEM = 20;
const NOT_RETRYABLE_BY_USER: ReadonlySet<ErrorKind> = new Set(['invalid_request']);

export interface CreateBatchOptions {
  sessionId: string;
  demo: boolean;
  label?: string;
  source: BatchDoc['source'];
}

export interface EnrichmentDeps {
  config: AppConfig;
  logger: Logger;
  registry: ProviderRegistry;
  queue: LookupQueue;
  rules: RiskRules;
}

function findingFields(f: ProviderFinding) {
  return {
    outcome: f.outcome,
    verdict: f.verdict,
    summary: f.summary,
    metrics: f.metrics,
    tags: f.tags,
    references: f.references,
    ...(f.detections ? { detections: f.detections } : {}),
    ...(f.abuseConfidence !== undefined ? { abuseConfidence: f.abuseConfidence } : {}),
    ...(f.permalink ? { permalink: f.permalink } : {}),
  };
}

export class EnrichmentService {
  private refreshChains = new Map<string, Promise<void>>();
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly deps: EnrichmentDeps) {}

  get queueMode() {
    return this.deps.queue.mode;
  }

  get rules() {
    return this.deps.rules;
  }

  get registry() {
    return this.deps.registry;
  }

  async start({ background = true } = {}) {
    const limits = new Map(this.deps.registry.all().map((r) => [r.adapter.id, r.limits]));
    await this.deps.queue.start((job) => this.processLookup(job), limits);
    await this.recoverInterrupted();
    if (background) {
      this.timers.push(setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS).unref());
      this.timers.push(setInterval(() => void this.purgeExpired(), RETENTION_INTERVAL_MS).unref());
      void this.purgeExpired();
    }
  }

  async stop() {
    for (const t of this.timers) clearInterval(t);
    await this.deps.queue.close();
  }

  // ---------------------------------------------------------------- batches

  snapshotProviders(demo: boolean): ProviderSnapshot[] {
    return this.deps.registry
      .all()
      .filter((r) => Boolean(r.adapter.synthetic) === demo)
      .map((r) => ({
        id: r.adapter.id,
        name: r.adapter.name,
        state: r.state,
        supports: [...r.adapter.supports],
        synthetic: Boolean(r.adapter.synthetic),
        requestsPerMinute: r.limits.requestsPerMinute,
      }));
  }

  async createBatch(parsed: ParseResult, opts: CreateBatchOptions): Promise<BatchDoc> {
    const { config, registry, queue, logger } = this.deps;
    const providers = registry.forBatch(opts.demo);
    if (providers.length === 0) {
      throw new ApiError(
        409,
        'NO_PROVIDERS_CONFIGURED',
        'No threat intel provider is configured. Add API keys to backend/.env and restart, or run the batch in demo mode.',
      );
    }

    const items: BatchItem[] = parsed.indicators.map((ind, index) => ({
      index,
      value: ind.value,
      type: ind.type,
      ...(ind.display ? { display: ind.display } : {}),
      lines: ind.lines.slice(0, MAX_LINES_PER_ITEM),
      originals: ind.originals.slice(0, MAX_ORIGINALS_PER_ITEM),
      lookupEligible: ind.lookupEligible,
      notes: ind.notes,
    }));
    const eligible = items.filter((i) => i.lookupEligible);
    if (eligible.length === 0) {
      throw new ApiError(400, 'NOTHING_TO_ENRICH', 'The input has no indicators that can be sent to providers');
    }
    if (eligible.length > config.limits.maxBatchSize) {
      throw new ApiError(
        413,
        'BATCH_TOO_LARGE',
        `${eligible.length} indicators exceed the batch limit of ${config.limits.maxBatchSize}. Split the input into smaller batches.`,
        { eligible: eligible.length, maxBatchSize: config.limits.maxBatchSize },
      );
    }

    const batchId = randomUUID();
    const now = new Date();

    // Reuse fresh results instead of calling providers again (cache).
    const docs: Array<Partial<EnrichmentResultDoc>> = [];
    let cachedCount = 0;
    for (const runtime of providers) {
      const id = runtime.adapter.id;
      const targets = eligible.filter((i) => runtime.adapter.supports.includes(i.type));
      if (!targets.length) continue;
      const fresh = await EnrichmentResult.find({
        provider: id,
        status: 'completed',
        synthetic: opts.demo,
        expiresAt: { $gt: now },
        value: { $in: targets.map((t) => t.value) },
      })
        .sort({ lookedUpAt: -1 })
        .lean();
      const cache = new Map<string, EnrichmentResultDoc>();
      for (const r of fresh) if (!cache.has(`${r.type}:${r.value}`)) cache.set(`${r.type}:${r.value}`, r);

      for (const item of targets) {
        const base = { batchId, itemIndex: item.index, type: item.type, value: item.value, provider: id, synthetic: opts.demo };
        const hit = cache.get(`${item.type}:${item.value}`);
        if (hit) {
          cachedCount++;
          docs.push({
            ...base,
            status: 'completed',
            attempts: 0,
            outcome: hit.outcome,
            verdict: hit.verdict,
            summary: hit.summary,
            metrics: hit.metrics,
            tags: hit.tags,
            references: hit.references,
            ...(hit.detections ? { detections: hit.detections } : {}),
            ...(hit.abuseConfidence !== undefined ? { abuseConfidence: hit.abuseConfidence } : {}),
            ...(hit.permalink ? { permalink: hit.permalink } : {}),
            lookedUpAt: hit.lookedUpAt,
            expiresAt: hit.expiresAt,
            cacheStatus: 'hit',
            cachedFromId: hit._id,
          });
        } else {
          docs.push({ ...base, status: 'queued', attempts: 0 });
        }
      }
    }

    const batch = await Batch.create({
      _id: batchId,
      ...(opts.label ? { label: opts.label } : {}),
      status: 'queued',
      demo: opts.demo,
      mode: parsed.mode,
      source: opts.source,
      sessionId: opts.sessionId,
      totals: {
        indicators: items.length,
        eligible: eligible.length,
        ineligible: items.length - eligible.length,
        invalid: parsed.stats.invalid,
        duplicates: parsed.stats.duplicates,
      },
      counters: { total: docs.length, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, cached: 0 },
      providers: this.snapshotProviders(opts.demo),
      items,
    });

    const inserted = docs.length ? await EnrichmentResult.insertMany(docs) : [];
    await Indicator.bulkWrite(
      items.map((i) => ({
        updateOne: {
          filter: { type: i.type, value: i.value },
          update: { $setOnInsert: { firstSeenAt: now }, $set: { lastSeenAt: now }, $inc: { submissions: 1 } },
          upsert: true,
        },
      })),
    );

    const jobs: LookupJob[] = inserted
      .filter((r) => r.status === 'queued')
      .map((r) => ({ resultId: String(r._id), batchId, provider: r.provider as ProviderId, attempt: 1 }));
    await queue.enqueue(jobs);
    await this.refreshBatch(batchId);

    await audit(logger, 'batch.create', opts.sessionId, batchId, {
      indicators: items.length,
      eligible: eligible.length,
      lookups: docs.length,
      cached: cachedCount,
      demo: opts.demo,
      providers: providers.map((p) => p.adapter.id).join(','),
    });
    return (await Batch.findById(batchId).lean())!;
  }

  /** Recompute counters from the lookups and derive the batch status. Serialized per batch. */
  refreshBatch(batchId: string): Promise<void> {
    const previous = this.refreshChains.get(batchId) ?? Promise.resolve();
    const next = previous.then(() => this.doRefresh(batchId)).catch((err) => {
      this.deps.logger.error({ batchId, err: (err as Error).message }, 'Failed to refresh batch');
    });
    this.refreshChains.set(batchId, next);
    void next.finally(() => {
      if (this.refreshChains.get(batchId) === next) this.refreshChains.delete(batchId);
    });
    return next;
  }

  private async doRefresh(batchId: string) {
    const rows = await EnrichmentResult.aggregate<{ _id: string; n: number; cached: number; attempted: number }>([
      { $match: { batchId } },
      {
        $group: {
          _id: '$status',
          n: { $sum: 1 },
          cached: { $sum: { $cond: [{ $eq: ['$cacheStatus', 'hit'] }, 1, 0] } },
          attempted: { $sum: { $cond: [{ $gt: ['$attempts', 0] }, 1, 0] } },
        },
      },
    ]);
    let attempted = 0;
    const counters: LookupCounters = { total: 0, queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, cached: 0 };
    for (const r of rows) {
      counters.total += r.n;
      counters.cached += r.cached;
      attempted += r.attempted;
      if (r._id in counters) counters[r._id as keyof Omit<LookupCounters, 'total' | 'cached'>] = r.n;
    }

    const batch = await Batch.findById(batchId, { status: 1, completedAt: 1 }).lean();
    if (!batch) return;
    const active = counters.queued + counters.running;
    let status: BatchStatus;
    if (batch.status === 'cancelling' || batch.status === 'cancelled') {
      status = active === 0 ? 'cancelled' : 'cancelling';
    } else if (active > 0) {
      // Anything already attempted (including lookups waiting to retry) means the batch is running.
      status = counters.running > 0 || counters.completed + counters.failed > 0 || attempted > 0 ? 'running' : 'queued';
    } else {
      status = counters.failed > 0 ? 'completed_with_errors' : 'completed';
    }

    const terminal = TERMINAL_BATCH_STATUSES.has(status);
    await Batch.updateOne(
      { _id: batchId },
      terminal
        ? { $set: { counters, status, ...(batch.completedAt ? {} : { completedAt: new Date() }) } }
        : { $set: { counters, status }, $unset: { completedAt: 1 } },
    );
  }

  async cancelBatch(batchId: string, sessionId: string) {
    const batch = await this.requireBatch(batchId);
    if (TERMINAL_BATCH_STATUSES.has(batch.status) || batch.status === 'cancelling') {
      throw new ApiError(409, 'BATCH_NOT_ACTIVE', `Batch is already ${batch.status.replaceAll('_', ' ')}`);
    }
    await Batch.updateOne({ _id: batchId }, { $set: { status: 'cancelling', cancelledAt: new Date() } });
    const { modifiedCount } = await EnrichmentResult.updateMany({ batchId, status: 'queued' }, { $set: { status: 'cancelled' } });
    await this.deps.queue.cancelBatch(batchId);
    await this.refreshBatch(batchId);
    await audit(this.deps.logger, 'batch.cancel', sessionId, batchId, { cancelledLookups: modifiedCount });
  }

  async deleteBatch(batchId: string, sessionId: string) {
    await this.requireBatch(batchId);
    await this.deps.queue.cancelBatch(batchId);
    const { deletedCount } = await EnrichmentResult.deleteMany({ batchId });
    await Batch.deleteOne({ _id: batchId });
    await audit(this.deps.logger, 'batch.delete', sessionId, batchId, { lookupsDeleted: deletedCount });
  }

  async deleteAllHistory(sessionId: string) {
    const ids = await Batch.distinct('_id');
    for (const id of ids) await this.deps.queue.cancelBatch(String(id));
    const [batches, results, indicators] = await Promise.all([
      Batch.deleteMany({}),
      EnrichmentResult.deleteMany({}),
      Indicator.deleteMany({}),
    ]);
    await audit(this.deps.logger, 'history.delete_all', sessionId, undefined, {
      batches: batches.deletedCount,
      lookups: results.deletedCount,
      indicators: indicators.deletedCount,
    });
    return { batches: batches.deletedCount, lookups: results.deletedCount, indicators: indicators.deletedCount };
  }

  async retryResult(resultId: string, sessionId: string) {
    const result = await EnrichmentResult.findById(resultId).lean();
    if (!result) throw new ApiError(404, 'NOT_FOUND', 'Lookup not found');
    this.assertRetryable(result);
    const batch = await this.requireBatch(result.batchId);
    if (batch.status === 'cancelled' || batch.status === 'cancelling') {
      throw new ApiError(409, 'BATCH_NOT_ACTIVE', 'Cannot retry lookups in a cancelled batch');
    }
    await this.requeue([result]);
    await audit(this.deps.logger, 'result.retry', sessionId, result.batchId, { provider: result.provider });
  }

  async retryFailed(batchId: string, sessionId: string) {
    const batch = await this.requireBatch(batchId);
    if (batch.status === 'cancelled' || batch.status === 'cancelling') {
      throw new ApiError(409, 'BATCH_NOT_ACTIVE', 'Cannot retry lookups in a cancelled batch');
    }
    const failed = await EnrichmentResult.find({ batchId, status: 'failed', 'error.kind': { $nin: [...NOT_RETRYABLE_BY_USER] } }).lean();
    if (!failed.length) throw new ApiError(409, 'NOTHING_TO_RETRY', 'No failed lookups are eligible for retry');
    await this.requeue(failed);
    await audit(this.deps.logger, 'batch.retry_failed', sessionId, batchId, { lookups: failed.length });
    return failed.length;
  }

  private assertRetryable(result: Pick<EnrichmentResultDoc, 'status' | 'error'>) {
    if (result.status !== 'failed') {
      throw new ApiError(409, 'NOT_RETRYABLE', `Only failed lookups can be retried (this one is ${result.status})`);
    }
    if (result.error && NOT_RETRYABLE_BY_USER.has(result.error.kind)) {
      throw new ApiError(409, 'NOT_RETRYABLE', 'The provider rejected this request as invalid; retrying would fail the same way');
    }
  }

  private async requeue(results: Array<Pick<EnrichmentResultDoc, '_id' | 'batchId' | 'provider'>>) {
    const ids = results.map((r) => r._id);
    await EnrichmentResult.updateMany({ _id: { $in: ids }, status: 'failed' }, { $set: { status: 'queued', attempts: 0 }, $unset: { error: 1 } });
    await this.deps.queue.enqueue(results.map((r) => ({ resultId: String(r._id), batchId: r.batchId, provider: r.provider, attempt: 1 })));
    for (const batchId of new Set(results.map((r) => r.batchId))) await this.refreshBatch(batchId);
  }

  private async requireBatch(batchId: string) {
    const batch = await Batch.findById(batchId, { status: 1 }).lean();
    if (!batch) throw new ApiError(404, 'NOT_FOUND', 'Batch not found');
    return batch;
  }

  // ---------------------------------------------------------------- processing

  /** Run one provider lookup. Never throws: every outcome is recorded on the result. */
  async processLookup(job: LookupJob): Promise<ProcessOutcome> {
    const { registry, config, logger } = this.deps;
    // Atomically claim the lookup so a duplicate job can never call the provider twice.
    const claimed = await EnrichmentResult.findOneAndUpdate(
      { _id: job.resultId, status: 'queued' },
      { $set: { status: 'running' }, $inc: { attempts: 1 } },
      { new: true },
    ).lean();
    if (!claimed) return { kind: 'done' };

    try {
      const batch = await Batch.findById(job.batchId, { status: 1 }).lean();
      if (!batch || batch.status === 'cancelling' || batch.status === 'cancelled') {
        await EnrichmentResult.updateOne({ _id: claimed._id }, { $set: { status: 'cancelled' } });
        return { kind: 'done' };
      }

      const runtime = registry.get(job.provider);
      if (runtime.state !== 'ready' || !runtime.apiKey) {
        await this.fail(claimed._id, 'auth', `${runtime.adapter.name} is ${runtime.state}; add its API key and retry`);
        return { kind: 'done' };
      }
      if (!(await reserveRequest(job.provider, runtime.limits.dailyLimit))) {
        await this.fail(
          claimed._id,
          'quota_exhausted',
          `Daily quota of ${runtime.limits.dailyLimit} ${runtime.adapter.name} requests used up; it resets at 00:00 UTC. Retry then.`,
        );
        return { kind: 'done' };
      }

      try {
        const finding = await runtime.adapter.lookup(
          { value: claimed.value, type: claimed.type },
          { apiKey: runtime.apiKey, http: runtime.http },
        );
        const now = new Date();
        await EnrichmentResult.updateOne(
          { _id: claimed._id, status: 'running' },
          {
            $set: {
              status: 'completed',
              ...findingFields(finding),
              lookedUpAt: now,
              expiresAt: new Date(now.getTime() + config.enrichment.cacheTtlMs),
              cacheStatus: 'miss',
            },
            $unset: { error: 1 },
          },
        );
        return { kind: 'done' };
      } catch (err) {
        const e =
          err instanceof ProviderError ? err : new ProviderError('provider_error', `Unexpected error: ${(err as Error).message}`);
        let kind = e.kind;
        const retryAfter = e.options.retryAfterMs;
        if (kind === 'rate_limited' && retryAfter !== undefined && retryAfter > QUOTA_RETRY_AFTER_MS) kind = 'quota_exhausted';

        if (isRetryableKind(kind) && claimed.attempts < config.enrichment.maxAttempts) {
          const delayMs = kind === 'rate_limited' ? (retryAfter ?? DEFAULT_RATE_LIMIT_WAIT_MS) : this.backoff(claimed.attempts);
          await EnrichmentResult.updateOne(
            { _id: claimed._id, status: 'running' },
            { $set: { status: 'queued', error: { kind, message: `${e.message}; retrying`, at: new Date(), ...(e.options.httpStatus ? { httpStatus: e.options.httpStatus } : {}) } } },
          );
          logger.warn({ provider: job.provider, kind, attempt: claimed.attempts, delayMs }, 'Lookup will be retried');
          return { kind: 'retry', delayMs, ...(kind === 'rate_limited' ? { pauseProviderMs: delayMs } : {}) };
        }
        await this.fail(claimed._id, kind, e.message, e.options.httpStatus);
        return { kind: 'done' };
      }
    } catch (err) {
      // Database or programming error: record it so the batch can still finish.
      logger.error({ provider: job.provider, err: (err as Error).message }, 'Lookup processing failed');
      await this.fail(claimed._id, 'provider_error', 'Internal error while processing this lookup').catch(() => {});
      return { kind: 'done' };
    } finally {
      await this.refreshBatch(job.batchId);
    }
  }

  private backoff(attempt: number): number {
    const base = this.deps.config.enrichment.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1);
    return Math.round(Math.min(base, MAX_BACKOFF_MS) * (0.75 + Math.random() * 0.5));
  }

  private async fail(id: Types.ObjectId, kind: ErrorKind, message: string, httpStatus?: number) {
    await EnrichmentResult.updateOne(
      { _id: id },
      { $set: { status: 'failed', error: { kind, message, at: new Date(), ...(httpStatus ? { httpStatus } : {}) } } },
    );
  }

  // ---------------------------------------------------------------- maintenance

  /** After a restart: resume lookups that were queued or cut off mid-request. */
  async recoverInterrupted() {
    await EnrichmentResult.updateMany({ status: 'running' }, { $set: { status: 'queued' } });
    const active = await Batch.find({ status: { $in: ['queued', 'running', 'cancelling'] } }, { _id: 1, status: 1 }).lean();
    for (const batch of active) {
      if (batch.status === 'cancelling') {
        await EnrichmentResult.updateMany({ batchId: batch._id, status: 'queued' }, { $set: { status: 'cancelled' } });
      } else {
        const pending = await EnrichmentResult.find({ batchId: batch._id, status: 'queued' }, { _id: 1, provider: 1, attempts: 1 }).lean();
        await this.deps.queue.enqueue(
          pending.map((r) => ({ resultId: String(r._id), batchId: batch._id, provider: r.provider, attempt: r.attempts + 1 })),
        );
        if (pending.length) this.deps.logger.info({ batchId: batch._id, lookups: pending.length }, 'Resumed unfinished lookups');
      }
      await this.refreshBatch(batch._id);
    }
  }

  /** Safety net: re-derive status for every active batch. */
  async sweep() {
    const active = await Batch.find({ status: { $in: ['queued', 'running', 'cancelling'] } }, { _id: 1 }).lean();
    for (const b of active) await this.refreshBatch(b._id);
  }

  async purgeExpired(now = new Date()) {
    const { days, auditDays } = this.deps.config.retention;
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    try {
      const old = await Batch.find({ createdAt: { $lt: cutoff } }, { _id: 1 }).lean();
      const ids = old.map((b) => b._id);
      for (const id of ids) await this.deps.queue.cancelBatch(id);
      const [results, batches, indicators, auditEvents] = await Promise.all([
        EnrichmentResult.deleteMany({ $or: [{ batchId: { $in: ids } }, { createdAt: { $lt: cutoff } }] }),
        Batch.deleteMany({ _id: { $in: ids } }),
        Indicator.deleteMany({ lastSeenAt: { $lt: cutoff } }),
        AuditEvent.deleteMany({ at: { $lt: new Date(now.getTime() - auditDays * 86_400_000) } }),
        ProviderUsage.deleteMany({ day: { $lt: new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10) } }),
      ]);
      if (batches.deletedCount || results.deletedCount || indicators.deletedCount) {
        await audit(this.deps.logger, 'retention.purge', 'system', undefined, {
          batches: batches.deletedCount,
          lookups: results.deletedCount,
          indicators: indicators.deletedCount,
          auditEvents: auditEvents.deletedCount,
          retentionDays: days,
        });
      }
      return { batches: batches.deletedCount, lookups: results.deletedCount, indicators: indicators.deletedCount };
    } catch (err) {
      this.deps.logger.error({ err: (err as Error).message }, 'Retention purge failed');
      return { batches: 0, lookups: 0, indicators: 0 };
    }
  }

  /** Make one real request with a harmless indicator to check the key works. */
  async testProvider(id: ProviderId, sessionId: string) {
    const runtime = this.deps.registry.get(id);
    if (runtime.state !== 'ready' || !runtime.apiKey) {
      return { ok: false, state: runtime.state, message: `${runtime.adapter.name} is ${runtime.state}` };
    }
    if (!(await reserveRequest(id, runtime.limits.dailyLimit))) {
      return { ok: false, state: runtime.state, message: 'Daily quota used up' };
    }
    const started = Date.now();
    try {
      const finding = await runtime.adapter.lookup(runtime.adapter.probe, { apiKey: runtime.apiKey, http: runtime.http });
      await audit(this.deps.logger, 'provider.test', sessionId, undefined, { provider: id, ok: true });
      return {
        ok: true,
        state: runtime.state,
        message: `Key works. Test lookup of ${runtime.adapter.probe.value}: ${finding.summary}`,
        ms: Date.now() - started,
      };
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError('provider_error', (err as Error).message);
      await audit(this.deps.logger, 'provider.test', sessionId, undefined, { provider: id, ok: false, kind: e.kind });
      return { ok: false, state: runtime.state, kind: e.kind, message: e.message, ms: Date.now() - started };
    }
  }
}
