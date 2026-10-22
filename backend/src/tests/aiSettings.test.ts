import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuditEvent, Setting } from '../models/index.js';
import { AiClientError, type AiClient, type AiSettings, type ClientFactory } from '../services/aiService.js';
import { useTestDatabase } from './db.js';
import { enrichmentHarness, fakeAdapter, finding, signedInAgent } from './helpers.js';

useTestDatabase();

const KEY = 'AIza-secret-gemini-key-9876';

function fakeFactory(options: { models?: string[]; reject?: boolean } = {}) {
  const built: AiSettings[] = [];
  const factory: ClientFactory = (settings) => {
    built.push(settings);
    const client: AiClient = {
      async listModels() {
        if (options.reject || settings.apiKey.startsWith('bad')) throw new AiClientError('rejected_key', 'API key not valid');
        return (options.models ?? ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']).map((id) => ({ id, name: id }));
      },
      async generate() {
        return {
          text: JSON.stringify({
            headline: 'Written by the saved key',
            whatIsIt: 'x',
            whyItMatters: 'y',
            confidence: 'low',
            nextSteps: [],
          }),
          model: settings.model,
        };
      },
    };
    return client;
  };
  return { factory, built };
}

async function setup(options: Parameters<typeof fakeFactory>[0] = {}) {
  const f = fakeFactory(options);
  const h = await enrichmentHarness([fakeAdapter('virustotal', ['ipv4'], async () => finding())], {}, { factory: f.factory });
  const admin = await signedInAgent(h.app, 'admin');
  const analyst = await signedInAgent(h.app, 'analyst');
  return { ...f, h, admin: admin.agent, analyst: analyst.agent };
}

describe('AI settings', () => {
  it('is for administrators only', async () => {
    const { analyst, h } = await setup();
    expect((await analyst.get('/api/settings/ai')).status).toBe(403);
    expect((await analyst.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY })).status).toBe(403);
    expect((await analyst.delete('/api/settings/ai')).status).toBe(403);
    expect((await request(h.app).get('/api/settings/ai')).status).toBe(401);
  });

  it('checks the key, picks the best free-tier model, stores it, and never sends the key back', async () => {
    const { admin, built } = await setup();
    const before = await admin.get('/api/settings/ai');
    expect(before.body.data).toMatchObject({ configured: false, provider: null, keyHint: null });
    expect(before.body.data.providers.map((p: { id: string }) => p.id)).toEqual(['gemini', 'anthropic']);

    const saved = await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data).toMatchObject({
      configured: true,
      source: 'database',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      keyHint: '...9876',
      updatedBy: 'Ada Admin',
    });
    expect(JSON.stringify(saved.body)).not.toContain(KEY);
    expect(built.some((s) => s.apiKey === KEY && s.provider === 'gemini')).toBe(true);

    const stored = await Setting.findById('ai').lean();
    expect(stored?.value).toMatchObject({ provider: 'gemini', apiKey: KEY, model: 'gemini-2.5-flash' });

    expect(JSON.stringify((await admin.get('/api/settings/ai')).body)).not.toContain(KEY);
    expect(JSON.stringify((await admin.get('/api/health')).body)).not.toContain(KEY);
    const event = await AuditEvent.findOne({ action: 'settings.ai_update' }).lean();
    expect(event).toMatchObject({ details: { provider: 'gemini', model: 'gemini-2.5-flash' } });
    expect(JSON.stringify(event)).not.toContain(KEY);
  });

  it('shows everyone the provider and model in use, but not who set it up or the key', async () => {
    const { admin, analyst } = await setup();
    await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY });
    const health = await analyst.get('/api/health');
    expect(health.body.data.ai).toEqual({
      enabled: true,
      provider: 'gemini',
      providerName: 'Google Gemini',
      model: 'gemini-2.5-flash',
      dailyLimit: 100,
    });
    expect(JSON.stringify(health.body)).not.toContain(KEY);
  });

  it('refuses a key the provider rejects and keeps what was saved before', async () => {
    const { admin } = await setup();
    await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY });
    const res = await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: 'bad-key-12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/rejected this key/);
    expect((await Setting.findById('ai').lean())?.value).toMatchObject({ apiKey: KEY });
  });

  it('changes only the model without asking for the key again, and rejects unknown models', async () => {
    const { admin } = await setup();
    await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY });
    const changed = await admin.put('/api/settings/ai').send({ provider: 'gemini', model: 'gemini-2.5-flash-lite' });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body.data).toMatchObject({ model: 'gemini-2.5-flash-lite', keyHint: '...9876' });
    expect((await Setting.findById('ai').lean())?.value).toMatchObject({ apiKey: KEY, model: 'gemini-2.5-flash-lite' });

    const unknown = await admin.put('/api/settings/ai').send({ provider: 'gemini', model: 'gemini-9-ultra' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toMatch(/not available for this key/);

    const switched = await admin.put('/api/settings/ai').send({ provider: 'anthropic' });
    expect(switched.status).toBe(400); // a different provider needs its own key
    expect(switched.body.error.message).toMatch(/Paste an API key/);
  });

  it('lists the models the saved key can use', async () => {
    const { admin } = await setup();
    expect((await admin.get('/api/settings/ai/models')).status).toBe(503);
    await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY });
    const models = await admin.get('/api/settings/ai/models');
    expect(models.body.data.map((m: { id: string }) => m.id)).toContain('gemini-2.5-flash');
  });

  it('writes explanations with the saved key, and stops when it is removed', async () => {
    const { admin, h, built } = await setup();
    const created = await admin.post('/api/batches').send({ text: '8.8.8.8', acknowledgeThirdPartySharing: true });
    expect(created.status).toBe(201);
    await h.queue.idle();
    const id = created.body.data.id as string;

    const off = await admin.post(`/api/batches/${id}/items/0/explanation`).send({});
    expect(off.status).toBe(503);
    expect(off.body.error.message).toMatch(/under Sources/);

    await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY });
    const on = await admin.post(`/api/batches/${id}/items/0/explanation`).send({});
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body.data.explanation.headline).toBe('Written by the saved key');
    expect(on.body.data.model).toBe('gemini-2.5-flash');
    expect(built.filter((s) => s.apiKey === KEY).length).toBeGreaterThan(0);

    const removed = await admin.delete('/api/settings/ai');
    expect(removed.body.data).toMatchObject({ configured: false });
    expect(await Setting.findById('ai').lean()).toBeNull();
    expect((await admin.post(`/api/batches/${id}/items/0/explanation`).send({ refresh: true })).status).toBe(503);
    expect(await AuditEvent.countDocuments({ action: 'settings.ai_remove' })).toBe(1);
  });

  it('validates the request body', async () => {
    const { admin } = await setup();
    expect((await admin.put('/api/settings/ai').send({ provider: 'openai', apiKey: KEY })).status).toBe(400);
    expect((await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: 'short' })).status).toBe(400);
    expect((await admin.put('/api/settings/ai').send({ provider: 'gemini', apiKey: KEY, extra: 1 })).status).toBe(400);
  });
});
