import { ProviderError, type ProviderAdapter, type ProviderFinding } from '../types.js';
import { arr, compact, num, obj, str, strings } from '../util.js';

const BASE = 'https://urlhaus-api.abuse.ch/v1';

/**
 * URLhaus query endpoints are POST-only but read-only: they look up existing
 * records and never submit anything to URLhaus.
 */
function queryFor(type: string, value: string): { path: string; form: Record<string, string> } {
  switch (type) {
    case 'url':
      return { path: 'url', form: { url: value } };
    case 'md5':
      return { path: 'payload', form: { md5_hash: value } };
    case 'sha256':
      return { path: 'payload', form: { sha256_hash: value } };
    default:
      return { path: 'host', form: { host: value } };
  }
}

const NOT_FOUND: ProviderFinding = {
  outcome: 'not_found',
  verdict: 'unknown',
  summary: 'Not listed in URLhaus',
  metrics: {},
  tags: [],
  references: [],
};

export const urlhaus: ProviderAdapter = {
  id: 'urlhaus',
  name: 'URLhaus',
  description: 'abuse.ch database of malware distribution URLs, hosts and payloads',
  supports: ['url', 'domain', 'ipv4', 'md5', 'sha256'],
  credentialEnv: 'URLHAUS_AUTH_KEY',
  signupUrl: 'https://auth.abuse.ch/',
  allowedHosts: ['urlhaus-api.abuse.ch'],
  defaultLimits: { requestsPerMinute: 30, dailyLimit: null, concurrency: 2 },
  probe: { value: '8.8.8.8', type: 'ipv4' },

  async lookup(indicator, { apiKey, http }) {
    const { path, form } = queryFor(indicator.type, indicator.value);
    const res = await http.request(`${BASE}/${path}/`, { method: 'POST', headers: { 'Auth-Key': apiKey }, form });
    const body = obj(res.body);
    const status = str(body.query_status);
    if (res.status === 404 || status === 'no_results') return NOT_FOUND;
    if (status !== 'ok') {
      if (status === 'unknown_auth_key' || status === 'missing_auth_key') {
        throw new ProviderError('auth', 'URLhaus rejected the Auth-Key');
      }
      throw new ProviderError('invalid_request', `URLhaus query failed: ${status ?? 'unexpected response'}`);
    }

    const reference = str(body.urlhaus_reference);
    const references = reference ? [{ title: 'URLhaus entry', url: reference }] : [];
    const blacklists = Object.entries(obj(body.blacklists))
      .filter(([, v]) => typeof v === 'string' && v !== 'not listed')
      .map(([k, v]) => `${k}: ${v}`);

    if (path === 'url') {
      const urlStatus = str(body.url_status) ?? 'unknown';
      return {
        outcome: 'found',
        verdict: 'malicious',
        summary: `Malware URL (${str(body.threat) ?? 'malware_download'}), currently ${urlStatus}`,
        metrics: compact({
          urlStatus,
          threat: str(body.threat),
          dateAdded: str(body.date_added),
          payloads: arr(body.payloads).length || null,
          blacklists: blacklists.join('; ') || null,
        }),
        tags: strings(body.tags),
        references,
        ...(reference ? { permalink: reference } : {}),
      };
    }

    if (path === 'payload') {
      const signature = str(body.signature);
      return {
        outcome: 'found',
        verdict: 'malicious',
        summary: `Known malware payload${signature ? ` (${signature})` : ''}, seen on ${num(body.url_count) ?? 0} URL(s)`,
        metrics: compact({
          signature,
          fileType: str(body.file_type),
          fileSize: num(body.file_size),
          firstSeen: str(body.firstseen),
          lastSeen: str(body.lastseen),
          urlCount: num(body.url_count),
        }),
        tags: [],
        references,
      };
    }

    const urls = arr(body.urls).map(obj);
    const online = urls.filter((u) => u.url_status === 'online').length;
    const count = num(body.url_count) ?? urls.length;
    return {
      outcome: 'found',
      verdict: online > 0 ? 'malicious' : 'suspicious',
      summary: `Host served ${count} malware URL(s), ${online} online now`,
      metrics: compact({ urlCount: count, onlineUrls: online, firstSeen: str(body.firstseen), blacklists: blacklists.join('; ') || null }),
      tags: [...new Set(urls.flatMap((u) => strings(u.tags, 5)))].slice(0, 15),
      references,
      ...(reference ? { permalink: reference } : {}),
    };
  },
};
