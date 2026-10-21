import { createHash } from 'node:crypto';
import type { ProviderAdapter, ProviderFinding } from '../types.js';

/**
 * Synthetic provider for demos and training. Results are derived from a hash of
 * the indicator, are clearly labeled, and only ever appear in demo batches.
 */
export const demoProvider: ProviderAdapter = {
  id: 'demo',
  name: 'Demo (synthetic)',
  description: 'Deterministic SYNTHETIC results for trying the workflow without API keys or quota. Not threat intelligence.',
  supports: ['ipv4', 'ipv6', 'domain', 'url', 'md5', 'sha1', 'sha256'],
  credentialEnv: null,
  signupUrl: '',
  allowedHosts: [],
  defaultLimits: { requestsPerMinute: 600, dailyLimit: null, concurrency: 4 },
  probe: { value: '192.0.2.1', type: 'ipv4' },
  synthetic: true,

  async lookup(indicator): Promise<ProviderFinding> {
    const bucket = createHash('sha256').update(`${indicator.type}:${indicator.value}`).digest()[0]! % 10;
    await new Promise((r) => setTimeout(r, 150 + bucket * 40));
    const base = { metrics: { synthetic: true }, tags: ['synthetic'], references: [] };
    if (bucket === 0) return { ...base, outcome: 'not_found', verdict: 'unknown', summary: '[SYNTHETIC] No record' };
    if (bucket <= 2) {
      const malicious = 20 + bucket * 9;
      return {
        ...base,
        outcome: 'found',
        verdict: 'malicious',
        summary: `[SYNTHETIC] ${malicious}/90 engines malicious`,
        detections: { malicious, suspicious: 2, harmless: 10, undetected: 90 - malicious - 12, total: 90 },
      };
    }
    if (bucket <= 4) {
      return {
        ...base,
        outcome: 'found',
        verdict: 'suspicious',
        summary: '[SYNTHETIC] 2/90 engines malicious',
        detections: { malicious: 2, suspicious: 1, harmless: 20, undetected: 67, total: 90 },
      };
    }
    return {
      ...base,
      outcome: 'found',
      verdict: 'no_detections',
      summary: '[SYNTHETIC] 0/90 engines malicious',
      detections: { malicious: 0, suspicious: 0, harmless: 25, undetected: 65, total: 90 },
    };
  },
};
