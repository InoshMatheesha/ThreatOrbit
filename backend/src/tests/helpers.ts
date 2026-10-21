import { pino } from 'pino';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { DEFAULT_RISK_RULES } from '../config/riskRules.js';
import { demoProvider } from '../providers/adapters/demo.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { ProviderAdapter, ProviderFinding } from '../providers/types.js';
import type { ProviderId } from '../config/env.js';
import type { IndicatorType } from '../parser/types.js';
import { MemoryLookupQueue } from '../queue/memoryQueue.js';
import { EnrichmentService } from '../services/enrichmentService.js';

export const silentLogger = pino({ level: 'silent' });

export function testApp(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...env });
  return { app: createApp(config, silentLogger), config };
}

export type LookupImpl = (indicator: { value: string; type: IndicatorType }) => Promise<ProviderFinding>;

export function finding(overrides: Partial<ProviderFinding> = {}): ProviderFinding {
  return { outcome: 'found', verdict: 'no_detections', summary: 'ok', metrics: {}, tags: [], references: [], ...overrides };
}

/** A provider adapter whose behaviour is fully controlled by the test. Counts its calls. */
export function fakeAdapter(
  id: Exclude<ProviderId, 'demo'>,
  supports: IndicatorType[],
  impl: LookupImpl,
  limits: Partial<ProviderAdapter['defaultLimits']> = {},
) {
  const calls: string[] = [];
  const adapter: ProviderAdapter & { calls: string[]; impl: LookupImpl } = {
    id,
    name: `Fake ${id}`,
    description: 'test double',
    supports,
    credentialEnv: null,
    signupUrl: '',
    allowedHosts: [],
    defaultLimits: { requestsPerMinute: 10_000, dailyLimit: null, concurrency: 4, ...limits },
    probe: { value: '8.8.8.8', type: 'ipv4' },
    calls,
    impl,
    lookup(indicator) {
      calls.push(indicator.value);
      return adapter.impl(indicator);
    },
  };
  return adapter;
}

export async function enrichmentHarness(adapters: ProviderAdapter[], env: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    VIRUSTOTAL_API_KEY: 'test-vt-key-SECRET',
    ABUSEIPDB_API_KEY: 'test-abuse-key-SECRET',
    RETRY_BASE_DELAY_MS: '5',
    ...env,
  });
  const registry = new ProviderRegistry(config, undefined, [...adapters, demoProvider]);
  const queue = new MemoryLookupQueue();
  const service = new EnrichmentService({ config, logger: silentLogger, registry, queue, rules: DEFAULT_RISK_RULES });
  await service.start({ background: false });
  const app = createApp(config, silentLogger, { enrichment: service, databaseMode: 'external' });
  return { config, registry, queue, service, app };
}

export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
