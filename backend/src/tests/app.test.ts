import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { loadConfig } from '../config/env.js';
import { testApp } from './helpers.js';

describe('app', () => {
  it('GET /api/health reports ok', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', service: 'threat-intel-hub' });
  });

  it('sets security headers and hides the framework', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('returns a consistent 404 for unknown API routes', async () => {
    const { app } = testApp();
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rate limits the API', async () => {
    const { app } = testApp({ API_RATE_LIMIT_PER_MINUTE: '3' });
    for (let i = 0; i < 3; i++) expect((await request(app).get('/api/health')).status).toBe(200);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('never echoes provider secrets from the environment in API responses', async () => {
    const secret = 'sk-test-SECRET-should-never-leak-123';
    const { app } = testApp({ VIRUSTOTAL_API_KEY: secret, ABUSEIPDB_API_KEY: secret, OTX_API_KEY: secret });
    const responses = await Promise.all([
      request(app).get('/api/health'),
      request(app).post('/api/batches/preview').send({ text: `8.8.8.8\n${secret}` }),
      request(app).post('/api/batches/preview').send({ text: 'x', bogus: secret }),
      request(app).get('/api/missing'),
    ]);
    for (const res of responses) {
      // The only acceptable occurrence is the analyst's own submitted text echoed back as `original`.
      const body = JSON.stringify(res.body).replaceAll(`"original":"${secret}"`, '');
      expect(body).not.toContain(secret);
    }
  });
});

describe('config', () => {
  it('defaults to loopback and the documented limits', () => {
    const config = loadConfig({});
    expect(config.host).toBe('127.0.0.1');
    expect(config.limits).toMatchObject({ maxBatchSize: 500, maxUploadBytes: 2 * 1024 * 1024 });
  });

  it('refuses to bind beyond localhost without authentication unless explicitly allowed', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(/authentication is not implemented/);
    expect(loadConfig({ HOST: '0.0.0.0', ALLOW_UNAUTHENTICATED_REMOTE: 'true' }).host).toBe('0.0.0.0');
  });

  it('rejects invalid values with a clear message', () => {
    expect(() => loadConfig({ MAX_BATCH_SIZE: '-1' })).toThrow(/MAX_BATCH_SIZE/);
  });
});

describe('frontend hosting', () => {
  it('serves the built UI and falls back to index.html, without shadowing API errors', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tih-ui-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    const app = createApp(loadConfig({ NODE_ENV: 'test' }), pino({ level: 'silent' }), { staticDir: dir });

    const root = await request(app).get('/');
    expect(root.status).toBe(200);
    expect(root.text).toContain('id="root"');
    expect((await request(app).get('/batches/123')).text).toContain('id="root"');
    const api = await request(app).get('/api/unknown');
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
