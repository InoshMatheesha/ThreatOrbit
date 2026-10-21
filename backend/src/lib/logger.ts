import { pino, type Logger } from 'pino';

/**
 * Structured logger. Redacts anything that looks like a credential; request
 * logging records the path only, never query strings (which can carry IOCs or tokens).
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        '*.apiKey',
        '*.api_key',
        '*.password',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
