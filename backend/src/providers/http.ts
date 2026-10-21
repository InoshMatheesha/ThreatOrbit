import { ProviderError, type HttpResponse, type ProviderHttp } from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderHttpOptions {
  providerName: string;
  allowedHosts: readonly string[];
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

function parseRetryAfter(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/**
 * HTTP client for one provider. Enforces https + host allowlist (so indicator
 * values can never redirect a request elsewhere), a hard timeout, no redirects,
 * and turns transport and HTTP failures into typed ProviderErrors.
 *
 * 404 is returned to the adapter, which decides whether it means "no record".
 */
export function createProviderHttp(options: ProviderHttpOptions): ProviderHttp {
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const name = options.providerName;

  return {
    async request(url, init = {}) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || !options.allowedHosts.includes(target.hostname)) {
        throw new ProviderError('invalid_request', `Refusing request to non-allowlisted host ${target.hostname}`);
      }

      const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
      let body: string | undefined;
      if (init.form) {
        body = new URLSearchParams(init.form).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      let res: Response;
      try {
        res = await fetchImpl(target.toString(), {
          method: init.method ?? 'GET',
          headers,
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') {
          throw new ProviderError('timeout', `${name} did not respond within ${Math.round(options.timeoutMs / 1000)}s`);
        }
        throw new ProviderError('network', `Could not reach ${name}: ${e.message}`);
      }

      const text = await res.text().catch(() => '');
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      const response: HttpResponse = { status: res.status, headers: res.headers, body: parsed };

      if (res.ok || res.status === 404) return response;
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError('auth', `${name} rejected the API key (HTTP ${res.status})`, { httpStatus: res.status });
      }
      if (res.status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers);
        throw new ProviderError('rate_limited', `${name} rate limit hit (HTTP 429)`, {
          httpStatus: 429,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        });
      }
      if (res.status >= 500) {
        throw new ProviderError('provider_error', `${name} server error (HTTP ${res.status})`, { httpStatus: res.status });
      }
      throw new ProviderError('invalid_request', `${name} rejected the request (HTTP ${res.status})`, { httpStatus: res.status });
    },
  };
}
