import { ProviderError, type ProviderAdapter, type Verdict } from '../types.js';
import { compact, obj, str } from '../util.js';

export const greyNoise: ProviderAdapter = {
  id: 'greynoise',
  name: 'GreyNoise Community',
  description: 'Whether an IP is mass-scanning the internet (noise) or a known benign business service (RIOT)',
  supports: ['ipv4'],
  credentialEnv: 'GREYNOISE_API_KEY',
  signupUrl: 'https://viz.greynoise.io/signup',
  allowedHosts: ['api.greynoise.io'],
  // Community API allowance is small; keep the local guard conservative.
  defaultLimits: { requestsPerMinute: 10, dailyLimit: 50, concurrency: 1 },
  probe: { value: '8.8.8.8', type: 'ipv4' },

  async lookup(indicator, { apiKey, http }) {
    const res = await http.request(`https://api.greynoise.io/v3/community/${encodeURIComponent(indicator.value)}`, {
      headers: { key: apiKey },
    });
    const body = obj(res.body);
    if (res.status === 404) {
      return {
        outcome: 'not_found',
        verdict: 'unknown',
        summary: 'Not observed scanning the internet and not a known business service',
        metrics: {},
        tags: [],
        references: [],
      };
    }
    if (typeof body.noise !== 'boolean') throw new ProviderError('provider_error', 'GreyNoise returned an unexpected response');

    const classification = str(body.classification) ?? 'unknown';
    const riot = body.riot === true;
    let verdict: Verdict;
    let summary: string;
    if (riot) {
      verdict = 'benign';
      summary = `Known business service${str(body.name) ? ` (${body.name})` : ''}`;
    } else if (classification === 'malicious') {
      verdict = 'malicious';
      summary = 'Internet scanner classified as malicious';
    } else if (classification === 'benign') {
      verdict = 'benign';
      summary = `Benign scanner${str(body.name) ? ` (${body.name})` : ''}`;
    } else {
      verdict = body.noise ? 'suspicious' : 'unknown';
      summary = body.noise ? 'Mass-scanning the internet, intent unknown' : 'Seen by GreyNoise, unclassified';
    }

    const link = str(body.link);
    return {
      outcome: 'found',
      verdict,
      summary,
      metrics: compact({ noise: body.noise, riot, classification, name: str(body.name), lastSeen: str(body.last_seen) }),
      tags: [],
      references: [],
      ...(link?.startsWith('https://') ? { permalink: link } : {}),
    };
  },
};
