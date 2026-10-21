import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_RULES } from '../config/riskRules.js';
import { loadConfig } from '../config/env.js';
import { createApp } from '../app.js';
import { Batch, EnrichmentResult, ProviderPause } from '../models/index.js';
import { parseIndicators } from '../parser/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { ProviderError, type ProviderAdapter } from '../providers/types.js';
import { DatabaseLookupQueue } from '../queue/databaseQueue.js';
import type { Principal } from '../services/authService.js';
import { AuthService } from '../services/authService.js';
import { EnrichmentService } from '../services/enrichmentService.js';
import { useTestDatabase } from './db.js';
import { fakeAdapter, finding, signedInAgent, silentLogger } from './helpers.js';

useTestDatabase();

const ACTOR: Principal = { id: 'u1', email: 'a@example.com', name: 'Ana', role: 'analyst' };
const CRON_SECRET = 'a-very-long-scheduler-secret';

async function serverless(adapters: ProviderAdapter[], env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    VIRUSTOTAL_API_KEY: 'vt',
    ABUSEIPDB_API_KEY: 'ab',
    QUEUE_MODE: 'database',
    RETRY_BASE_DELAY_MS: '5',
    CRON_SECRET,
    ...env,
  });
  const registry = new ProviderRegistry(config, undefined, adapters);
  const queue = new DatabaseLookupQueue(silentLogger);
  const service = new EnrichmentService({ config, logger: silentLogger, registry, queue, rules: DEFAULT_RISK_RULES });
  await service.start({ background: false, recover: false });
  const auth = new AuthService(config, silentLogger);
  const app = createApp(config, silentLogger, { enrichment: service, auth, databaseMode: 'external' });
  return { service, queue, app };
}

const create = (h: Awaited<ReturnType<typeof serverless>>, text: string) =>
  h.service.createBatch(parseIndicators(text), { actor: ACTOR, source: { kind: 'text' } });

describe('database queue (serverless hosting)', () => {
  it('only processes lookups when drained, and completes the batch', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await serverless([vt]);
    const batch = await create(h, '1.1.1.1\n8.8.8.8');
    expect(vt.calls).toHaveLength(0); // nothing runs in the background

    const result = await h.service.tick(2000);
    expect(result).toEqual({ processed: 2, pending: 0 });
    expect((await Batch.findById(batch._id).lean())!.status).toBe('completed');
  });

  it('enforces the per-minute rate limit across ticks (shared via the database)', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding(), { requestsPerMinute: 2 });
    const h = await serverless([vt]);
    await create(h, '1.1.1.1\n8.8.8.8\n9.9.9.9');
    await h.service.tick(1000);
    await h.service.tick(1000);
    // A second instance sharing the same database is held to the same window.
    const other = await serverless([vt]);
    await other.service.tick(1000);
    expect(vt.calls).toHaveLength(2);
    expect(await EnrichmentResult.countDocuments({ status: 'queued' })).toBe(1);
  });

  it('schedules retries with backoff instead of retrying immediately', async () => {
    let n = 0;
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      if (++n === 1) throw new ProviderError('timeout', 'slow');
      return finding();
    });
    const h = await serverless([vt], { RETRY_BASE_DELAY_MS: '300' });
    await create(h, '8.8.8.8');
    await h.service.tick(100);
    const waiting = (await EnrichmentResult.findOne().lean())!;
    expect(waiting).toMatchObject({ status: 'queued', attempts: 1 });
    expect(waiting.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());

    await h.service.tick(100); // not due yet
    expect(vt.calls).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 450));
    await h.service.tick(500);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it('pauses the provider for every instance after HTTP 429', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      throw new ProviderError('rate_limited', '429', { retryAfterMs: 60_000 });
    });
    const h = await serverless([vt]);
    await create(h, '1.1.1.1\n8.8.8.8');
    await h.service.tick(1000);
    expect(vt.calls).toHaveLength(1);
    expect((await ProviderPause.findOne({ provider: 'virustotal' }).lean())!.pausedUntil.getTime()).toBeGreaterThan(Date.now() + 50_000);
    await h.service.tick(1000);
    expect(vt.calls).toHaveLength(1);
  });

  it('recovers lookups cut off mid-request by a frozen instance', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await serverless([vt]);
    await create(h, '8.8.8.8');
    await EnrichmentResult.collection.updateMany({}, { $set: { status: 'running', updatedAt: new Date(Date.now() - 10 * 60_000) } });
    await h.service.tick(1000);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'completed' });
  });

  it('exposes tick to signed-in users and cron to the shared secret only', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => finding());
    const h = await serverless([vt]);
    await create(h, '8.8.8.8');

    expect((await request(h.app).post('/api/queue/tick')).status).toBe(401);
    expect((await request(h.app).get('/api/cron/tick')).status).toBe(401);
    expect((await request(h.app).get('/api/cron/tick').set('Authorization', 'Bearer wrong-secret-of-some-length')).status).toBe(401);
    const cron = await request(h.app).get('/api/cron/tick').set('Authorization', `Bearer ${CRON_SECRET}`);
    expect(cron.body.data).toEqual({ mode: 'database', processed: 1, pending: 0 });

    const { agent } = await signedInAgent(h.app);
    expect((await agent.post('/api/queue/tick')).body.data).toMatchObject({ mode: 'database', processed: 0 });
  });

  it('disables the cron endpoint when no secret is configured', async () => {
    const h = await serverless([], { CRON_SECRET: '' });
    expect((await request(h.app).get('/api/cron/tick').set('Authorization', 'Bearer anything-at-all-here')).status).toBe(404);
  });
});

describe('atomic counters', () => {
  it('do not report a limit as reached when concurrent callers create the counter together', async () => {
    const { reserveRequest } = await import('../services/providerUsage.js');
    const results = await Promise.all(Array.from({ length: 8 }, () => reserveRequest('virustotal', 5)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((r) => !r)).toHaveLength(3);
  });
});
