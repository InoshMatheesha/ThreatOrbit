import fs from 'node:fs';

export type Severity = 'high' | 'medium' | 'low' | 'none';

export interface Thresholds {
  high: number;
  medium: number;
  low: number;
}

/**
 * Explainable, per-provider and per-indicator-type rules. Numbers are NOT
 * comparable across providers: an engine count, an abuse percentage and a pulse
 * count measure different things, so each gets its own scale. Override any part
 * with a JSON file referenced by RISK_RULES_PATH.
 */
export interface RiskRules {
  /** VirusTotal: number of engines reporting "malicious". */
  virustotal: { ip: Thresholds; domain: Thresholds; url: Thresholds; hash: Thresholds };
  /** AbuseIPDB: abuse confidence score (0-100). */
  abuseipdb: Thresholds;
  /** AlienVault OTX: pulses referencing the indicator. Community pulses alone never make an indicator High. */
  otx: { medium: number; low: number };
  /** URLhaus: severity for each kind of listing. */
  urlhaus: { url: Severity; payload: Severity; hostWithOnlineUrls: Severity; host: Severity };
  /** GreyNoise: scanners are opportunistic, so even "malicious" noise is capped below High by default. */
  greynoise: { malicious: Severity; suspicious: Severity };
  /** Synthetic demo provider (engine-count scale, demo batches only). */
  demo: Thresholds;
}

export const DEFAULT_RISK_RULES: RiskRules = {
  virustotal: {
    ip: { high: 5, medium: 2, low: 1 },
    domain: { high: 5, medium: 2, low: 1 },
    url: { high: 4, medium: 2, low: 1 },
    hash: { high: 10, medium: 3, low: 1 },
  },
  abuseipdb: { high: 75, medium: 25, low: 1 },
  otx: { medium: 10, low: 1 },
  urlhaus: { url: 'high', payload: 'high', hostWithOnlineUrls: 'high', host: 'medium' },
  greynoise: { malicious: 'medium', suspicious: 'low' },
  demo: { high: 10, medium: 2, low: 1 },
};

function merge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    if (!(k in out)) continue;
    out[k] = typeof out[k] === 'object' && out[k] !== null ? merge(out[k], v) : v;
  }
  return out as T;
}

export function loadRiskRules(path?: string): RiskRules {
  if (!path) return DEFAULT_RISK_RULES;
  return merge(DEFAULT_RISK_RULES, JSON.parse(fs.readFileSync(path, 'utf8')));
}
