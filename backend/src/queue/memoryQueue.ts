import type { ProviderId } from '../config/env.js';
import type { ProviderLimits } from '../providers/types.js';
import type { LookupJob, LookupProcessor, LookupQueue } from './types.js';

interface Lane {
  limits: ProviderLimits;
  waiting: LookupJob[];
  active: number;
  /** Start times of recent requests, for the per-minute window. */
  started: number[];
  pausedUntil: number;
  timer: NodeJS.Timeout | null;
}

const WINDOW_MS = 60_000;

/**
 * DEVELOPMENT FALLBACK used when Redis is unavailable. Same semantics as the
 * BullMQ queue (per-provider rate window, concurrency, delayed retries, 429
 * pauses) but jobs live in process memory: they are lost if the server stops.
 * On restart the batch service re-enqueues unfinished lookups from MongoDB.
 */
export class MemoryLookupQueue implements LookupQueue {
  readonly mode = 'memory' as const;
  private lanes = new Map<ProviderId, Lane>();
  private delayed = new Set<{ job: LookupJob; timer: NodeJS.Timeout }>();
  private processor: LookupProcessor | null = null;
  private closed = false;
  private idleWaiters: Array<() => void> = [];

  async start(processor: LookupProcessor, limits: Map<ProviderId, ProviderLimits>) {
    this.processor = processor;
    for (const [id, l] of limits) {
      this.lanes.set(id, { limits: l, waiting: [], active: 0, started: [], pausedUntil: 0, timer: null });
    }
  }

  async enqueue(jobs: LookupJob[], delayMs = 0) {
    for (const job of jobs) {
      if (delayMs > 0) {
        const entry = {
          job,
          timer: setTimeout(() => {
            this.delayed.delete(entry);
            this.push(job);
          }, delayMs),
        };
        this.delayed.add(entry);
      } else {
        this.push(job);
      }
    }
  }

  async cancelBatch(batchId: string) {
    for (const lane of this.lanes.values()) lane.waiting = lane.waiting.filter((j) => j.batchId !== batchId);
    for (const entry of this.delayed) {
      if (entry.job.batchId === batchId) {
        clearTimeout(entry.timer);
        this.delayed.delete(entry);
      }
    }
    this.checkIdle();
  }

  async close() {
    this.closed = true;
    for (const entry of this.delayed) clearTimeout(entry.timer);
    this.delayed.clear();
    for (const lane of this.lanes.values()) if (lane.timer) clearTimeout(lane.timer);
  }

  /** Resolves when nothing is waiting, delayed or running (used by tests). */
  idle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private isIdle() {
    if (this.delayed.size) return false;
    for (const lane of this.lanes.values()) if (lane.waiting.length || lane.active) return false;
    return true;
  }

  private checkIdle() {
    if (!this.isIdle()) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private push(job: LookupJob) {
    const lane = this.lanes.get(job.provider);
    if (!lane || this.closed) return;
    lane.waiting.push(job);
    this.pump(job.provider);
  }

  private pump(provider: ProviderId) {
    const lane = this.lanes.get(provider);
    if (!lane || this.closed || !this.processor) return;
    const now = Date.now();
    lane.started = lane.started.filter((t) => now - t < WINDOW_MS);

    while (lane.waiting.length && lane.active < lane.limits.concurrency) {
      if (now < lane.pausedUntil) return this.wake(provider, lane.pausedUntil - now);
      if (lane.started.length >= lane.limits.requestsPerMinute) {
        return this.wake(provider, WINDOW_MS - (now - lane.started[0]!) + 5);
      }
      const job = lane.waiting.shift()!;
      lane.active++;
      lane.started.push(now);
      void this.run(provider, lane, job);
    }
    this.checkIdle();
  }

  private wake(provider: ProviderId, ms: number) {
    const lane = this.lanes.get(provider)!;
    if (lane.timer) return;
    lane.timer = setTimeout(() => {
      lane.timer = null;
      this.pump(provider);
    }, Math.max(ms, 10));
  }

  private async run(provider: ProviderId, lane: Lane, job: LookupJob) {
    try {
      const outcome = await this.processor!(job);
      if (outcome.kind === 'retry') {
        if (outcome.pauseProviderMs) lane.pausedUntil = Math.max(lane.pausedUntil, Date.now() + outcome.pauseProviderMs);
        await this.enqueue([{ ...job, attempt: job.attempt + 1 }], outcome.delayMs);
      }
    } catch {
      // The processor records its own failures; never let one job stop the lane.
    } finally {
      lane.active--;
      this.pump(provider);
    }
  }
}
