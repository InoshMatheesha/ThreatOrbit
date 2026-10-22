import { AiClientError, type AiClient, type AiModelInfo, type AiRequest } from './aiClient.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = 40_000;
const MAX_OUTPUT_TOKENS = 8192;

/** Gemini wants an OpenAPI-style schema: upper-case types and no `additionalProperties`. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'additionalProperties') continue;
    out[key] = key === 'type' && typeof value === 'string' ? value.toUpperCase() : toGeminiSchema(value);
  }
  return out;
}

// Preview, experimental and special-purpose models are not what we want for a written summary.
const SKIP = /preview|exp|image|tts|live|audio|embed|robotics|computer|thinking|gemma|vision|aqa|learnlm/i;

const versionOf = (id: string) => Number(/^gemini-(\d+(?:\.\d+)?)-/.exec(id)?.[1] ?? 0);

/** The newest stable Flash model: free-tier friendly, fast, and good at short plain-language writing. */
export function pickDefaultGeminiModel(ids: string[]): string | null {
  const usable = ids.filter((id) => id.startsWith('gemini-') && !SKIP.test(id));
  const newest = (re: RegExp) => usable.filter((id) => re.test(id)).sort((a, b) => versionOf(b) - versionOf(a))[0];
  return newest(/^gemini-[\d.]+-flash$/) ?? newest(/^gemini-[\d.]+-flash-lite$/) ?? usable[0] ?? null;
}

interface GeminiError {
  error?: { code?: number; status?: string; message?: string; details?: Array<{ reason?: string }> };
}

/** Turn an HTTP failure into a kind the app can explain. The message never contains the API key. */
function failure(status: number, body: GeminiError | null): AiClientError {
  const message = body?.error?.message ?? `HTTP ${status}`;
  const reason = body?.error?.details?.find((d) => d.reason)?.reason;
  if (
    reason === 'API_KEY_INVALID' ||
    /api key not valid|api key expired|invalid api key/i.test(message) ||
    status === 401 ||
    status === 403
  ) {
    return new AiClientError('rejected_key', message, status);
  }
  if (status === 429) return new AiClientError('busy', message, status);
  if (status === 404) return new AiClientError('bad_model', message, status);
  return new AiClientError('failed', message, status);
}

async function call(url: string, apiKey: string, init: { method: 'GET' } | { method: 'POST'; body: unknown }) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method,
      headers: { 'x-goog-api-key': apiKey, ...(init.method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
    });
  } catch (err) {
    throw new AiClientError('failed', `Could not reach Gemini: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => null)) as (GeminiError & Record<string, unknown>) | null;
  if (!res.ok) throw failure(res.status, body);
  return body ?? {};
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

export function createGeminiClient({ apiKey, model }: { apiKey: string; model: string }): AiClient {
  return {
    async generate({ system, prompt, schema }: AiRequest) {
      const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;
      const body = (withSchema: boolean) => ({
        // The schema is also spelled out in words, so a model or API version that ignores responseSchema still complies.
        systemInstruction: {
          parts: [{ text: `${system}\n\nReply with a single JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}` }],
        },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          ...(withSchema ? { responseSchema: toGeminiSchema(schema) } : {}),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });

      let json: GenerateResponse;
      try {
        json = (await call(url, apiKey, { method: 'POST', body: body(true) })) as GenerateResponse;
      } catch (err) {
        // A schema the API rejects (it supports only part of JSON Schema) should not take the feature down.
        if (
          err instanceof AiClientError &&
          err.kind === 'failed' &&
          err.status === 400 &&
          /schema|response_?schema|generation_?config/i.test(err.message)
        ) {
          json = (await call(url, apiKey, { method: 'POST', body: body(false) })) as GenerateResponse;
        } else {
          throw err;
        }
      }

      if (json.promptFeedback?.blockReason) throw new AiClientError('refused', `Blocked: ${json.promptFeedback.blockReason}`);
      const candidate = json.candidates?.[0];
      const reason = candidate?.finishReason;
      if (reason === 'MAX_TOKENS') throw new AiClientError('truncated', 'The model ran out of room');
      if (reason && reason !== 'STOP') throw new AiClientError('refused', `Stopped: ${reason}`);
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('');
      if (!text.trim()) throw new AiClientError('failed', 'Gemini returned no text');
      return { text, model: json.modelVersion ?? model };
    },

    async listModels(): Promise<AiModelInfo[]> {
      const json = (await call(`${BASE}/models?pageSize=200`, apiKey, { method: 'GET' })) as {
        models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      };
      return (json.models ?? [])
        .filter((m) => m.name?.startsWith('models/gemini-') && m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => ({ id: m.name!.slice('models/'.length), name: m.displayName ?? m.name!.slice('models/'.length) }));
    },
  };
}
