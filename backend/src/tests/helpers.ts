import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { DEFAULT_RISK_RULES } from '../config/riskRules.js';
import { ProviderRegistry } from '../providers/registry.js';
import type { ProviderAdapter, ProviderFinding } from '../providers/types.js';
import type { ProviderId } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { User, type Role } from '../models/User.js';
import type { IndicatorType } from '../parser/types.js';
import { MemoryLookupQueue } from '../queue/memoryQueue.js';
import { AiService, type AiClient } from '../services/aiService.js';
import { AuthService, toPrincipal, type Principal } from '../services/authService.js';
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
  id: ProviderId,
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

export async function enrichmentHarness(adapters: ProviderAdapter[], env: Record<string, string> = {}, aiClient?: AiClient) {
  const config = loadConfig({
    NODE_ENV: 'test',
    VIRUSTOTAL_API_KEY: 'test-vt-key-SECRET',
    ABUSEIPDB_API_KEY: 'test-abuse-key-SECRET',
    RETRY_BASE_DELAY_MS: '5',
    ...env,
  });
  const registry = new ProviderRegistry(config, undefined, adapters);
  const queue = new MemoryLookupQueue();
  const service = new EnrichmentService({ config, logger: silentLogger, registry, queue, rules: DEFAULT_RISK_RULES });
  await service.start({ background: false });
  const auth = new AuthService(config, silentLogger);
  const ai = new AiService({ config, logger: silentLogger, ...(aiClient ? { client: aiClient } : {}) });
  const app = createApp(config, silentLogger, { enrichment: service, auth, databaseMode: 'external', ai });
  return { config, registry, queue, service, auth, app };
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

/** Create a user directly in the database. */
export async function createUser(
  role: Role = 'analyst',
  email = `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
): Promise<Principal> {
  const user = await User.create({
    email,
    name: role === 'admin' ? 'Ada Admin' : 'Ana Analyst',
    role,
    passwordHash: await hashPassword(TEST_PASSWORD),
    passwordChangedAt: new Date(Date.now() - 1000),
  });
  return toPrincipal(user);
}

/** A supertest agent signed in as a new user with the given role (cookies persist across requests). */
export async function signedInAgent(
  app: Parameters<typeof request.agent>[0],
  role: Role = 'analyst',
): Promise<{ agent: ReturnType<typeof request.agent>; user: Principal }> {
  const user = await createUser(role);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: TEST_PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}

export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}
