import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiClientError, createAnthropicClient } from '../services/aiService.js';

const config = { apiKey: 'sk-ant-test-key', model: 'claude-opus-5-5', dailyLimit: 10 };
const request = { system: 'sys', prompt: 'hello', schema: { type: 'object', additionalProperties: false, properties: {}, required: [] } };

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text: '{"ok":true}' },
    ],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

function stubFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('Anthropic client', () => {
  it('sends a schema-constrained, low-effort request with the server-side fallback and returns only the text', async () => {
    const calls = stubFetch(200, message());
    const result = await createAnthropicClient(config).generate(request);
    expect(result).toEqual({ text: '{"ok":true}', model: 'claude-opus-5-5' });

    const call = calls[0]!;
    expect(call.url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    const headers = new Headers(call.init.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-ant-test-key');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    const body = JSON.parse(String(call.init.body));
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
    });
    // Options removed on current models must never be sent.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
    expect(body.max_tokens).toBeGreaterThan(1000);
  });

  it.each([
    [200, message({ stop_reason: 'refusal', content: [] }), 'refused'],
    [200, message({ stop_reason: 'max_tokens' }), 'truncated'],
    [401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'rejected_key'],
    [429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'busy'],
    [400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } }, 'failed'],
  ])('maps a %i response to "%#" failure kinds', async (status, body, kind) => {
    stubFetch(status, body);
    const err = await createAnthropicClient({ ...config })
      .generate(request)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiClientError);
    expect((err as AiClientError).kind).toBe(kind);
  });
});
