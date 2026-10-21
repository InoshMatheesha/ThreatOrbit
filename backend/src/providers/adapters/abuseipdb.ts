import { ProviderError, type ProviderAdapter, type Verdict } from '../types.js';
import { compact, num, obj, str, strings } from '../util.js';

export const abuseIpdb: ProviderAdapter = {
  id: 'abuseipdb',
  name: 'AbuseIPDB',
  description: 'Community abuse reports and an abuse confidence score for IP addresses',
  supports: ['ipv4', 'ipv6'],
  credentialEnv: 'ABUSEIPDB_API_KEY',
  signupUrl: 'https://www.abuseipdb.com/account/api',
  allowedHosts: ['api.abuseipdb.com'],
  // Free tier: 1,000 checks/day.
  defaultLimits: { requestsPerMinute: 30, dailyLimit: 1000, concurrency: 2 },
  probe: { value: '8.8.8.8', type: 'ipv4' },

  async lookup(indicator, { apiKey, http }) {
    const url = `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(indicator.value)}&maxAgeInDays=90`;
    const res = await http.request(url, { headers: { Key: apiKey } });
    if (res.status === 404) throw new ProviderError('provider_error', 'AbuseIPDB returned 404 for a check request');

    const data = obj(obj(res.body).data);
    const score = num(data.abuseConfidenceScore);
    if (score === null) throw new ProviderError('provider_error', 'AbuseIPDB returned an unexpected response');
    const reports = num(data.totalReports) ?? 0;
    const whitelisted = data.isWhitelisted === true;

    let verdict: Verdict;
    if (whitelisted && score < 25) verdict = 'benign';
    else if (score >= 75) verdict = 'malicious';
    else if (score >= 25) verdict = 'suspicious';
    else if (reports === 0) verdict = 'no_detections';
    else verdict = 'unknown';

    const summary =
      reports === 0
        ? `No abuse reports in 90 days (score ${score}%)`
        : `Abuse confidence ${score}% from ${reports} report${reports === 1 ? '' : 's'}`;

    return {
      outcome: 'found',
      verdict,
      summary: whitelisted ? `${summary}; whitelisted` : summary,
      abuseConfidence: score,
      metrics: compact({
        totalReports: reports,
        distinctReporters: num(data.numDistinctUsers),
        lastReported: str(data.lastReportedAt),
        country: str(data.countryCode),
        usageType: str(data.usageType),
        isp: str(data.isp),
        domain: str(data.domain),
        tor: data.isTor === true ? true : null,
        whitelisted: whitelisted ? true : null,
      }),
      tags: strings(data.hostnames, 5),
      references: [],
      permalink: `https://www.abuseipdb.com/check/${encodeURIComponent(indicator.value)}`,
    };
  },
};
