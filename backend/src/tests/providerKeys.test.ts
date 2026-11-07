import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { DEFAULT_RISK_RULES } from '../config/riskRules.js';
import { SecretVault, vaultFor } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { AuditEvent, Batch, EnrichmentResult, ProviderKey } from '../models/index.js';
import { parseIndicators } from '../parser/index.js';
import { ProviderRegistry } from '../providers/registry.js';
import { ProviderError, type ProviderAdapter } from '../providers/types.js';
import { DatabaseLookupQueue } from '../queue/databaseQueue.js';
import type { Principal } from '../services/authService.js';
import { EnrichmentService } from '../services/enrichmentService.js';
import { ProviderKeyService } from '../services/providerKeyService.js';
import { useTestDatabase } from './db.js';
import { enrichmentHarness, fakeAdapter, finding, signedInAgent, silentLogger } from './helpers.js';

useTestDatabase();

const ADMIN: Principal = { id: 'admin-1', email: 'admin@example.com', name: 'Ada Admin', role: 'admin' };
const ANALYST: Principal = { id: 'analyst-1', email: 'analyst@example.com', name: 'Ana Analyst', role: 'analyst' };
const KEY_A = 'vt-pool-key-AAAA-1111';
const KEY_B = 'vt-pool-key-BBBB-2222';

const create = (h: { service: EnrichmentService }, text: string, extra: { includeReanalysis?: boolean } = {}) =>
  h.service.createBatch(parseIndicators(text), { actor: ANALYST, source: { kind: 'text' }, ...extra });

/** A VirusTotal stand-in that records which API key each request used. */
function recordingAdapter(limits: Partial<ProviderAdapter['defaultLimits']> = {}) {
  const keysUsed: string[] = [];
  const vt = fakeAdapter(
    'virustotal',
    ['ipv4', 'sha256'],
    async (_indicator, ctx) => {
      keysUsed.push(ctx.apiKey);
      return finding();
    },
    limits,
  );
  return { vt, keysUsed };
}

describe('secret vault', () => {
  const vault = vaultFor(loadConfig({ NODE_ENV: 'test' }));

  it('encrypts with AES-256-GCM, a fresh nonce every time, and decrypts back', () => {
    const a = vault.encrypt('super-secret-key-12345', 'provider-key:1');
    const b = vault.encrypt('super-secret-key-12345', 'provider-key:1');
    expect(a.iv).toHaveLength(24);
    expect(a.tag).toHaveLength(32);
    expect(a.ciphertext).not.toContain('super-secret');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(vault.decrypt(a, 'provider-key:1')).toBe('super-secret-key-12345');
  });

  it('rejects tampered values and values moved onto another record', () => {
    const sealed = vault.encrypt('super-secret-key-12345', 'provider-key:1');
    expect(() => vault.decrypt(sealed, 'provider-key:2')).toThrow();
    const flipped = { ...sealed, ciphertext: (sealed.ciphertext[0] === '0' ? '1' : '0') + sealed.ciphertext.slice(1) };
    expect(() => vault.decrypt(flipped, 'provider-key:1')).toThrow();
    expect(vault.tryDecrypt(flipped, 'provider-key:1')).toBeNull();
  });

  it('uses ENCRYPTION_KEY when set, and refuses to store secrets in production without it', () => {
    const configured = vaultFor(loadConfig({ NODE_ENV: 'production', ENCRYPTION_KEY: 'x'.repeat(40) }));
    expect(configured.source).toBe('environment');
    expect(configured.decrypt(configured.encrypt('k', 'c'), 'c')).toBe('k');

    const missing = vaultFor(loadConfig({ NODE_ENV: 'production' }));
    expect(missing.available).toBe(false);
    expect(() => missing.encrypt('k', 'c')).toThrow(ApiError);
    expect(() => loadConfig({ ENCRYPTION_KEY: 'too-short' })).toThrow(/ENCRYPTION_KEY/);
  });
});

describe('provider key administration', () => {
  it('is for administrators only', async () => {
    const h = await enrichmentHarness([recordingAdapter().vt]);
    const { agent: analyst } = await signedInAgent(h.app, 'analyst');
    expect((await analyst.get('/api/settings/provider-keys')).status).toBe(403);
    expect((await analyst.post('/api/settings/provider-keys').send({ provider: 'virustotal', label: 'x', apiKey: KEY_A })).status).toBe(
      403,
    );
    expect((await analyst.patch('/api/settings/provider-keys/env:virustotal').send({ label: 'y' })).status).toBe(403);
    expect((await analyst.delete('/api/settings/provider-keys/env:virustotal')).status).toBe(403);
    expect((await analyst.post('/api/settings/provider-keys/env:virustotal/test')).status).toBe(403);
    // Analysts see the provider, but not how many keys it has.
    const providers = await analyst.get('/api/providers');
    expect(providers.body.data[0].keyCount).toBeUndefined();
    await h.service.stop();
  });

  it('adds, lists, updates and deletes keys, storing them only encrypted and never returning them', async () => {
    const h = await enrichmentHarness([recordingAdapter().vt]);
    const { agent } = await signedInAgent(h.app, 'admin');

    const created = await agent
      .post('/api/settings/provider-keys')
      .send({ provider: 'virustotal', label: 'Worker 2', apiKey: KEY_A, requestsPerMinute: 8 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data).toMatchObject({
      provider: 'virustotal',
      source: 'database',
      label: 'Worker 2',
      keyHint: '...1111',
      active: true,
      status: 'ok',
      requestsPerMinute: 8,
      effectiveLimits: { requestsPerMinute: 8, dailyLimit: null },
    });
    const id = created.body.data.id as string;

    const doc = await ProviderKey.findById(id).lean();
    expect(JSON.stringify(doc)).not.toContain(KEY_A);
    expect(vaultFor(h.config).decrypt({ ciphertext: doc!.encryptedKey, iv: doc!.iv, tag: doc!.tag }, `provider-key:${id}`)).toBe(KEY_A);

    const list = await agent.get('/api/settings/provider-keys');
    expect(list.body.meta).toEqual({ encryptionAvailable: true });
    expect(list.body.data.map((k: { id: string; source: string }) => [k.id, k.source])).toEqual([
      ['env:virustotal', 'environment'],
      [id, 'database'],
    ]);
    expect((await agent.get('/api/providers')).body.data[0]).toMatchObject({ keyCount: 2, limits: { requestsPerMinute: 10_008 } });

    const updated = await agent
      .patch(`/api/settings/provider-keys/${id}`)
      .send({ label: 'Worker 2b', active: false, requestsPerMinute: null });
    expect(updated.body.data).toMatchObject({ label: 'Worker 2b', active: false, status: 'inactive', requestsPerMinute: null });
    expect((await agent.get('/api/providers')).body.data[0].keyCount).toBe(1);

    const rotated = await agent.patch(`/api/settings/provider-keys/${id}`).send({ apiKey: KEY_B });
    expect(rotated.body.data.keyHint).toBe('...2222');

    expect((await agent.delete(`/api/settings/provider-keys/${id}`)).status).toBe(204);
    expect(await ProviderKey.countDocuments()).toBe(0);
    expect((await agent.delete(`/api/settings/provider-keys/${id}`)).status).toBe(404);

    const events = await AuditEvent.find({ action: /^provider_key\./ }).lean();
    expect(events.map((e) => e.action).sort()).toEqual([
      'provider_key.create',
      'provider_key.delete',
      'provider_key.update',
      'provider_key.update',
    ]);
    for (const body of [created.body, list.body, updated.body, rotated.body, events]) {
      expect(JSON.stringify(body)).not.toContain(KEY_A);
      expect(JSON.stringify(body)).not.toContain(KEY_B);
      expect(JSON.stringify(body)).not.toContain('test-vt-key-SECRET');
    }
    await h.service.stop();
  });

  it('validates input, refuses duplicates and leaves the environment key read-only', async () => {
    const h = await enrichmentHarness([recordingAdapter().vt]);
    const { agent } = await signedInAgent(h.app, 'admin');
    const post = (body: object) => agent.post('/api/settings/provider-keys').send(body);

    expect((await post({ provider: 'virustotal', label: 'x', apiKey: 'has spaces in it' })).status).toBe(400);
    expect((await post({ provider: 'virustotal', label: 'x', apiKey: 'short' })).status).toBe(400);
    expect((await post({ provider: 'virustotal', label: '', apiKey: KEY_A })).status).toBe(400);
    expect((await post({ provider: 'nope', label: 'x', apiKey: KEY_A })).status).toBe(400);
    expect((await post({ provider: 'virustotal', label: 'x', apiKey: KEY_A, requestsPerMinute: 0 })).status).toBe(400);
    expect((await post({ provider: 'virustotal', label: 'x', apiKey: KEY_A, extra: true })).status).toBe(400);
    expect((await post({ provider: 'abuseipdb', label: 'x', apiKey: KEY_A })).status).toBe(400); // not registered here

    expect((await post({ provider: 'virustotal', label: 'x', apiKey: KEY_A })).status).toBe(201);
    expect((await post({ provider: 'virustotal', label: 'again', apiKey: KEY_A })).status).toBe(409);
    expect((await post({ provider: 'virustotal', label: 'env', apiKey: 'test-vt-key-SECRET' })).status).toBe(409);

    expect((await agent.patch('/api/settings/provider-keys/env:virustotal').send({ label: 'x' })).status).toBe(409);
    expect((await agent.delete('/api/settings/provider-keys/env:virustotal')).status).toBe(409);
    expect((await agent.patch('/api/settings/provider-keys/not-an-id').send({ label: 'x' })).status).toBe(400);
    await h.service.stop();
  });

  it('tests a key and takes a rejected one out of rotation until it passes again', async () => {
    let accept = false;
    const vt = fakeAdapter('virustotal', ['ipv4'], async () => {
      if (!accept) throw new ProviderError('auth', 'VirusTotal rejected the API key (HTTP 401)', { httpStatus: 401 });
      return finding({ summary: '0/90 engines malicious' });
    });
    const h = await enrichmentHarness([vt], { VIRUSTOTAL_API_KEY: '' });
    const { agent } = await signedInAgent(h.app, 'admin');
    const id = (await agent.post('/api/settings/provider-keys').send({ provider: 'virustotal', label: 'k', apiKey: KEY_A })).body.data.id;

    const failed = await agent.post(`/api/settings/provider-keys/${id}/test`);
    expect(failed.body.data).toMatchObject({ ok: false, kind: 'auth' });
    expect((await agent.get('/api/settings/provider-keys')).body.data[0]).toMatchObject({ status: 'rejected' });
    expect((await agent.get('/api/providers')).body.data[0]).toMatchObject({ state: 'unconfigured', keyCount: 0 });
    expect((await agent.post(`/api/settings/provider-keys/${id}/test`)).status).toBe(429); // cooldown

    accept = true;
    const ok = await h.service.keyService.test(id, ADMIN);
    expect(ok).toMatchObject({ ok: true, message: 'Key works. Test lookup of 8.8.8.8: 0/90 engines malicious' });
    expect((await agent.get('/api/providers')).body.data[0]).toMatchObject({ state: 'ready', keyCount: 1 });
    await h.service.stop();
  });

  it('refuses to store keys when the server has no encryption key', async () => {
    const h = await enrichmentHarness([recordingAdapter().vt]);
    const locked = new ProviderKeyService(h.config, silentLogger, h.registry, new SecretVault(null, null));
    await expect(locked.create({ provider: 'virustotal', label: 'x', apiKey: KEY_A }, ADMIN)).rejects.toMatchObject({
      status: 503,
      code: 'ENCRYPTION_NOT_CONFIGURED',
    });
    await h.service.stop();
  });
});

describe('parallel processing with a key pool', () => {
  it('makes a provider usable with dashboard keys alone', async () => {
    const { vt, keysUsed } = recordingAdapter();
    const h = await enrichmentHarness([vt], { VIRUSTOTAL_API_KEY: '' });
    await expect(create(h, '8.8.8.8')).rejects.toMatchObject({ code: 'NO_PROVIDERS_CONFIGURED' });

    await h.service.keyService.create({ provider: 'virustotal', label: 'A', apiKey: KEY_A }, ADMIN);
    await create(h, '8.8.8.8');
    await h.queue.idle();
    expect(keysUsed).toEqual([KEY_A]);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'completed' });
    await h.service.stop();
  });

  it('spreads lookups across every key and runs one worker per key', async () => {
    let running = 0;
    let peak = 0;
    const keysUsed: string[] = [];
    const vt = fakeAdapter(
      'virustotal',
      ['ipv4'],
      async (_i, ctx) => {
        keysUsed.push(ctx.apiKey);
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return finding();
      },
      { concurrency: 1 },
    );
    const h = await enrichmentHarness([vt], { VIRUSTOTAL_API_KEY: '' });
    await h.service.keyService.create({ provider: 'virustotal', label: 'A', apiKey: KEY_A }, ADMIN);
    await h.service.keyService.create({ provider: 'virustotal', label: 'B', apiKey: KEY_B }, ADMIN);
    await h.service.refreshProviders();

    await create(h, Array.from({ length: 8 }, (_, i) => `45.33.32.${i + 1}`).join('\n'));
    await h.queue.idle();
    expect(keysUsed).toHaveLength(8);
    expect(keysUsed.filter((k) => k === KEY_A)).toHaveLength(4);
    expect(keysUsed.filter((k) => k === KEY_B)).toHaveLength(4);
    expect(peak).toBe(2);
    await h.service.stop();
  });

  it("enforces each key's own per-minute limit (database queue)", async () => {
    const { vt, keysUsed } = recordingAdapter({ requestsPerMinute: 1, concurrency: 1 });
    const config = loadConfig({ NODE_ENV: 'test', VIRUSTOTAL_API_KEY: KEY_A, QUEUE_MODE: 'database' });
    const registry = new ProviderRegistry(config, undefined, [vt]);
    const queue = new DatabaseLookupQueue(silentLogger);
    const service = new EnrichmentService({ config, logger: silentLogger, registry, queue, rules: DEFAULT_RISK_RULES });
    await service.start({ background: false, recover: false });
    await service.keyService.create({ provider: 'virustotal', label: 'B', apiKey: KEY_B }, ADMIN);

    await create({ service }, '45.33.32.1\n45.33.32.2\n45.33.32.3');
    const tick = await service.tick(1000);
    expect(tick).toMatchObject({ processed: 2, pending: 1 });
    expect([...keysUsed].sort()).toEqual([KEY_A, KEY_B]);
    expect(await EnrichmentResult.countDocuments({ status: 'queued', attempts: 0 })).toBe(1);
    await service.stop();
  });

  it('moves a lookup to another key when one is rejected or throttled', async () => {
    const vt = fakeAdapter('virustotal', ['ipv4'], async (_i, ctx) => {
      if (ctx.apiKey === KEY_A) throw new ProviderError('auth', 'VirusTotal rejected the API key (HTTP 401)', { httpStatus: 401 });
      if (ctx.apiKey === KEY_B) throw new ProviderError('rate_limited', 'VirusTotal rate limit hit (HTTP 429)', { retryAfterMs: 60_000 });
      return finding({ summary: 'from the environment key' });
    });
    const h = await enrichmentHarness([vt]);
    const a = await h.service.keyService.create({ provider: 'virustotal', label: 'A', apiKey: KEY_A }, ADMIN);
    await h.service.keyService.create({ provider: 'virustotal', label: 'B', apiKey: KEY_B }, ADMIN);

    for (const ip of ['45.33.32.1', '45.33.32.2', '45.33.32.3']) {
      await create(h, ip);
      await h.queue.idle();
    }
    const results = await EnrichmentResult.find().lean();
    expect(results.every((r) => r.status === 'completed' && r.summary === 'from the environment key' && r.attempts === 1)).toBe(true);
    expect(await ProviderKey.findById(a.id).lean()).toMatchObject({ rejectedReason: 'VirusTotal rejected the API key (HTTP 401)' });
    expect((await h.service.keyService.pool('virustotal')).map((k) => k.label)).toEqual(['Server environment', 'B']);
    await h.service.stop();
  });

  it('fails as out of quota once every key used its daily limit', async () => {
    const { vt, keysUsed } = recordingAdapter();
    const h = await enrichmentHarness([vt], { VIRUSTOTAL_DAILY_LIMIT: '1' });
    await h.service.keyService.create({ provider: 'virustotal', label: 'B', apiKey: KEY_B, dailyLimit: 1 }, ADMIN);
    await create(h, '45.33.32.1\n45.33.32.2\n45.33.32.3');
    await h.queue.idle();
    expect(keysUsed).toHaveLength(2);
    const failed = await EnrichmentResult.findOne({ status: 'failed' }).lean();
    expect(failed?.error).toMatchObject({ kind: 'quota_exhausted', message: expect.stringMatching(/Every Fake virustotal API key/) });
    await h.service.stop();
  });
});

describe('VirusTotal reanalysis', () => {
  const REANALYSIS_ENV = { REANALYSIS_POLL_MS: '15', REANALYSIS_MAX_WAIT_MS: '400' };

  /** Reports a stale analysis until `freshAfter` lookups after the rescan request. */
  function reanalysingAdapter(freshAfter: number | null) {
    let requestedAt = 0;
    let lookupsSince = 0;
    const reanalysed: string[] = [];
    const vt = fakeAdapter('virustotal', ['ipv4', 'sha256'], async (indicator) => {
      const fresh = requestedAt > 0 && freshAfter !== null && ++lookupsSince >= freshAfter;
      return finding({
        outcome: 'found',
        summary: fresh ? `fresh ${indicator.value}` : `stale ${indicator.value}`,
        analysedAt: new Date(fresh ? Date.now() : Date.now() - 86_400_000).toISOString(),
      });
    });
    vt.reanalyse = async (indicator) => {
      reanalysed.push(indicator.value);
      if (indicator.type === 'sha256') return { kind: 'final', finding: finding({ outcome: 'not_found', summary: 'Not in the dataset' }) };
      requestedAt = Date.now();
      return { kind: 'submitted' };
    };
    return { vt, reanalysed };
  }

  it('is off unless requested: standard results, no rescan', async () => {
    const { vt, reanalysed } = reanalysingAdapter(1);
    const h = await enrichmentHarness([vt], REANALYSIS_ENV);
    const batch = await create(h, '8.8.8.8');
    await h.queue.idle();
    expect(batch.includeReanalysis).toBe(false);
    expect(reanalysed).toEqual([]);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({ status: 'completed', summary: 'stale 8.8.8.8' });
    await h.service.stop();
  });

  it('requests a rescan, waits for the fresh analysis and returns it', async () => {
    const { vt, reanalysed } = reanalysingAdapter(2);
    const h = await enrichmentHarness([vt], REANALYSIS_ENV);
    const batch = await create(h, '8.8.8.8', { includeReanalysis: true });
    await h.queue.idle();
    expect(reanalysed).toEqual(['8.8.8.8']);
    expect(vt.calls).toEqual(['8.8.8.8', '8.8.8.8']); // one stale check, then the fresh result
    const result = await EnrichmentResult.findOne().lean();
    expect(result).toMatchObject({
      status: 'completed',
      summary: 'fresh 8.8.8.8',
      attempts: 1,
      metrics: { reanalysis: 'Fresh analysis (rescanned for this batch)' },
      reanalysis: { checks: 1 },
    });
    expect((await Batch.findById(batch._id).lean())!.status).toBe('completed');
    await h.service.stop();
  });

  it('bypasses the cache so a rescan always asks the provider', async () => {
    const { vt, reanalysed } = reanalysingAdapter(1);
    const h = await enrichmentHarness([vt], REANALYSIS_ENV);
    await create(h, '8.8.8.8');
    await h.queue.idle();
    await create(h, '8.8.8.8', { includeReanalysis: true });
    await h.queue.idle();
    expect(reanalysed).toEqual(['8.8.8.8']);
    expect(await EnrichmentResult.countDocuments({ cacheStatus: 'hit' })).toBe(0);
    await h.service.stop();
  });

  it('falls back to the latest analysis when the rescan does not finish in time', async () => {
    const { vt } = reanalysingAdapter(null);
    const h = await enrichmentHarness([vt], { REANALYSIS_POLL_MS: '15', REANALYSIS_MAX_WAIT_MS: '60' });
    await create(h, '8.8.8.8', { includeReanalysis: true });
    await h.queue.idle();
    const result = await EnrichmentResult.findOne().lean();
    expect(result).toMatchObject({ status: 'completed', summary: 'stale 8.8.8.8', attempts: 1 });
    expect(String(result!.metrics!.reanalysis)).toMatch(/had not finished/);
    await h.service.stop();
  });

  it('reports indicators the provider has no record of without submitting them', async () => {
    const { vt, reanalysed } = reanalysingAdapter(1);
    const h = await enrichmentHarness([vt], REANALYSIS_ENV);
    const hash = 'a'.repeat(64);
    await create(h, hash, { includeReanalysis: true });
    await h.queue.idle();
    expect(reanalysed).toEqual([hash]);
    expect(vt.calls).toEqual([]);
    expect(await EnrichmentResult.findOne().lean()).toMatchObject({
      status: 'completed',
      outcome: 'not_found',
      metrics: { reanalysis: 'Not possible: Fake virustotal has no record to rescan' },
    });
    await h.service.stop();
  });

  it('is accepted by the batch API as an opt-in flag', async () => {
    const { vt } = reanalysingAdapter(1);
    const h = await enrichmentHarness([vt], REANALYSIS_ENV);
    const { agent } = await signedInAgent(h.app);
    const res = await agent.post('/api/batches').send({ text: '8.8.8.8', acknowledgeThirdPartySharing: true, includeReanalysis: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.includeReanalysis).toBe(true);
    await h.queue.idle();
    await h.service.stop();
  });
});
