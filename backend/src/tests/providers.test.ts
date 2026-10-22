import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import { abuseIpdb } from '../providers/adapters/abuseipdb.js';
import { alienVaultOtx } from '../providers/adapters/otx.js';
import { urlhaus } from '../providers/adapters/urlhaus.js';
import { sophosVerdict, virusTotal, vtUrlId } from '../providers/adapters/virustotal.js';
import { createProviderHttp, type FetchLike } from '../providers/http.js';
import { ProviderRegistry } from '../providers/registry.js';
import { ProviderError, type ProviderAdapter } from '../providers/types.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function harness(adapter: ProviderAdapter, respond: (url: string, init: RequestInit) => Response | Promise<Response>, timeoutMs = 2000) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  });
  const http = createProviderHttp({ providerName: adapter.name, allowedHosts: adapter.allowedHosts, timeoutMs, fetchImpl });
  return {
    calls,
    lookup: (value: string, type: Parameters<ProviderAdapter['lookup']>[0]['type']) =>
      adapter.lookup({ value, type }, { apiKey: 'k3y', http }),
  };
}

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error('expected a ProviderError');
}

describe('provider HTTP client', () => {
  it('refuses hosts outside the allowlist and non-https URLs (SSRF guard)', async () => {
    const fetchImpl = vi.fn();
    const http = createProviderHttp({ providerName: 'X', allowedHosts: ['api.example.com'], timeoutMs: 1000, fetchImpl });
    expect((await errorOf(http.request('https://evil.example.net/x'))).kind).toBe('invalid_request');
    expect((await errorOf(http.request('http://api.example.com/x'))).kind).toBe('invalid_request');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out slow providers', async () => {
    const { lookup } = harness(
      virusTotal,
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
        }),
      50,
    );
    const err = await errorOf(lookup('8.8.8.8', 'ipv4'));
    expect(err.kind).toBe('timeout');
    expect(err.retryable).toBe(true);
  });

  it('maps HTTP status codes to typed errors', async () => {
    const cases: Array<[number, string, boolean]> = [
      [401, 'auth', false],
      [403, 'auth', false],
      [429, 'rate_limited', true],
      [500, 'provider_error', true],
      [503, 'provider_error', true],
      [400, 'invalid_request', false],
    ];
    for (const [status, kind, retryable] of cases) {
      const { lookup } = harness(virusTotal, () => jsonResponse(status, { error: { code: 'X' } }));
      const err = await errorOf(lookup('8.8.8.8', 'ipv4'));
      expect(err.kind, String(status)).toBe(kind);
      expect(err.retryable, String(status)).toBe(retryable);
    }
  });

  it('reads Retry-After on HTTP 429', async () => {
    const { lookup } = harness(abuseIpdb, () => jsonResponse(429, {}, { 'retry-after': '42' }));
    const err = await errorOf(lookup('8.8.8.8', 'ipv4'));
    expect(err.kind).toBe('rate_limited');
    expect(err.options.retryAfterMs).toBe(42_000);
  });

  it('reports network failures without leaking the API key', async () => {
    const { lookup } = harness(virusTotal, () => {
      throw new TypeError('fetch failed');
    });
    const err = await errorOf(lookup('8.8.8.8', 'ipv4'));
    expect(err.kind).toBe('network');
    expect(err.message).not.toContain('k3y');
  });
});

describe('VirusTotal adapter', () => {
  const vtBody = (stats: Record<string, number>, results?: Record<string, unknown>) =>
    jsonResponse(200, {
      data: { id: 'x', attributes: { last_analysis_stats: stats, ...(results ? { last_analysis_results: results } : {}) } },
    });
  const MAL = { malicious: 9, suspicious: 0, harmless: 50, undetected: 31 };

  it('reports whether Sophos detected a malicious result, without any extra request', async () => {
    const detected = harness(virusTotal, () =>
      vtBody(MAL, { Sophos: { category: 'malicious', result: 'Mal/Generic-S' }, Kaspersky: { category: 'malicious', result: 'x' } }),
    );
    expect((await detected.lookup('45.33.32.156', 'ipv4')).metrics.sophos).toBe('Detected: Mal/Generic-S');
    expect(detected.calls).toHaveLength(1);

    const missed = harness(virusTotal, () =>
      vtBody(MAL, { Sophos: { category: 'undetected', result: null }, Kaspersky: { category: 'malicious', result: 'x' } }),
    );
    expect((await missed.lookup('45.33.32.156', 'ipv4')).metrics.sophos).toBe('Not detected');

    const absent = harness(virusTotal, () => vtBody(MAL, { Kaspersky: { category: 'malicious', result: 'x' } }));
    expect((await absent.lookup('45.33.32.156', 'ipv4')).metrics.sophos).toBe('Sophos did not scan this');
  });

  it('only looks at Sophos when the result is malicious', async () => {
    const results = { Sophos: { category: 'malicious', result: 'Mal/Generic-S' } };
    for (const stats of [
      { malicious: 1, suspicious: 0, harmless: 60, undetected: 30 },
      { malicious: 0, suspicious: 0, harmless: 60, undetected: 30 },
    ]) {
      const h = harness(virusTotal, () => vtBody(stats, results));
      expect((await h.lookup('8.8.8.8', 'ipv4')).metrics).not.toHaveProperty('sophos');
    }
  });

  it('understands the different ways Sophos can answer', () => {
    expect(sophosVerdict({ sophos: { category: 'harmless' } })).toBe('Not detected');
    expect(sophosVerdict({ SophosHome: { category: 'suspicious', result: 'ML/PE-A' } })).toBe('Detected: ML/PE-A');
    expect(sophosVerdict({ Sophos: { category: 'malicious' } })).toBe('Detected');
    expect(sophosVerdict({ Sophos: { category: 'timeout' } })).toBe('Sophos gave no result');
    expect(sophosVerdict({ Sophos: { category: 'type-unsupported' } })).toBe('Sophos gave no result');
    expect(sophosVerdict(undefined)).toBe('Sophos did not scan this');
  });

  it('parses detections and builds a permalink (GET only, key in header)', async () => {
    const { lookup, calls } = harness(virusTotal, () =>
      jsonResponse(200, {
        data: {
          id: '45.33.32.156',
          attributes: {
            last_analysis_stats: { malicious: 6, suspicious: 1, harmless: 60, undetected: 25, timeout: 0 },
            country: 'US',
            as_owner: 'Linode',
            reputation: -12,
            tags: ['scanner'],
          },
        },
      }),
    );
    const f = await lookup('45.33.32.156', 'ipv4');
    expect(f).toMatchObject({
      outcome: 'found',
      verdict: 'malicious',
      detections: { malicious: 6, suspicious: 1, total: 92 },
      metrics: { country: 'US', asOwner: 'Linode', reputation: -12 },
      tags: ['scanner'],
      permalink: 'https://www.virustotal.com/gui/ip-address/45.33.32.156',
    });
    expect(calls[0]!.url).toBe('https://www.virustotal.com/api/v3/ip_addresses/45.33.32.156');
    expect(calls[0]!.init.method).toBe('GET');
    expect((calls[0]!.init.headers as Record<string, string>)['x-apikey']).toBe('k3y');
  });

  it('looks URLs up by their unpadded base64url id instead of submitting them', async () => {
    const url = 'http://evil.example.com/a?b=1';
    const { lookup, calls } = harness(virusTotal, () => jsonResponse(404, { error: { code: 'NotFoundError' } }));
    const f = await lookup(url, 'url');
    expect(calls[0]!.url).toBe(`https://www.virustotal.com/api/v3/urls/${vtUrlId(url)}`);
    expect(vtUrlId(url)).not.toMatch(/[=+/]/);
    expect(calls[0]!.init.method).toBe('GET');
    expect(f).toMatchObject({ outcome: 'not_found', verdict: 'unknown' });
  });

  it('distinguishes zero detections from a missing record', async () => {
    const { lookup } = harness(virusTotal, () =>
      jsonResponse(200, {
        data: { id: 'x', attributes: { last_analysis_stats: { malicious: 0, suspicious: 0, harmless: 70, undetected: 20 } } },
      }),
    );
    expect(await lookup('example.com', 'domain')).toMatchObject({ outcome: 'found', verdict: 'no_detections' });
  });
});

describe('AbuseIPDB adapter', () => {
  it('returns the abuse confidence score', async () => {
    const { lookup, calls } = harness(abuseIpdb, () =>
      jsonResponse(200, {
        data: { abuseConfidenceScore: 100, totalReports: 812, numDistinctUsers: 140, countryCode: 'CN', isWhitelisted: false },
      }),
    );
    const f = await lookup('1.2.3.4', 'ipv4');
    expect(f).toMatchObject({ verdict: 'malicious', abuseConfidence: 100, metrics: { totalReports: 812, country: 'CN' } });
    expect(calls[0]!.url).toContain('ipAddress=1.2.3.4');
    expect((calls[0]!.init.headers as Record<string, string>).Key).toBe('k3y');
  });

  it('treats no reports as no detections, and whitelisted as benign', async () => {
    const none = harness(abuseIpdb, () => jsonResponse(200, { data: { abuseConfidenceScore: 0, totalReports: 0 } }));
    expect(await none.lookup('8.8.8.8', 'ipv4')).toMatchObject({ verdict: 'no_detections' });
    const wl = harness(abuseIpdb, () => jsonResponse(200, { data: { abuseConfidenceScore: 0, totalReports: 3, isWhitelisted: true } }));
    expect(await wl.lookup('8.8.8.8', 'ipv4')).toMatchObject({ verdict: 'benign' });
  });
});

describe('AlienVault OTX adapter', () => {
  it('reports pulses, malware families and references', async () => {
    const { lookup, calls } = harness(alienVaultOtx, () =>
      jsonResponse(200, {
        pulse_info: {
          count: 2,
          pulses: [
            { id: 'p1', name: 'Emotet C2', tags: ['emotet'], malware_families: [{ display_name: 'Emotet' }] },
            { id: 'p2', name: 'Botnet list', tags: [] },
          ],
        },
        validation: [],
      }),
    );
    const f = await lookup('bad.example.com', 'domain');
    expect(calls[0]!.url).toBe('https://otx.alienvault.com/api/v1/indicators/hostname/bad.example.com/general');
    expect(f).toMatchObject({ outcome: 'found', verdict: 'suspicious', metrics: { pulses: 2, malwareFamilies: 'Emotet' } });
    expect(f.references).toEqual([
      { title: 'Emotet C2', url: 'https://otx.alienvault.com/pulse/p1' },
      { title: 'Botnet list', url: 'https://otx.alienvault.com/pulse/p2' },
    ]);
  });

  it('uses the domain section for registrable domains and reports no pulses as not found', async () => {
    const { lookup, calls } = harness(alienVaultOtx, () => jsonResponse(200, { pulse_info: { count: 0, pulses: [] }, validation: [] }));
    expect(await lookup('example.com', 'domain')).toMatchObject({ outcome: 'not_found', verdict: 'unknown' });
    expect(calls[0]!.url).toContain('/indicators/domain/example.com/general');
  });
});

describe('URLhaus adapter', () => {
  it('queries with a POST form and the Auth-Key header (lookup only, no submission)', async () => {
    const { lookup, calls } = harness(urlhaus, () =>
      jsonResponse(200, {
        query_status: 'ok',
        url_status: 'online',
        threat: 'malware_download',
        tags: ['exe', 'AgentTesla'],
        urlhaus_reference: 'https://urlhaus.abuse.ch/url/123/',
      }),
    );
    const f = await lookup('http://bad.example/x.exe', 'url');
    expect(calls[0]!.url).toBe('https://urlhaus-api.abuse.ch/v1/url/');
    expect(calls[0]!.init.method).toBe('POST');
    expect(String(calls[0]!.init.body)).toBe('url=http%3A%2F%2Fbad.example%2Fx.exe');
    expect((calls[0]!.init.headers as Record<string, string>)['Auth-Key']).toBe('k3y');
    expect(f).toMatchObject({ verdict: 'malicious', metrics: { urlStatus: 'online' }, tags: ['exe', 'AgentTesla'] });
  });

  it('maps no_results to not found and bad keys to auth errors', async () => {
    const none = harness(urlhaus, () => jsonResponse(200, { query_status: 'no_results' }));
    expect(await none.lookup('example.com', 'domain')).toMatchObject({ outcome: 'not_found' });
    const badKey = harness(urlhaus, () => jsonResponse(200, { query_status: 'unknown_auth_key' }));
    expect((await errorOf(badKey.lookup('example.com', 'domain'))).kind).toBe('auth');
  });
});

describe('provider registry', () => {
  it('marks providers without credentials as unconfigured and never runs them', () => {
    const registry = new ProviderRegistry(loadConfig({ VIRUSTOTAL_API_KEY: 'vt', OTX_API_KEY: '  ' }));
    expect(registry.get('virustotal').state).toBe('ready');
    expect(registry.get('otx').state).toBe('unconfigured');
    expect(registry.get('abuseipdb').state).toBe('unconfigured');
    expect(registry.ready().map((r) => r.adapter.id)).toEqual(['virustotal']);
  });

  it('can disable a configured provider', () => {
    const registry = new ProviderRegistry(loadConfig({ VIRUSTOTAL_API_KEY: 'vt', PROVIDERS_DISABLED: 'virustotal' }));
    expect(registry.get('virustotal').state).toBe('disabled');
    expect(registry.ready()).toEqual([]);
  });

  it('applies per-provider rate limit overrides', () => {
    const registry = new ProviderRegistry(
      loadConfig({ VIRUSTOTAL_API_KEY: 'vt', VIRUSTOTAL_REQUESTS_PER_MINUTE: '500', VIRUSTOTAL_DAILY_LIMIT: '20000' }),
    );
    expect(registry.get('virustotal').limits).toMatchObject({ requestsPerMinute: 500, dailyLimit: 20000 });
  });

  it('never includes credentials in public provider info', () => {
    const registry = new ProviderRegistry(loadConfig({ VIRUSTOTAL_API_KEY: 'super-secret-vt-key' }));
    for (const r of registry.all()) expect(JSON.stringify(registry.info(r.adapter.id))).not.toContain('super-secret-vt-key');
  });
});
