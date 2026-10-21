import { getDomain } from 'tldts';
import { ProviderError, type ProviderAdapter, type Reference } from '../types.js';
import { arr, compact, num, obj, str, strings } from '../util.js';

const BASE = 'https://otx.alienvault.com/api/v1/indicators';

function section(type: string, value: string): string {
  switch (type) {
    case 'ipv4':
      return 'IPv4';
    case 'ipv6':
      return 'IPv6';
    case 'domain':
      // OTX separates registrable domains from hostnames (sub.example.com).
      return getDomain(value) === value ? 'domain' : 'hostname';
    case 'url':
      return 'url';
    default:
      return 'file';
  }
}

const GUI_SECTION: Record<string, string> = { IPv4: 'ip', IPv6: 'ip', domain: 'domain', hostname: 'hostname', url: 'url', file: 'file' };

export const alienVaultOtx: ProviderAdapter = {
  id: 'otx',
  name: 'AlienVault OTX',
  description: 'Community threat pulses (campaigns, malware families, adversaries) referencing the indicator',
  supports: ['ipv4', 'ipv6', 'domain', 'url', 'md5', 'sha1', 'sha256'],
  credentialEnv: 'OTX_API_KEY',
  signupUrl: 'https://otx.alienvault.com/api',
  allowedHosts: ['otx.alienvault.com'],
  defaultLimits: { requestsPerMinute: 30, dailyLimit: null, concurrency: 2 },
  probe: { value: '8.8.8.8', type: 'ipv4' },

  async lookup(indicator, { apiKey, http }) {
    const sec = section(indicator.type, indicator.value);
    const res = await http.request(`${BASE}/${sec}/${encodeURIComponent(indicator.value)}/general`, {
      headers: { 'X-OTX-API-KEY': apiKey },
    });
    const permalink = `https://otx.alienvault.com/indicator/${GUI_SECTION[sec]}/${encodeURIComponent(indicator.value)}`;
    if (res.status === 404) {
      return { outcome: 'not_found', verdict: 'unknown', summary: 'Not known to OTX', metrics: {}, tags: [], references: [] };
    }

    const body = obj(res.body);
    const pulseInfo = obj(body.pulse_info);
    const count = num(pulseInfo.count);
    if (count === null) throw new ProviderError('provider_error', 'AlienVault OTX returned an unexpected response');
    const pulses = arr(pulseInfo.pulses).map(obj);
    const whitelist = arr(body.validation)
      .map(obj)
      .map((v) => str(v.name) ?? str(v.message) ?? str(v.source))
      .filter((v): v is string => Boolean(v));

    const families = new Set<string>();
    const adversaries = new Set<string>();
    const tags = new Set<string>();
    for (const p of pulses) {
      for (const f of arr(p.malware_families).map(obj)) {
        const name = str(f.display_name) ?? str(f.id);
        if (name) families.add(name);
      }
      const adversary = str(p.adversary);
      if (adversary) adversaries.add(adversary);
      for (const t of strings(p.tags, 10)) tags.add(t);
    }
    const references: Reference[] = pulses.slice(0, 10).flatMap((p) => {
      const id = str(p.id);
      return id ? [{ title: str(p.name) ?? 'OTX pulse', url: `https://otx.alienvault.com/pulse/${encodeURIComponent(id)}` }] : [];
    });

    const metrics = compact({
      pulses: count,
      malwareFamilies: families.size ? [...families].slice(0, 8).join(', ') : null,
      adversaries: adversaries.size ? [...adversaries].slice(0, 5).join(', ') : null,
      whitelistedBy: whitelist.length ? whitelist.slice(0, 3).join('; ') : null,
      reputation: num(body.reputation),
      country: str(body.country_name),
      asn: str(body.asn),
    });

    if (count === 0) {
      return {
        outcome: whitelist.length ? 'found' : 'not_found',
        verdict: whitelist.length ? 'benign' : 'unknown',
        summary: whitelist.length ? `No pulses; whitelisted (${whitelist[0]})` : 'Not referenced in any OTX pulse',
        metrics,
        tags: [],
        references: [],
        permalink,
      };
    }
    return {
      outcome: 'found',
      verdict: 'suspicious',
      summary: `Referenced in ${count} OTX pulse${count === 1 ? '' : 's'}${families.size ? ` (${[...families].slice(0, 2).join(', ')})` : ''}`,
      metrics,
      tags: [...tags].slice(0, 15),
      references,
      permalink,
    };
  },
};
