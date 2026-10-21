import type { AppConfig, ProviderId } from '../config/env.js';
import type { IndicatorType } from '../parser/types.js';
import { abuseIpdb } from './adapters/abuseipdb.js';
import { alienVaultOtx } from './adapters/otx.js';
import { urlhaus } from './adapters/urlhaus.js';
import { virusTotal } from './adapters/virustotal.js';
import { createProviderHttp, type FetchLike } from './http.js';
import type { ProviderAdapter, ProviderHttp, ProviderLimits } from './types.js';

export const ADAPTERS: readonly ProviderAdapter[] = [virusTotal, abuseIpdb, alienVaultOtx, urlhaus];

export type ProviderState = 'ready' | 'unconfigured' | 'disabled';

export interface ProviderRuntime {
  adapter: ProviderAdapter;
  state: ProviderState;
  apiKey: string | null;
  limits: ProviderLimits;
  http: ProviderHttp;
}

/** Public, secret-free description of a provider. */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  description: string;
  supports: readonly IndicatorType[];
  state: ProviderState;
  credentialEnv: string | null;
  signupUrl: string;
  limits: ProviderLimits;
}

export class ProviderRegistry {
  private readonly runtimes = new Map<ProviderId, ProviderRuntime>();

  constructor(config: AppConfig, fetchImpl?: FetchLike, adapters: readonly ProviderAdapter[] = ADAPTERS) {
    for (const adapter of adapters) {
      const settings = config.providers[adapter.id];
      const apiKey = settings.apiKey;
      const state: ProviderState = settings.disabled ? 'disabled' : apiKey ? 'ready' : 'unconfigured';
      this.runtimes.set(adapter.id, {
        adapter,
        state,
        apiKey,
        limits: {
          requestsPerMinute: settings.requestsPerMinute ?? adapter.defaultLimits.requestsPerMinute,
          dailyLimit: settings.dailyLimit ?? adapter.defaultLimits.dailyLimit,
          concurrency: adapter.defaultLimits.concurrency,
        },
        http: createProviderHttp({
          providerName: adapter.name,
          allowedHosts: adapter.allowedHosts,
          timeoutMs: config.enrichment.timeoutMs,
          ...(fetchImpl ? { fetchImpl } : {}),
        }),
      });
    }
  }

  get(id: ProviderId): ProviderRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`Unknown provider ${id}`);
    return runtime;
  }

  all(): ProviderRuntime[] {
    return [...this.runtimes.values()];
  }

  /** Providers a new batch will use: every one that is configured and enabled. */
  ready(): ProviderRuntime[] {
    return this.all().filter((r) => r.state === 'ready');
  }

  info(id: ProviderId): ProviderInfo {
    const { adapter, state, limits } = this.get(id);
    return {
      id: adapter.id,
      name: adapter.name,
      description: adapter.description,
      supports: adapter.supports,
      state,
      credentialEnv: adapter.credentialEnv,
      signupUrl: adapter.signupUrl,
      limits,
    };
  }
}
