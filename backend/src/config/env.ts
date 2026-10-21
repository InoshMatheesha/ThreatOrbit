import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export const PROVIDER_IDS = ['virustotal', 'abuseipdb', 'otx', 'urlhaus', 'greynoise', 'demo'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback)
    .transform((v) => v === 'true' || v === '1');

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const optionalPositiveInt = z.coerce.number().int().positive().optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** There is no authentication yet, so binding beyond loopback must be an explicit choice. */
  ALLOW_UNAUTHENTICATED_REMOTE: booleanString('false'),

  MAX_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  MAX_INPUT_LINES: z.coerce.number().int().positive().default(20_000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),

  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/threat_intel_hub'),
  /** Start a local MongoDB (persisted under backend/.data) when MONGODB_URI is unreachable. */
  MONGODB_EMBEDDED_FALLBACK: booleanString('true'),
  EMBEDDED_MONGODB_DIR: z.string().default('.data/mongodb'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  /** auto: BullMQ when Redis answers, otherwise the in-process development queue. */
  QUEUE_MODE: z.enum(['auto', 'bullmq', 'memory']).default('auto'),

  CACHE_TTL_HOURS: z.coerce.number().positive().default(24),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  LOOKUP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(2_000),
  RISK_RULES_PATH: z.string().optional(),
  /** Comma-separated provider ids to switch off even when a key is present. */
  PROVIDERS_DISABLED: z.string().default(''),

  VIRUSTOTAL_API_KEY: optionalSecret,
  ABUSEIPDB_API_KEY: optionalSecret,
  OTX_API_KEY: optionalSecret,
  URLHAUS_AUTH_KEY: optionalSecret,
  GREYNOISE_API_KEY: optionalSecret,

  VIRUSTOTAL_REQUESTS_PER_MINUTE: optionalPositiveInt,
  VIRUSTOTAL_DAILY_LIMIT: optionalPositiveInt,
  ABUSEIPDB_REQUESTS_PER_MINUTE: optionalPositiveInt,
  ABUSEIPDB_DAILY_LIMIT: optionalPositiveInt,
  OTX_REQUESTS_PER_MINUTE: optionalPositiveInt,
  OTX_DAILY_LIMIT: optionalPositiveInt,
  URLHAUS_REQUESTS_PER_MINUTE: optionalPositiveInt,
  URLHAUS_DAILY_LIMIT: optionalPositiveInt,
  GREYNOISE_REQUESTS_PER_MINUTE: optionalPositiveInt,
  GREYNOISE_DAILY_LIMIT: optionalPositiveInt,
});

export interface ProviderSettings {
  apiKey: string | null;
  disabled: boolean;
  requestsPerMinute?: number;
  dailyLimit?: number;
}

export type AppConfig = {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  allowUnauthenticatedRemote: boolean;
  limits: {
    maxBatchSize: number;
    maxInputLines: number;
    maxUploadBytes: number;
    apiRateLimitPerMinute: number;
  };
  database: { uri: string; embeddedFallback: boolean; embeddedDir: string };
  queue: { mode: 'auto' | 'bullmq' | 'memory'; redisUrl: string };
  enrichment: {
    cacheTtlMs: number;
    timeoutMs: number;
    maxAttempts: number;
    retryBaseDelayMs: number;
    riskRulesPath?: string;
  };
  retention: { days: number; auditDays: number };
  providers: Record<Exclude<ProviderId, 'demo'>, ProviderSettings>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const e = parsed.data;

  if (!LOOPBACK_HOSTS.has(e.HOST) && !e.ALLOW_UNAUTHENTICATED_REMOTE) {
    throw new Error(
      `HOST=${e.HOST} would expose the API beyond localhost, but authentication is not implemented yet. ` +
        'Use HOST=127.0.0.1, or set ALLOW_UNAUTHENTICATED_REMOTE=true if you accept the risk.',
    );
  }

  const disabled = new Set(
    e.PROVIDERS_DISABLED.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  const provider = (id: string, apiKey: string | null, rpm?: number, daily?: number): ProviderSettings => ({
    apiKey,
    disabled: disabled.has(id),
    ...(rpm ? { requestsPerMinute: rpm } : {}),
    ...(daily ? { dailyLimit: daily } : {}),
  });

  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    allowUnauthenticatedRemote: e.ALLOW_UNAUTHENTICATED_REMOTE,
    limits: {
      maxBatchSize: e.MAX_BATCH_SIZE,
      maxInputLines: e.MAX_INPUT_LINES,
      maxUploadBytes: e.MAX_UPLOAD_BYTES,
      apiRateLimitPerMinute: e.API_RATE_LIMIT_PER_MINUTE,
    },
    database: { uri: e.MONGODB_URI, embeddedFallback: e.MONGODB_EMBEDDED_FALLBACK, embeddedDir: e.EMBEDDED_MONGODB_DIR },
    queue: { mode: e.QUEUE_MODE, redisUrl: e.REDIS_URL },
    enrichment: {
      cacheTtlMs: e.CACHE_TTL_HOURS * 3_600_000,
      timeoutMs: e.PROVIDER_TIMEOUT_MS,
      maxAttempts: e.LOOKUP_MAX_ATTEMPTS,
      retryBaseDelayMs: e.RETRY_BASE_DELAY_MS,
      ...(e.RISK_RULES_PATH ? { riskRulesPath: e.RISK_RULES_PATH } : {}),
    },
    retention: { days: e.RETENTION_DAYS, auditDays: e.AUDIT_RETENTION_DAYS },
    providers: {
      virustotal: provider('virustotal', e.VIRUSTOTAL_API_KEY, e.VIRUSTOTAL_REQUESTS_PER_MINUTE, e.VIRUSTOTAL_DAILY_LIMIT),
      abuseipdb: provider('abuseipdb', e.ABUSEIPDB_API_KEY, e.ABUSEIPDB_REQUESTS_PER_MINUTE, e.ABUSEIPDB_DAILY_LIMIT),
      otx: provider('otx', e.OTX_API_KEY, e.OTX_REQUESTS_PER_MINUTE, e.OTX_DAILY_LIMIT),
      urlhaus: provider('urlhaus', e.URLHAUS_AUTH_KEY, e.URLHAUS_REQUESTS_PER_MINUTE, e.URLHAUS_DAILY_LIMIT),
      greynoise: provider('greynoise', e.GREYNOISE_API_KEY, e.GREYNOISE_REQUESTS_PER_MINUTE, e.GREYNOISE_DAILY_LIMIT),
    },
  };
}
