import type { Detections } from './types.js';

export type Json = Record<string, unknown>;

export function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function strings(value: unknown, limit = 25): string[] {
  return arr(value)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .slice(0, limit);
}

export function unixToIso(value: unknown): string | null {
  const n = num(value);
  return n ? new Date(n * 1000).toISOString() : null;
}

export function detectionsFrom(stats: Json): Detections {
  const malicious = num(stats.malicious) ?? 0;
  const suspicious = num(stats.suspicious) ?? 0;
  const harmless = num(stats.harmless) ?? 0;
  const undetected = num(stats.undetected) ?? 0;
  const timeout = num(stats.timeout) ?? 0;
  return { malicious, suspicious, harmless, undetected, total: malicious + suspicious + harmless + undetected + timeout };
}

/** Drop null/undefined so metrics stay compact. */
export function compact(metrics: Record<string, string | number | boolean | null | undefined>) {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(metrics)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return out;
}
