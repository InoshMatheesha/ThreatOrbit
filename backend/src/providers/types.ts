import type { ProviderId } from '../config/env.js';
import type { IndicatorType } from '../parser/types.js';

/** A provider's own reading of an indicator. Never "clean": absence of evidence is `no_detections`. */
export type Verdict = 'malicious' | 'suspicious' | 'no_detections' | 'benign' | 'unknown';

/** `found`: the provider has a record. `not_found`: it has no record (not the same as clean). */
export type LookupOutcome = 'found' | 'not_found';

export type ErrorKind =
  'timeout' | 'rate_limited' | 'quota_exhausted' | 'auth' | 'provider_error' | 'network' | 'invalid_request' | 'interrupted';

const RETRYABLE: ReadonlySet<ErrorKind> = new Set(['timeout', 'rate_limited', 'provider_error', 'network', 'interrupted']);

export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly options: { retryAfterMs?: number; httpStatus?: number } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function isRetryableKind(kind: ErrorKind): boolean {
  return RETRYABLE.has(kind);
}

export interface Detections {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  total: number;
}

export interface Reference {
  title: string;
  url: string;
}

export interface ProviderFinding {
  outcome: LookupOutcome;
  verdict: Verdict;
  /** One line a human can read in a table cell. */
  summary: string;
  detections?: Detections;
  abuseConfidence?: number;
  /** Provider-specific facts (country, ASN, pulse count, URL status, ...). Flat and display-ready. */
  metrics: Record<string, string | number | boolean | null>;
  tags: string[];
  references: Reference[];
  permalink?: string;
}

export interface IndicatorRef {
  value: string;
  type: IndicatorType;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface ProviderHttp {
  request(
    url: string,
    init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; form?: Record<string, string> },
  ): Promise<HttpResponse>;
}

export interface LookupContext {
  apiKey: string;
  http: ProviderHttp;
}

export interface ProviderLimits {
  requestsPerMinute: number;
  /** Local guard for the provider's daily quota. null when the provider documents none. */
  dailyLimit: number | null;
  concurrency: number;
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  description: string;
  supports: readonly IndicatorType[];
  /** Environment variable holding the credential (never sent to the frontend). */
  credentialEnv: string | null;
  signupUrl: string;
  /** Outbound requests are restricted to these hosts (SSRF guard). */
  allowedHosts: readonly string[];
  defaultLimits: ProviderLimits;
  /** Indicator used by the "test key" action. */
  probe: IndicatorRef;
  lookup(indicator: IndicatorRef, ctx: LookupContext): Promise<ProviderFinding>;
}
