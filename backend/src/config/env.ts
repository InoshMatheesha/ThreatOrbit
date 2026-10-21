import { z } from 'zod';

export const PROVIDER_IDS = ['virustotal', 'abuseipdb', 'otx', 'urlhaus'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

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
  /** Number of reverse proxies in front of the app (e.g. 2 for Vercel -> Render). 0 when exposed directly. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Comma-separated origins allowed to make state-changing requests. Empty: same host only. */
  ALLOWED_ORIGINS: z.string().default(''),

  SESSION_TTL_HOURS: z.coerce
    .number()
    .positive()
    .max(24 * 30)
    .default(12),
  /** Send the session cookie over HTTPS only. Defaults to true in production. */
  COOKIE_SECURE: z.enum(['true', 'false', '1', '0']).optional(),
  /** Bootstrap: creates this admin account on startup when no users exist yet. */
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().max(80).default('Administrator'),

  MAX_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  MAX_INPUT_LINES: z.coerce.number().int().positive().default(20_000),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),

  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/threat_intel_hub'),
  /** Start a local MongoDB (persisted under backend/.data) when MONGODB_URI is unreachable. Development only by default. */
  MONGODB_EMBEDDED_FALLBACK: z.enum(['true', 'false', '1', '0']).optional(),
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

  VIRUSTOTAL_REQUESTS_PER_MINUTE: optionalPositiveInt,
  VIRUSTOTAL_DAILY_LIMIT: optionalPositiveInt,
  ABUSEIPDB_REQUESTS_PER_MINUTE: optionalPositiveInt,
  ABUSEIPDB_DAILY_LIMIT: optionalPositiveInt,
  OTX_REQUESTS_PER_MINUTE: optionalPositiveInt,
  OTX_DAILY_LIMIT: optionalPositiveInt,
  URLHAUS_REQUESTS_PER_MINUTE: optionalPositiveInt,
  URLHAUS_DAILY_LIMIT: optionalPositiveInt,
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
  trustProxy: number;
  allowedOrigins: string[];
  auth: {
    sessionTtlMs: number;
    cookieSecure: boolean;
    bootstrapAdmin: { email: string; password: string; name: string } | null;
  };
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
  providers: Record<ProviderId, ProviderSettings>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  const e = parsed.data;

  if ((e.ADMIN_EMAIL && !e.ADMIN_PASSWORD) || (!e.ADMIN_EMAIL && e.ADMIN_PASSWORD)) {
    throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD (or neither)');
  }
  if (e.ADMIN_PASSWORD && e.ADMIN_PASSWORD.length < 12) {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters');
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
    trustProxy: e.TRUST_PROXY,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    auth: {
      sessionTtlMs: e.SESSION_TTL_HOURS * 3_600_000,
      cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' || e.COOKIE_SECURE === '1' : e.NODE_ENV === 'production',
      bootstrapAdmin:
        e.ADMIN_EMAIL && e.ADMIN_PASSWORD ? { email: e.ADMIN_EMAIL.toLowerCase(), password: e.ADMIN_PASSWORD, name: e.ADMIN_NAME } : null,
    },
    limits: {
      maxBatchSize: e.MAX_BATCH_SIZE,
      maxInputLines: e.MAX_INPUT_LINES,
      maxUploadBytes: e.MAX_UPLOAD_BYTES,
      apiRateLimitPerMinute: e.API_RATE_LIMIT_PER_MINUTE,
    },
    database: {
      uri: e.MONGODB_URI,
      embeddedFallback: e.MONGODB_EMBEDDED_FALLBACK
        ? e.MONGODB_EMBEDDED_FALLBACK === 'true' || e.MONGODB_EMBEDDED_FALLBACK === '1'
        : e.NODE_ENV !== 'production',
      embeddedDir: e.EMBEDDED_MONGODB_DIR,
    },
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
    },
  };
}
