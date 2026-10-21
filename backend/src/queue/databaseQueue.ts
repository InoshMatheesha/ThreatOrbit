import type { Logger } from 'pino';
import type { ProviderId } from '../config/env.js';
import { incrementBelow } from '../lib/counter.js';
import { EnrichmentResult } from '../models/EnrichmentResult.js';
import { ProviderPause, ProviderWindow } from '../models/Throttle.js';
import type { ProviderLimits } from '../providers/types.js';
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
 * - per-provider rate limit: an atomic per-minute counter (ProviderWindow)
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

  private async drainProvider(provider: ProviderId, limits: ProviderLimits, deadline: number): Promise<number> {
    let processed = 0;
    while (Date.now() < deadline) {
      const pause = await ProviderPause.findOne({ provider }).lean();
      if (pause && pause.pausedUntil > new Date()) break;

      const now = new Date();
      const next = await EnrichmentResult.findOne(
        {
          provider,
          status: 'queued',
          $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
        },
        { _id: 1, batchId: 1, attempts: 1 },
      )
        .sort({ createdAt: 1 })
        .lean();
      if (!next) break;
      if (!(await this.reserveSlot(provider, limits.requestsPerMinute))) break;

      const outcome = await this.processor!({ resultId: String(next._id), batchId: next.batchId, provider, attempt: next.attempts + 1 });
      processed++;
      if (outcome.kind === 'retry' && outcome.pauseProviderMs) {
        await ProviderPause.updateOne(
          { provider },
          { $set: { pausedUntil: new Date(Date.now() + outcome.pauseProviderMs) } },
          { upsert: true },
        );
        break;
      }
    }
    if (processed) this.logger.debug({ provider, processed }, 'Drained lookups');
    return processed;
  }

  /** Atomically take one request slot in the provider's current one-minute window. */
  private reserveSlot(provider: ProviderId, perMinute: number): Promise<boolean> {
    const minute = Math.floor(Date.now() / 60_000);
    return incrementBelow(ProviderWindow, { provider, minute }, perMinute, { expiresAt: new Date((minute + 2) * 60_000) });
  }
}
