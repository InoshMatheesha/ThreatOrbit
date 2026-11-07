import type { Logger } from 'pino';
import type { ProviderId } from '../config/env.js';
import { EnrichmentResult } from '../models/EnrichmentResult.js';
import { ProviderPause } from '../models/Throttle.js';
import type { ProviderLimits } from '../providers/types.js';
import { reserveMinuteSlot } from '../services/providerUsage.js';
import type { DrainResult, LookupJob, LookupProcessor, LookupQueue } from './types.js';

/** A lookup marked running for longer than this was cut off (instance frozen or killed). */
const STALE_RUNNING_MS = 3 * 60_000;

/**
 * Queue for serverless hosting (e.g. Vercel), where there is no long-running
 * worker. Lookups already live in MongoDB as `queued` results; `drain()` is
 * called by short requests (the open dashboard, or an external scheduler) and
 * processes due lookups for a limited time.
 *
 * Coordination between concurrent function instances happens in MongoDB:
 * - per-provider rate limit: an atomic per-minute counter (ProviderWindow); each pooled
 *   API key also has its own window, enforced when the processor takes a key
 * - parallelism: one worker per API key (limits.concurrency)
 * - HTTP 429 back-off: a shared pause (ProviderPause)
 * - retries: `nextAttemptAt` on the result, set by the processor
 * - double processing: prevented by the processor's atomic queued -> running claim
 */
export class DatabaseLookupQueue implements LookupQueue {
  readonly mode = 'database' as const;
  private processor: LookupProcessor | null = null;
  private limits = new Map<ProviderId, ProviderLimits>();

  /**
   * New lookups start only within the budget passed to drain(); one started near the end
   * can take up to the provider timeout, so the host's function limit must exceed
   * budget + timeout (see serverless.ts).
   */
  constructor(private readonly logger: Logger) {}

  async start(processor: LookupProcessor, limits: Map<ProviderId, ProviderLimits>) {
    this.processor = processor;
    this.limits = limits;
  }

  /** Jobs are the queued results themselves; nothing to push. Retries carry their own nextAttemptAt. */
  async enqueue(_jobs: LookupJob[], _delayMs?: number) {}

  /** Queued lookups of a cancelled batch are marked cancelled by the service, so nothing to remove. */
  async cancelBatch(_batchId: string) {}

  async close() {}

  async drain(budgetMs: number): Promise<DrainResult> {
    const deadline = Date.now() + budgetMs;
    await EnrichmentResult.updateMany(
      { status: 'running', updatedAt: { $lt: new Date(Date.now() - STALE_RUNNING_MS) } },
      { $set: { status: 'queued' } },
    );

    const counts = await Promise.all([...this.limits].map(([provider, limits]) => this.drainProvider(provider, limits, deadline)));
    const pending = await EnrichmentResult.countDocuments({ status: { $in: ['queued', 'running'] } });
    return { processed: counts.reduce((a, b) => a + b, 0), pending };
  }

  updateLimits(limits: Map<ProviderId, ProviderLimits>) {
    this.limits = new Map(limits);
  }

  /**
   * Run up to `concurrency` workers for one provider (one per API key in the pool).
   * Picking the next lookup is serialized within this instance and in-flight lookups are
   * excluded, so workers never race for the same row or waste a rate-limit slot on it.
   * Across instances the processor's atomic claim still prevents double processing.
   */
  private async drainProvider(provider: ProviderId, limits: ProviderLimits, deadline: number): Promise<number> {
    const concurrency = Math.max(1, limits.concurrency);
    const inFlight = new Set<string>();
    let stopped = false;
    let picking: Promise<unknown> = Promise.resolve();

    const pickNext = async (): Promise<LookupJob | null> => {
      if (stopped || Date.now() >= deadline) return null;
      const pause = await ProviderPause.findOne({ provider }).lean();
      if (pause && pause.pausedUntil > new Date()) {
        stopped = true;
        return null;
      }
      const now = new Date();
      const next = await EnrichmentResult.findOne(
        {
          provider,
          status: 'queued',
          ...(inFlight.size ? { _id: { $nin: [...inFlight] } } : {}),
          $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
        },
        { _id: 1, batchId: 1, attempts: 1 },
      )
        .sort({ createdAt: 1 })
        .lean();
      if (!next) return null;
      if (!(await reserveMinuteSlot(provider, limits.requestsPerMinute))) {
        stopped = true;
        return null;
      }
      const resultId = String(next._id);
      inFlight.add(resultId);
      return { resultId, batchId: next.batchId, provider, attempt: next.attempts + 1 };
    };

    const worker = async (): Promise<number> => {
      let count = 0;
      while (!stopped) {
        const turn = picking.then(pickNext);
        picking = turn.catch(() => null);
        const job = await turn;
        if (!job) break;
        try {
          const outcome = await this.processor!(job);
          count++;
          if (outcome.kind === 'retry' && outcome.pauseProviderMs) {
            stopped = true;
            await ProviderPause.updateOne(
              { provider },
              { $set: { pausedUntil: new Date(Date.now() + outcome.pauseProviderMs) } },
              { upsert: true },
            );
          }
        } finally {
          inFlight.delete(job.resultId);
        }
      }
      return count;
    };

    const counts = await Promise.all(Array.from({ length: concurrency }, worker));
    const processed = counts.reduce((a, b) => a + b, 0);
    if (processed) this.logger.debug({ provider, processed, workers: concurrency }, 'Drained lookups');
    return processed;
  }
}
