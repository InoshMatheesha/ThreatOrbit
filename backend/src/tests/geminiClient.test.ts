import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiClientError } from '../services/aiClient.js';
import { createGeminiClient, pickDefaultGeminiModel, toGeminiSchema } from '../services/geminiClient.js';

const request = {
  system: 'sys',
  prompt: 'hello',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['a'],
    properties: { a: { type: 'string' }, c: { type: 'string', enum: ['x', 'y'] }, l: { type: 'array', items: { type: 'string' } } },
  },
};

function ok(overrides: Record<string, unknown> = {}) {
  return {
    candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"a":"b"}' }] }, finishReason: 'STOP' }],
    modelVersion: 'gemini-2.5-flash',
    ...overrides,
  };
}

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Gemini client', () => {
  it('sends the key in a header (never the URL), asks for JSON in the schema, and ignores thinking text', async () => {
    const calls = stubFetch([{ status: 200, body: ok() }]);
    const result = await createGeminiClient({ apiKey: 'AIza-test-key-123', model: 'gemini-2.5-flash' }).generate(request);
    expect(result).toEqual({ text: '{"a":"b"}', model: 'gemini-2.5-flash' });

    const call = calls[0]!;
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(call.url).not.toContain('AIza');
    expect(new Headers(call.init.headers).get('x-goog-api-key')).toBe('AIza-test-key-123');
    const body = JSON.parse(String(call.init.body));
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    expect(body.systemInstruction.parts[0].text).toContain('sys');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toEqual({
      type: 'OBJECT',
      required: ['a'],
      properties: { a: { type: 'STRING' }, c: { type: 'STRING', enum: ['x', 'y'] }, l: { type: 'ARRAY', items: { type: 'STRING' } } },
    });
  });

  it('retries once without responseSchema when the API rejects the schema', async () => {
    const calls = stubFetch([
      {
        status: 400,
        body: { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid JSON payload received. Unknown name "responseSchema"' } },
      },
      { status: 200, body: ok() },
    ]);
    const result = await createGeminiClient({ apiKey: 'k-12345678', model: 'm' }).generate(request);
    expect(result.text).toBe('{"a":"b"}');
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]!.init.body)).generationConfig).not.toHaveProperty('responseSchema');
  });

  it.each([
    [200, ok({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] }), 'truncated'],
    [200, ok({ candidates: [{ finishReason: 'SAFETY' }] }), 'refused'],
    [200, { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'refused'],
    [200, ok({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] }), 'failed'],
    [
      400,
      {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'API key not valid. Please pass a valid API key.',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      },
      'rejected_key',
    ],
    [403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } }, 'rejected_key'],
    [429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }, 'busy'],
    [404, { error: { code: 404, status: 'NOT_FOUND', message: 'models/x is not found' } }, 'bad_model'],
    [503, { error: { code: 503, status: 'UNAVAILABLE', message: 'overloaded' } }, 'failed'],
  ])('maps response %i to failure kind "%#"', async (status, body, kind) => {
    stubFetch([{ status, body }]);
    const err = await createGeminiClient({ apiKey: 'k-12345678', model: 'm' })
      .generate(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe(kind);
    expect((err as AiClientError).message).not.toContain('k-12345678');
  });

  it('lists only Gemini models that can write text', async () => {
    const calls = stubFetch([
      {
        status: 200,
        body: {
          models: [
            {
              name: 'models/gemini-2.5-flash',
              displayName: 'Gemini 2.5 Flash',
              supportedGenerationMethods: ['generateContent', 'countTokens'],
            },
            { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
          ],
        },
      },
    ]);
    const models = await createGeminiClient({ apiKey: 'k-12345678', model: 'm' }).listModels!();
    expect(models).toEqual([{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' }]);
    expect(calls[0]!.url).toContain('/v1beta/models');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('reports an unreachable network as a plain failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('fetch failed'))),
    );
    const err = await createGeminiClient({ apiKey: 'k-12345678', model: 'm' })
      .generate(request)
      .catch((e: unknown) => e);
    expect((err as AiClientError).kind).toBe('failed');
  });
});

describe('Gemini helpers', () => {
  it('picks the newest stable Flash model and skips previews and special-purpose ones', () => {
    expect(
      pickDefaultGeminiModel([
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'gemini-2.5-flash',
        'gemini-3.5-flash-preview',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash-image',
        'gemini-3.1-flash',
      ]),
    ).toBe('gemini-3.1-flash');
    expect(pickDefaultGeminiModel(['gemini-2.5-pro', 'gemini-2.5-flash-lite'])).toBe('gemini-2.5-flash-lite');
    expect(pickDefaultGeminiModel(['gemini-2.5-pro'])).toBe('gemini-2.5-pro');
    expect(pickDefaultGeminiModel([])).toBeNull();
  });

  it('converts schemas without touching the input', () => {
    const input = { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } };
    expect(toGeminiSchema(input)).toEqual({ type: 'OBJECT', properties: { a: { type: 'STRING' } } });
    expect(input.additionalProperties).toBe(false);
  });
});
