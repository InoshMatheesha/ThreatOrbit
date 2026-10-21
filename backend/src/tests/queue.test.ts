import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderId } from '../config/env.js';
import type { ProviderLimits } from '../providers/types.js';
import { BullMqLookupQueue, redisAvailable } from '../queue/bullmqQueue.js';
import { MemoryLookupQueue } from '../queue/memoryQueue.js';
import type { LookupJob, ProcessOutcome } from '../queue/types.js';
import { silentLogger, waitFor } from './helpers.js';

const job = (n: number, provider: ProviderId = 'virustotal', batchId = 'b1'): LookupJob => ({ resultId: `r${n}`, batchId, provider, attempt: 1 });
const limits = (l: Partial<ProviderLimits>, provider: ProviderId = 'virustotal') =>
  new Map<ProviderId, ProviderLimits>([[provider, { requestsPerMinute: 100, dailyLimit: null, concurrency: 4, ...l }]]);

describe('in-memory development queue', () => {
  afterEach(() => vi.useRealTimers());

  it('never exceeds the per-minute rate limit of a provider', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const q = new MemoryLookupQueue();
    await q.start(async (j) => {
      seen.push(j.resultId);
      return { kind: 'done' };
    }, limits({ requestsPerMinute: 2 }));
    await q.enqueue([job(1), job(2), job(3)]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(seen).toEqual(['r1', 'r2']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(seen).toEqual(['r1', 'r2', 'r3']);
    await q.close();
  });

  it('limits concurrency and keeps providers independent', async () => {
    let active = 0;
    let peak = 0;
    const q = new MemoryLookupQueue();
    const both = new Map<ProviderId, ProviderLimits>([
      ['virustotal', { requestsPerMinute: 1, dailyLimit: null, concurrency: 1 }],
      ['abuseipdb', { requestsPerMinute: 100, dailyLimit: null, concurrency: 2 }],
    ]);
    const done: string[] = [];
    await q.start(async (j) => {
      if (j.provider === 'abuseipdb') {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      }
      done.push(`${j.provider}:${j.resultId}`);
      return { kind: 'done' };
    }, both);
    // VirusTotal is throttled to 1/min, which must not hold AbuseIPDB back.
    await q.enqueue([job(1), job(2), ...[3, 4, 5, 6].map((n) => job(n, 'abuseipdb'))]);
    await waitFor(() => done.filter((d) => d.startsWith('abuseipdb')).length === 4);
    expect(peak).toBe(2);
    expect(done.filter((d) => d.startsWith('virustotal'))).toEqual(['virustotal:r1']);
    await q.close();
  });

  it('pauses the whole provider after HTTP 429 and retries later', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const q = new MemoryLookupQueue();
    await q.start(async (j): Promise<ProcessOutcome> => {
      seen.push(`${j.resultId}#${j.attempt}`);
      if (j.resultId === 'r1' && j.attempt === 1) return { kind: 'retry', delayMs: 5_000, pauseProviderMs: 5_000 };
      return { kind: 'done' };
    }, limits({ concurrency: 1 }));
    await q.enqueue([job(1), job(2)]);
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(['r1#1']);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(seen).toEqual(['r1#1', 'r2#1', 'r1#2']);
    await q.close();
  });

  it('drops waiting and delayed jobs of a cancelled batch', async () => {
    const seen: string[] = [];
    const q = new MemoryLookupQueue();
    await q.start(async (j) => {
      seen.push(j.resultId);
      return { kind: 'done' };
    }, limits({ requestsPerMinute: 1 }));
    await q.enqueue([job(1), job(2, 'virustotal', 'b2')]);
    await q.enqueue([job(3)], 50);
    await q.cancelBatch('b1');
    await new Promise((r) => setTimeout(r, 80));
    expect(seen).toEqual(['r1']);
    await q.close();
  });
});

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const hasRedis = await redisAvailable(redisUrl);

describe.skipIf(!hasRedis)('BullMQ queue (Redis)', () => {
  it('processes jobs, re-adds retries as delayed jobs, and cancels by batch', async () => {
    const q = new BullMqLookupQueue(redisUrl, silentLogger, `tih-test-${randomUUID().slice(0, 8)}`);
    const seen: string[] = [];
    await q.start(async (j): Promise<ProcessOutcome> => {
      seen.push(`${j.resultId}#${j.attempt}`);
      return j.resultId === 'r1' && j.attempt === 1 ? { kind: 'retry', delayMs: 50 } : { kind: 'done' };
    }, limits({}));
    try {
      await q.enqueue([job(1), job(2)]);
      // The same job id is idempotent (safe to re-enqueue after a restart).
      await q.enqueue([job(2)]);
      await waitFor(() => seen.includes('r1#2') && seen.includes('r2#1'), 10_000);
      expect(seen.filter((s) => s.startsWith('r2'))).toEqual(['r2#1']);

      await q.enqueue([job(9, 'virustotal', 'cancel-me')], 500);
      await q.cancelBatch('cancel-me');
      await new Promise((r) => setTimeout(r, 800));
      expect(seen).not.toContain('r9#1');
    } finally {
      await q.obliterate();
      await q.close();
    }
  });
});
