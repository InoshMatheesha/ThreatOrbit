import { z } from 'zod';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** There is no authentication yet, so binding beyond loopback must be an explicit choice. */
  ALLOW_UNAUTHENTICATED_REMOTE: booleanString,

  MAX_BATCH_SIZE: z.coerce.number().int().positive().default(500),
  MAX_INPUT_LINES: z.coerce.number().int().positive().default(20_000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
});

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
  };
}
