import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { ProviderId } from '../config/env.js';
import type { ProviderLimits } from '../providers/types.js';
import type { LookupJob, LookupProcessor, LookupQueue } from './types.js';

const DEFAULT_PREFIX = 'tih';

/**
 * Production queue: one BullMQ queue + worker per provider, so each provider has
 * an independent rate limiter (limiter.max per minute) and concurrency. Jobs
 * survive restarts in Redis. Retries are re-added as new delayed jobs whose id
 * includes the attempt number, which also makes re-enqueueing idempotent.
 */
export class BullMqLookupQueue implements LookupQueue {
  readonly mode = 'bullmq' as const;
  private queues = new Map<ProviderId, Queue<LookupJob>>();
  private workers: Worker<LookupJob>[] = [];
  private connections: Redis[] = [];

  constructor(
    private readonly redisUrl: string,
    private readonly logger: Logger,
    private readonly prefix = DEFAULT_PREFIX,
  ) {}

  private connection(): Redis {
    const c = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    this.connections.push(c);
    return c;
  }

  async start(processor: LookupProcessor, limits: Map<ProviderId, ProviderLimits>) {
    for (const [provider, l] of limits) {
      const name = `lookups-${provider}`;
      const queue = new Queue<LookupJob>(name, { connection: this.connection(), prefix: this.prefix });
      this.queues.set(provider, queue);
      const worker = new Worker<LookupJob>(
        name,
        async (job: Job<LookupJob>) => {
          const outcome = await processor(job.data);
          if (outcome.kind === 'retry') {
            if (outcome.pauseProviderMs) await queue.rateLimit(outcome.pauseProviderMs);
            await this.enqueue([{ ...job.data, attempt: job.data.attempt + 1 }], outcome.delayMs);
          }
        },
        {
          connection: this.connection(),
          prefix: this.prefix,
          concurrency: l.concurrency,
          limiter: { max: l.requestsPerMinute, duration: 60_000 },
        },
      );
      worker.on('error', (err) => this.logger.error({ provider, err: err.message }, 'Queue worker error'));
      this.workers.push(worker);
    }
  }

  async enqueue(jobs: LookupJob[], delayMs = 0) {
    const byProvider = new Map<ProviderId, LookupJob[]>();
    for (const j of jobs) byProvider.set(j.provider, [...(byProvider.get(j.provider) ?? []), j]);
    for (const [provider, list] of byProvider) {
      const queue = this.queues.get(provider);
      if (!queue) continue;
      await queue.addBulk(
        list.map((data) => ({
          name: 'lookup',
          data,
          opts: { jobId: `${data.resultId}-${data.attempt}`, delay: delayMs, removeOnComplete: true, removeOnFail: 1000 },
        })),
      );
    }
  }

  async cancelBatch(batchId: string) {
    for (const queue of this.queues.values()) {
      const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
      await Promise.all(jobs.filter((j) => j?.data?.batchId === batchId).map((j) => j.remove().catch(() => {})));
    }
  }

  /** Remove every queue and its jobs (tests and "delete all history"). */
  async obliterate() {
    await Promise.all([...this.queues.values()].map((q) => q.obliterate({ force: true })));
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await Promise.all(this.connections.map((c) => c.quit().catch(() => {})));
  }
}

/** True when Redis answers PING within the timeout. */
export async function redisAvailable(url: string, timeoutMs = 1500): Promise<boolean> {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null, connectTimeout: timeoutMs });
  client.on('error', () => {});
  try {
    await client.connect();
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}
