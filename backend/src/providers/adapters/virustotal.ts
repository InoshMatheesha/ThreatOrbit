import { ProviderError, type ProviderAdapter, type ProviderFinding, type Verdict } from '../types.js';
import { compact, detectionsFrom, obj, str, strings, unixToIso } from '../util.js';

const BASE = 'https://www.virustotal.com/api/v3';

/** VirusTotal URL identifier: unpadded base64url of the URL (GET only, never a submission). */
export function vtUrlId(url: string): string {
  return Buffer.from(url).toString('base64url');
}

function pathFor(type: string, value: string): { api: string; gui: string } {
  switch (type) {
    case 'ipv4':
    case 'ipv6':
      return { api: `ip_addresses/${encodeURIComponent(value)}`, gui: 'ip-address' };
    case 'domain':
      return { api: `domains/${encodeURIComponent(value)}`, gui: 'domain' };
    case 'url':
      return { api: `urls/${vtUrlId(value)}`, gui: 'url' };
    default:
      return { api: `files/${value}`, gui: 'file' };
  }
}

/**
 * What the Sophos engine said, read from the engine list VirusTotal already returns (no extra request).
 * Shown only for malicious results, where "did Sophos catch it?" is the follow-up question.
 */
export function sophosVerdict(results: unknown): string {
  const engines = Object.entries(obj(results));
  const entry = engines.find(([name]) => name.toLowerCase() === 'sophos') ?? engines.find(([name]) => /^sophos/i.test(name));
  if (!entry) return 'Sophos did not scan this';
  const { category, result } = obj(entry[1]);
  if (category === 'malicious' || category === 'suspicious')
    return typeof result === 'string' && result ? `Detected: ${result}` : 'Detected';
  if (category === 'harmless' || category === 'undetected') return 'Not detected';
  return 'Sophos gave no result';
}

export const virusTotal: ProviderAdapter = {
  id: 'virustotal',
  name: 'VirusTotal',
  description: 'Multi-engine detections, reputation and context for IPs, domains, URLs and file hashes',
  supports: ['ipv4', 'ipv6', 'domain', 'url', 'md5', 'sha1', 'sha256'],
  credentialEnv: 'VIRUSTOTAL_API_KEY',
  signupUrl: 'https://www.virustotal.com/gui/my-apikey',
  allowedHosts: ['www.virustotal.com'],
  // Public API: 4 requests/minute, 500/day.
  defaultLimits: { requestsPerMinute: 4, dailyLimit: 500, concurrency: 1 },
  probe: { value: '8.8.8.8', type: 'ipv4' },

  async lookup(indicator, { apiKey, http }): Promise<ProviderFinding> {
    const { api, gui } = pathFor(indicator.type, indicator.value);
    const res = await http.request(`${BASE}/${api}`, { headers: { 'x-apikey': apiKey } });
    if (res.status === 404) {
      return {
        outcome: 'not_found',
        verdict: 'unknown',
        summary: 'Not in the VirusTotal dataset',
        metrics: {},
        tags: [],
        references: [],
      };
    }

    const data = obj(obj(res.body).data);
    const attrs = obj(data.attributes);
    if (!data.id) throw new ProviderError('provider_error', 'VirusTotal returned an unexpected response');

    const d = detectionsFrom(obj(attrs.last_analysis_stats));
    let verdict: Verdict;
    if (d.total === 0) verdict = 'unknown';
    else if (d.malicious >= 3) verdict = 'malicious';
    else if (d.malicious > 0 || d.suspicious > 0) verdict = 'suspicious';
    else verdict = 'no_detections';

    const summary =
      d.total === 0
        ? 'Known to VirusTotal but never analysed'
        : `${d.malicious}/${d.total} engines malicious${d.suspicious ? `, ${d.suspicious} suspicious` : ''}`;

    const categories = Object.values(obj(attrs.categories)).filter((c): c is string => typeof c === 'string');
    const threat = obj(attrs.popular_threat_classification);

    return {
      outcome: 'found',
      verdict,
      summary,
      detections: d,
      metrics: compact({
        sophos: verdict === 'malicious' ? sophosVerdict(attrs.last_analysis_results) : null,
        reputation: typeof attrs.reputation === 'number' ? attrs.reputation : null,
        lastAnalysis: unixToIso(attrs.last_analysis_date),
        country: str(attrs.country),
        asOwner: str(attrs.as_owner),
        asn: typeof attrs.asn === 'number' ? attrs.asn : null,
        network: str(attrs.network),
        registrar: str(attrs.registrar),
        created: unixToIso(attrs.creation_date),
        categories: categories.length ? [...new Set(categories)].slice(0, 5).join(', ') : null,
        fileType: str(attrs.type_description),
        fileName: str(attrs.meaningful_name),
        fileSize: typeof attrs.size === 'number' ? attrs.size : null,
        threatLabel: str(threat.suggested_threat_label),
        finalUrl: str(attrs.last_final_url),
        httpStatus: typeof attrs.last_http_response_code === 'number' ? attrs.last_http_response_code : null,
        title: str(attrs.title),
      }),
      tags: strings(attrs.tags),
      references: [],
      permalink: `https://www.virustotal.com/gui/${gui}/${encodeURIComponent(String(data.id))}`,
    };
  },
};
