import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/errors.js';
import { AuditEvent, Batch, EnrichmentResult } from '../models/index.js';
import { parseIndicators } from '../parser/index.js';
import { ProviderError } from '../providers/types.js';
import { buildItemViews } from '../services/resultViews.js';
import { DEFAULT_RISK_RULES } from '../config/riskRules.js';
import { useTestDatabase } from './db.js';
import { enrichmentHarness, fakeAdapter, finding, waitFor } from './helpers.js';

useTestDatabase();

const opts = { sessionId: 'test-session', demo: false, source: { kind: 'text' as const } };

async function run(h: Awaited<ReturnType<typeof enrichmentHarness>>, text: string, extra: Partial<typeof opts> = {}) {
  const batch = await h.service.createBatch(parseIndicators(text), { ...opts, ...extra });
  await h.queue.idle();
  return (await Batch.findById(batch._id).lean())!;
}

async function apiErrorOf(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected ApiError');
}

describe('batch processing', () => {
  it('enriches every supported indicator/provider pair and completes', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4', 'domain'], async () => finding({ verdict: 'no_detections' }));
    const ab = fakeAdapter('abuseipdb', ['ipv4'], async () => finding({ abuseConfidence: 90, verdict: 'malicious' }));
    const h = await enrichmentHarness([vt, ab]);

    const batch = await run(h, '8.8.8.8\nexample.com\n10.0.0.1\n8.8.8.8');
    expect(batch.status).toBe('completed');
    expect(batch.counters).toMatchObject({ total: 3, completed: 3, queued: 0, running: 0, failed: 0 });
    expect(batch.completedAt).toBeInstanceOf(Date);
    // Domains are unsupported by AbuseIPDB; the private IP is never sent anywhere.
    expect(vt.calls.sort()).toEqual(['8.8.8.8', 'example.com']);
    expect(ab.calls).toEqual(['8.8.8.8']);
    expect(batch.totals).toMatchObject({ indicators: 3, eligible: 2, ineligible: 1, duplicates: 1 });
    await h.service.stop();
  });

  it('never reports completion while lookups are still pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      await gate;
      return finding();
    });
    const h = await enrichmentHarness([vt]);
    const created = await h.service.createBatch(parseIndicators('1.1.1.1\n8.8.8.8'), opts);
    await waitFor(async () => (await EnrichmentResult.countDocuments({ status: 'running' })) > 0);
    await h.service.refreshBatch(created._id);
    const mid = (await Batch.findById(created._id).lean())!;
    expect(mid.status).toBe('running');
    expect(mid.completedAt).toBeUndefined();

    release();
    await h.queue.idle();
    expect((await Batch.findById(created._id).lean())!.status).toBe('completed');
    await h.service.stop();
  });

  it('isolates provider failures: the batch finishes with errors and other results stand', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      throw new ProviderError('auth', 'VirusTotal rejected the API key (HTTP 401)', { httpStatus: 401 });
    });
    const ab = fakeAdapter('abuseipdb', ['ipv4'], async () => finding({ abuseConfidence: 100, verdict: 'malicious' }));
    const h = await enrichmentHarness([vt, ab]);

    const batch = await run(h, '45.33.32.156');
    expect(batch.status).toBe('completed_with_errors');
    expect(batch.counters).toMatchObject({ completed: 1, failed: 1 });
    const failed = await EnrichmentResult.findOne({ provider: 'virustotal' }).lean();
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, error: { kind: 'auth', httpStatus: 401 } });
    expect(vt.calls).toHaveLength(1); // auth errors are not retried

    const [view] = buildItemViews(batch, await EnrichmentResult.find({ batchId: batch._id }).lean(), DEFAULT_RISK_RULES);
    expect(view!.risk.level).toBe('high');
    expect(view!.risk.reasons.join(' ')).toMatch(/1 lookup\(s\) failed and are not counted/);
    await h.service.stop();
  });

  it('retries transient failures with backoff', async () => {
    let n = 0;
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      n++;
      if (n === 1) throw new ProviderError('timeout', 'VirusTotal did not respond within 15s');
      if (n === 2) throw new ProviderError('provider_error', 'VirusTotal server error (HTTP 503)', { httpStatus: 503 });
      return finding();
    });
    const h = await enrichmentHarness([vt]);
    const batch = await run(h, '8.8.8.8');
    await waitFor(async () => (await Batch.findById(batch._id).lean())!.status === 'completed');
    expect(vt.calls).toHaveLength(3);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'completed', attempts: 3 });
    await h.service.stop();
  });

  it('reports a batch as running while a lookup waits to retry', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      throw new ProviderError('network', 'Could not reach VirusTotal: fetch failed');
    });
    const h = await enrichmentHarness([vt], { RETRY_BASE_DELAY_MS: '60000' });
    const created = await h.service.createBatch(parseIndicators('8.8.8.8'), opts);
    await waitFor(() => vt.calls.length === 1);
    await waitFor(async () => (await EnrichmentResult.findOne().lean())?.status === 'queued');
    await h.service.refreshBatch(created._id);
    const batch = (await Batch.findById(created._id).lean())!;
    expect(batch.status).toBe('running');
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ attempts: 1, error: { kind: 'network' } });
    await h.service.stop();
  });

  it('respects HTTP 429 Retry-After and gives up after the maximum attempts', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      throw new ProviderError('rate_limited', 'VirusTotal rate limit hit (HTTP 429)', { httpStatus: 429, retryAfterMs: 20 });
    });
    const h = await enrichmentHarness([vt], { LOOKUP_MAX_ATTEMPTS: '3' });
    const started = Date.now();
    const created = await h.service.createBatch(parseIndicators('8.8.8.8'), opts);
    await waitFor(async () => (await Batch.findById(created._id).lean())!.status === 'completed_with_errors');
    expect(Date.now() - started).toBeGreaterThanOrEqual(40); // two Retry-After waits
    expect(vt.calls).toHaveLength(3);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'failed', error: { kind: 'rate_limited' } });
    await h.service.stop();
  });

  it('treats a 429 with a very long Retry-After as quota exhaustion (no retry)', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      throw new ProviderError('rate_limited', 'limit', { httpStatus: 429, retryAfterMs: 6 * 3_600_000 });
    });
    const h = await enrichmentHarness([vt]);
    await run(h, '8.8.8.8');
    expect(vt.calls).toHaveLength(1);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'failed', error: { kind: 'quota_exhausted' } });
    await h.service.stop();
  });

  it('enforces the local daily quota without calling the provider', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await enrichmentHarness([vt], { VIRUSTOTAL_DAILY_LIMIT: '2' });
    const batch = await run(h, '1.1.1.1\n8.8.8.8\n9.9.9.9');
    expect(vt.calls).toHaveLength(2);
    expect(batch.counters).toMatchObject({ completed: 2, failed: 1 });
    expect(await EnrichmentResult.findOne({ status: 'failed' }).lean()).toMatchObject({ error: { kind: 'quota_exhausted' } });
    await h.service.stop();
  });

  it('reuses fresh cached results and re-queries once they expire', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding({ summary: 'fresh' }));
    const h = await enrichmentHarness([vt]);
    await run(h, '8.8.8.8');
    const second = await run(h, '8.8.8.8');
    expect(vt.calls).toHaveLength(1);
    expect(second.counters).toMatchObject({ completed: 1, cached: 1 });
    expect(await EnrichmentResult.findOne({ batchId: second._id }).lean()).toMatchObject({ cacheStatus: 'hit', summary: 'fresh' });

    await EnrichmentResult.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const third = await run(h, '8.8.8.8');
    expect(vt.calls).toHaveLength(2);
    expect(await EnrichmentResult.findOne({ batchId: third._id }).lean()).toMatchObject({ cacheStatus: 'miss' });
    await h.service.stop();
  });

  it('never caches failed lookups', async () => {
    let fail = true;
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      if (fail) throw new ProviderError('auth', 'bad key');
      return finding();
    });
    const h = await enrichmentHarness([vt]);
    await run(h, '8.8.8.8');
    fail = false;
    const second = await run(h, '8.8.8.8');
    expect(vt.calls).toHaveLength(2);
    expect(second.status).toBe('completed');
    await h.service.stop();
  });

  it('cancels queued work, lets in-flight lookups finish, then reports cancelled', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      await gate;
      return finding();
    }, { concurrency: 1 });
    const h = await enrichmentHarness([vt]);
    const created = await h.service.createBatch(parseIndicators('1.1.1.1\n8.8.8.8\n9.9.9.9'), opts);
    await waitFor(async () => (await EnrichmentResult.countDocuments({ status: 'running' })) === 1);

    await h.service.cancelBatch(created._id, 'test-session');
    expect((await Batch.findById(created._id).lean())!.status).toBe('cancelling');
    release();
    await h.queue.idle();

    const batch = (await Batch.findById(created._id).lean())!;
    expect(batch.status).toBe('cancelled');
    expect(batch.counters).toMatchObject({ completed: 1, cancelled: 2 });
    expect(vt.calls).toHaveLength(1);
    await expect(h.service.cancelBatch(created._id, 'test-session')).rejects.toThrow(/already cancelled/);
    await h.service.stop();
  });

  it('retries an eligible failed lookup on request', async () => {
    let fail = true;
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      if (fail) throw new ProviderError('auth', 'bad key');
      return finding({ summary: 'after retry' });
    });
    const h = await enrichmentHarness([vt]);
    const batch = await run(h, '8.8.8.8');
    expect(batch.status).toBe('completed_with_errors');

    const failed = (await EnrichmentResult.findOne({ status: 'failed' }).lean())!;
    fail = false;
    await h.service.retryResult(String(failed._id), 'test-session');
    await h.queue.idle();
    expect(await EnrichmentResult.findById(failed._id).lean()).toMatchObject({ status: 'completed', summary: 'after retry' });
    expect((await Batch.findById(batch._id).lean())!.status).toBe('completed');

    const err = await apiErrorOf(h.service.retryResult(String(failed._id), 'test-session'));
    expect(err.code).toBe('NOT_RETRYABLE');
    await h.service.stop();
  });

  it('refuses batches over the size limit and batches with nothing to enrich', async () => {
    const h = await enrichmentHarness([fakeAdapter('virustotal', ['ipv4'], async () => finding())], { MAX_BATCH_SIZE: '2' });
    expect((await apiErrorOf(h.service.createBatch(parseIndicators('1.1.1.1\n8.8.8.8\n9.9.9.9'), opts))).code).toBe('BATCH_TOO_LARGE');
    expect((await apiErrorOf(h.service.createBatch(parseIndicators('10.0.0.1\n192.168.1.1'), opts))).code).toBe('NOTHING_TO_ENRICH');
    // Private IPs do not count toward the limit.
    await expect(h.service.createBatch(parseIndicators('1.1.1.1\n8.8.8.8\n10.0.0.1'), opts)).resolves.toBeTruthy();
    await h.service.stop();
  });

  it('refuses to run with no configured provider, and records unconfigured ones in the snapshot', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const ab = fakeAdapter('abuseipdb', ['ipv4'], async () => finding());
    const none = await enrichmentHarness([vt, ab], { VIRUSTOTAL_API_KEY: '', ABUSEIPDB_API_KEY: '' });
    expect((await apiErrorOf(none.service.createBatch(parseIndicators('8.8.8.8'), opts))).code).toBe('NO_PROVIDERS_CONFIGURED');
    await none.service.stop();

    const some = await enrichmentHarness([vt, ab], { ABUSEIPDB_API_KEY: '' });
    const batch = await run(some, '8.8.8.8');
    expect(batch.providers.map((p) => [p.id, p.state])).toEqual([
      ['virustotal', 'ready'],
      ['abuseipdb', 'unconfigured'],
    ]);
    expect(ab.calls).toHaveLength(0);
    expect(await EnrichmentResult.countDocuments({ provider: 'abuseipdb' })).toBe(0);
    await some.service.stop();
  });

  it('runs demo batches only against the clearly labeled synthetic provider', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await enrichmentHarness([vt]);
    const batch = await run(h, '8.8.8.8\nexample.com', { demo: true });
    expect(batch.demo).toBe(true);
    expect(batch.providers.map((p) => p.id)).toEqual(['demo']);
    expect(vt.calls).toHaveLength(0);
    const results = await EnrichmentResult.find({ batchId: batch._id }).lean();
    expect(results.every((r) => r.synthetic && r.summary?.startsWith('[SYNTHETIC]'))).toBe(true);
    await h.service.stop();
  });

  it('resumes lookups interrupted by a restart', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await enrichmentHarness([vt]);
    const created = await h.service.createBatch(parseIndicators('8.8.8.8'), opts);
    await h.queue.idle();
    // Simulate a crash mid-request.
    await EnrichmentResult.updateMany({}, { $set: { status: 'running' } });
    await Batch.updateOne({ _id: created._id }, { $set: { status: 'running' } });

    await h.service.recoverInterrupted();
    await h.queue.idle();
    expect((await Batch.findById(created._id).lean())!.status).toBe('completed');
    expect(vt.calls).toHaveLength(2);
    await h.service.stop();
  });

  it('purges batches and indicators past the retention window and audits it', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await enrichmentHarness([vt], { RETENTION_DAYS: '7' });
    const old = await run(h, '8.8.8.8');
    const recent = await run(h, '1.1.1.1');
    const longAgo = new Date(Date.now() - 10 * 86_400_000);
    await Batch.collection.updateOne({ _id: old._id as never }, { $set: { createdAt: longAgo } });
    await EnrichmentResult.collection.updateMany({ batchId: old._id }, { $set: { createdAt: longAgo } });

    const purged = await h.service.purgeExpired();
    expect(purged.batches).toBe(1);
    expect(await Batch.exists({ _id: old._id })).toBeNull();
    expect(await Batch.exists({ _id: recent._id })).not.toBeNull();
    expect(await EnrichmentResult.countDocuments({ batchId: old._id })).toBe(0);
    expect(await AuditEvent.exists({ action: 'retention.purge' })).not.toBeNull();
    await h.service.stop();
  });

  it('writes audit events without indicator values', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await enrichmentHarness([vt]);
    const batch = await run(h, '203.0.113.77\n8.8.8.8');
    await h.service.deleteBatch(batch._id, 'test-session');
    const events = await AuditEvent.find().sort({ at: 1 }).lean();
    expect(events.map((e) => e.action)).toEqual(['batch.create', 'batch.delete']);
    expect(JSON.stringify(events)).not.toContain('8.8.8.8');
    await h.service.stop();
  });
});
