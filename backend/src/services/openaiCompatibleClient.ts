import { AiClientError, type AiClient, type AiModelInfo, type AiRequest } from './aiClient.js';

const REQUEST_TIMEOUT_MS = 35_000;

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: OpenAiMessage;
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
}

interface OpenAiModelItem {
  id: string;
  name?: string;
  display_name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
}

interface OpenAiModelsResponse {
  data?: OpenAiModelItem[];
  error?: {
    message?: string;
  };
}

/** Strip markdown code block wrappers (```json ... ```) if the LLM output was formatted as markdown. */
export function cleanJsonText(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1] ? match[1].trim() : trimmed;
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerName?: string;
}

export function createOpenAiCompatibleClient(config: OpenAiCompatibleConfig): AiClient {
  const base = config.baseUrl.replace(/\/+$/, '');
  const providerLabel = config.providerName ?? 'AI provider';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${config.apiKey}`,
    // Required / recommended by OpenRouter for ranking and attribution
    'http-referer': 'https://threatorbit.app',
    'x-title': 'ThreatOrbit',
  };

  function parseError(status: number, body: OpenAiChatResponse | null): AiClientError {
    const message = body?.error?.message ?? `HTTP ${status}`;
    if (status === 401 || status === 403 || /invalid.*key|unauthorized|authentication/i.test(message)) {
      return new AiClientError('rejected_key', `${providerLabel} rejected this key: ${message}`, status);
    }
    if (status === 429 || /rate.*limit|quota|exceeded/i.test(message)) {
      return new AiClientError('busy', `${providerLabel} is busy or rate limited: ${message}`, status);
    }
    if (status === 404 || /model.*not.*found|does not exist/i.test(message)) {
      return new AiClientError('bad_model', `Model ${config.model} was not found on ${providerLabel}: ${message}`, status);
    }
    return new AiClientError('failed', `${providerLabel} error: ${message}`, status);
  }

  return {
    async generate({ system, prompt }: AiRequest) {
      const url = `${base}/chat/completions`;

      async function doCall(includeJsonFormat: boolean) {
        const body: Record<string, unknown> = {
          model: config.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
        };

        if (includeJsonFormat) {
          body.response_format = { type: 'json_object' };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const data = (await res.json().catch(() => null)) as OpenAiChatResponse | null;
        return { res, data };
      }

      let outcome: { res: Response; data: OpenAiChatResponse | null };
      try {
        outcome = await doCall(true);
      } catch (err) {
        if (err instanceof AiClientError) throw err;
        throw new AiClientError('failed', `Could not connect to ${providerLabel}: ${(err as Error).message}`);
      }

      // Some providers / models don't support response_format: { type: 'json_object' }.
      // If we get a 400 error mentioning response_format, retry without it.
      if (
        !outcome.res.ok &&
        outcome.res.status === 400 &&
        /response_format|json_object|unrecognized parameter/i.test(outcome.data?.error?.message ?? '')
      ) {
        try {
          outcome = await doCall(false);
        } catch (err) {
          throw new AiClientError('failed', `Could not connect to ${providerLabel}: ${(err as Error).message}`);
        }
      }

      if (!outcome.res.ok) {
        throw parseError(outcome.res.status, outcome.data);
      }

      const choice = outcome.data?.choices?.[0];
      const text = choice?.message?.content;
      if (!text) {
        throw new AiClientError('failed', `${providerLabel} returned an empty response`);
      }

      return {
        text: cleanJsonText(text),
        model: outcome.data?.model ?? config.model,
      };
    },

    async listModels(): Promise<AiModelInfo[]> {
      const url = `${base}/models`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 401 || res.status === 403) {
          const body = (await res.json().catch(() => null)) as OpenAiModelsResponse | null;
          throw parseError(res.status, body);
        }

        if (!res.ok) {
          // If the provider doesn't support /models, fallback to the configured model
          return [{ id: config.model, name: config.model }];
        }

        const body = (await res.json().catch(() => null)) as OpenAiModelsResponse | null;
        if (!body?.data || !Array.isArray(body.data)) {
          return [{ id: config.model, name: config.model }];
        }

        return body.data
          .map((m) => {
            const isZeroPrice =
              m.pricing &&
              (m.pricing.prompt === 0 || m.pricing.prompt === '0') &&
              (m.pricing.completion === 0 || m.pricing.completion === '0');
            const isFree = m.id.endsWith(':free') || Boolean(isZeroPrice);

            return {
              id: m.id,
              name: m.name || m.display_name || m.id,
              free: isFree,
              pricing: m.pricing,
            };
          })
          .sort((a, b) => {
            // Put free models first if any, then alphabetical
            if (a.free && !b.free) return -1;
            if (!a.free && b.free) return 1;
            return a.id.localeCompare(b.id);
          });
      } catch (err) {
        if (err instanceof AiClientError) throw err;
        return [{ id: config.model, name: config.model }];
      }
    },
  };
}
