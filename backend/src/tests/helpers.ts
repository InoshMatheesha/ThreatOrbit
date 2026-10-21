import { pino } from 'pino';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';

export function testApp(env: Record<string, string> = {}) {
  const config = loadConfig({ NODE_ENV: 'test', ...env });
  return { app: createApp(config, pino({ level: 'silent' })), config };
}
