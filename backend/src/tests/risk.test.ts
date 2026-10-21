import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RISK_RULES, loadRiskRules } from '../config/riskRules.js';
import type { ProviderSnapshot } from '../models/Batch.js';
import type { EnrichmentResultDoc } from '../models/EnrichmentResult.js';
import type { IndicatorType } from '../parser/types.js';
import { assessRisk } from '../services/riskEngine.js';

const PROVIDERS: ProviderSnapshot[] = [
  { id: 'virustotal', name: 'VirusTotal', state: 'ready', supports: ['ipv4', 'domain', 'url', 'sha256'], requestsPerMinute: 4 },
  { id: 'abuseipdb', name: 'AbuseIPDB', state: 'ready', supports: ['ipv4'], requestsPerMinute: 30 },
  { id: 'otx', name: 'AlienVault OTX', state: 'ready', supports: ['ipv4', 'domain', 'url', 'sha256'], requestsPerMinute: 30 },
  { id: 'urlhaus', name: 'URLhaus', state: 'ready', supports: ['url', 'domain', 'ipv4'], requestsPerMinute: 30 },
];

type R = Parameters<typeof assessRisk>[1][number];
const vt = (malicious: number, type: IndicatorType = 'ipv4'): R => ({
  provider: 'virustotal',
  type,
  status: 'completed',
  outcome: 'found',
  verdict: malicious >= 3 ? 'malicious' : malicious > 0 ? 'suspicious' : 'no_detections',
  detections: { malicious, suspicious: 0, harmless: 60, undetected: 30 - malicious, total: 90 },
});
const abuse = (score: number, reports = score ? 10 : 0): R => ({
  provider: 'abuseipdb',
  type: 'ipv4',
  status: 'completed',
  outcome: 'found',
  verdict: score >= 75 ? 'malicious' : score >= 25 ? 'suspicious' : 'no_detections',
  abuseConfidence: score,
  metrics: { totalReports: reports },
});
const failed = (provider: EnrichmentResultDoc['provider'], kind = 'timeout'): R =>
  ({ provider, type: 'ipv4', status: 'failed', error: { kind, message: 'x', at: new Date() } }) as R;
const notFound = (provider: EnrichmentResultDoc['provider']): R => ({
  provider,
  type: 'ipv4',
  status: 'completed',
  outcome: 'not_found',
  verdict: 'unknown',
});
const pending = (provider: EnrichmentResultDoc['provider']): R => ({ provider, type: 'ipv4', status: 'queued' });

const ip = { type: 'ipv4' as const, lookupEligible: true };
const assess = (results: R[], item: { type: IndicatorType; lookupEligible: boolean } = ip) =>
  assessRisk(item, results, PROVIDERS, DEFAULT_RISK_RULES);

describe('risk engine', () => {
  it('takes the strongest signal and explains it', () => {
    const r = assess([vt(7), abuse(10)]);
    expect(r.level).toBe('high');
    expect(r.reasons[0]).toMatch(/VirusTotal: 7\/90 engines malicious/);
    expect(r.reasons.join(' ')).toMatch(/AbuseIPDB: abuse confidence 10%/);
  });

  it('shows provider disagreement explicitly', () => {
    const r = assess([vt(0), abuse(100)]);
    expect(r.level).toBe('high');
    expect(r.disagreement).toMatchObject({ flagged: ['abuseipdb'], clear: ['virustotal'] });
    expect(r.disagreement!.summary).toBe('AbuseIPDB flag this indicator, while VirusTotal report no detections');
  });

  it('never counts timeouts, API failures or missing records as clean', () => {
    expect(assess([failed('virustotal'), failed('abuseipdb', 'auth')]).level).toBe('unknown');
    expect(assess([notFound('virustotal'), notFound('otx')]).level).toBe('unknown');
    expect(assess([notFound('virustotal'), failed('abuseipdb')]).reasons[0]).toMatch(/No provider has a record.*1 lookup\(s\) failed/);
    const partial = assess([vt(0), failed('abuseipdb')]);
    expect(partial.level).toBe('low');
    expect(partial.reasons.join(' ')).toMatch(/not proof the indicator is safe/);
    expect(partial.reasons.join(' ')).toMatch(/1 lookup\(s\) failed and are not counted/);
  });

  it('uses indicator-type-specific thresholds', () => {
    // 4 engines: High for a URL (>= 4) but only Medium for an IP (>= 5 for High).
    expect(assess([vt(4, 'url')], { type: 'url', lookupEligible: true }).level).toBe('high');
    expect(assess([vt(4, 'ipv4')]).level).toBe('medium');
    // Hashes need 10 engines for High.
    expect(assess([vt(8, 'sha256')], { type: 'sha256', lookupEligible: true }).level).toBe('medium');
  });

  it('caps OTX pulses below High no matter how many', () => {
    const otx = (pulses: number): R => ({
      provider: 'otx',
      type: 'ipv4',
      status: 'completed',
      outcome: 'found',
      verdict: 'suspicious',
      metrics: { pulses },
    });
    expect(assess([otx(500)]).level).toBe('medium');
    expect(assess([otx(2)]).level).toBe('low');
  });

  it('marks results provisional while lookups are pending', () => {
    const r = assess([abuse(90), pending('virustotal')]);
    expect(r).toMatchObject({ level: 'high', provisional: true });
    expect(assess([pending('virustotal')])).toMatchObject({ level: 'unknown', provisional: true });
  });

  it('keeps private and internal indicators Unknown', () => {
    expect(assess([], { type: 'ipv4', lookupEligible: false }).reasons[0]).toMatch(/Kept local/);
  });

  it('explains when no provider supports a type', () => {
    expect(assess([], { type: 'md5', lookupEligible: true }).reasons[0]).toBe('No configured provider supports md5 indicators');
  });

  it('loads rule overrides from a JSON file', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-')), 'rules.json');
    fs.writeFileSync(file, JSON.stringify({ abuseipdb: { high: 95 }, bogus: { x: 1 } }));
    const rules = loadRiskRules(file);
    expect(rules.abuseipdb).toEqual({ high: 95, medium: 25, low: 1 });
    expect(rules.virustotal).toEqual(DEFAULT_RISK_RULES.virustotal);
    expect(assessRisk(ip, [abuse(90)], PROVIDERS, rules).level).toBe('medium');
  });
});
