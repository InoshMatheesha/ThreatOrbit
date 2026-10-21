import type { RiskRules, Severity, Thresholds } from '../config/riskRules.js';
import type { ProviderId } from '../config/env.js';
import type { BatchItem, ProviderSnapshot } from '../models/Batch.js';
import type { EnrichmentResultDoc } from '../models/EnrichmentResult.js';
import type { IndicatorType } from '../parser/types.js';

export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface RiskSignal {
  provider: ProviderId;
  severity: Severity;
  reason: string;
}

export interface RiskAssessment {
  level: RiskLevel;
  /** Lookups are still pending, so the level may change. */
  provisional: boolean;
  reasons: string[];
  signals: RiskSignal[];
  disagreement: { flagged: ProviderId[]; clear: ProviderId[]; summary: string } | null;
  coverage: { lookups: number; withRecord: number; noRecord: number; failed: number; pending: number; cancelled: number };
}

type ResultLike = Pick<
  EnrichmentResultDoc,
  'provider' | 'status' | 'outcome' | 'verdict' | 'detections' | 'abuseConfidence' | 'metrics' | 'type'
>;

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1, none: 0 };

function bucket(value: number, t: Thresholds): Severity {
  if (value >= t.high) return 'high';
  if (value >= t.medium) return 'medium';
  if (value >= t.low) return 'low';
  return 'none';
}

function vtGroup(type: IndicatorType): keyof RiskRules['virustotal'] {
  if (type === 'ipv4' || type === 'ipv6') return 'ip';
  if (type === 'domain' || type === 'url') return type;
  return 'hash';
}

const TYPE_NOUN: Record<keyof RiskRules['virustotal'], string> = { ip: 'IPs', domain: 'domains', url: 'URLs', hash: 'file hashes' };

/** Severity contributed by one completed lookup that found a record. */
function signalFor(r: ResultLike, rules: RiskRules, names: Map<ProviderId, string>): RiskSignal {
  const name = names.get(r.provider) ?? r.provider;
  const metrics = r.metrics ?? {};
  switch (r.provider) {
    case 'virustotal': {
      const d = r.detections;
      const m = d?.malicious ?? 0;
      const t = rules.virustotal[vtGroup(r.type)];
      let severity = bucket(m, t);
      if (severity === 'none' && (d?.suspicious ?? 0) >= 3) severity = 'low';
      return {
        provider: r.provider,
        severity,
        reason: `${name}: ${m}/${d?.total ?? 0} engines malicious${d?.suspicious ? `, ${d.suspicious} suspicious` : ''} (rule for ${TYPE_NOUN[vtGroup(r.type)]}: High >= ${t.high}, Medium >= ${t.medium})`,
      };
    }
    case 'abuseipdb': {
      const score = r.abuseConfidence ?? 0;
      const t = rules.abuseipdb;
      return {
        provider: r.provider,
        severity: bucket(score, t),
        reason: `${name}: abuse confidence ${score}% from ${metrics.totalReports ?? 0} reports (High >= ${t.high}%, Medium >= ${t.medium}%)`,
      };
    }
    case 'otx': {
      const pulses = typeof metrics.pulses === 'number' ? metrics.pulses : 0;
      const t = rules.otx;
      const severity: Severity = pulses >= t.medium ? 'medium' : pulses >= t.low ? 'low' : 'none';
      return {
        provider: r.provider,
        severity,
        reason: `${name}: referenced in ${pulses} community pulse(s) (Medium >= ${t.medium}; pulses alone never make High)`,
      };
    }
    case 'urlhaus': {
      let kind: keyof RiskRules['urlhaus'];
      if (r.type === 'url') kind = 'url';
      else if (r.type === 'md5' || r.type === 'sha256') kind = 'payload';
      else kind = typeof metrics.onlineUrls === 'number' && metrics.onlineUrls > 0 ? 'hostWithOnlineUrls' : 'host';
      const text = {
        url: `listed as a malware URL (${metrics.urlStatus ?? 'status unknown'})`,
        payload: 'known malware payload',
        hostWithOnlineUrls: `host currently serving ${metrics.onlineUrls} malware URL(s)`,
        host: `host previously served ${metrics.urlCount ?? 'some'} malware URL(s), none online`,
      }[kind];
      return { provider: r.provider, severity: rules.urlhaus[kind], reason: `${name}: ${text}` };
    }
  }
}

/**
 * Combine provider results for one indicator into High / Medium / Low / Unknown.
 * - The highest provider signal wins, and every contributing reason is listed.
 * - Timeouts, errors, missing records and pending lookups never count as clean.
 * - Low needs at least one provider that HAS a record and flags nothing significant.
 */
export function assessRisk(
  item: Pick<BatchItem, 'type' | 'lookupEligible'>,
  results: ResultLike[],
  providers: ProviderSnapshot[],
  rules: RiskRules,
): RiskAssessment {
  const names = new Map(providers.map((p) => [p.id, p.name]));
  const relevant = results;
  const coverage = { lookups: relevant.length, withRecord: 0, noRecord: 0, failed: 0, pending: 0, cancelled: 0 };
  const signals: RiskSignal[] = [];
  const clear: ProviderId[] = [];
  const flagged: ProviderId[] = [];

  for (const r of relevant) {
    if (r.status === 'queued' || r.status === 'running') coverage.pending++;
    else if (r.status === 'failed') coverage.failed++;
    else if (r.status === 'cancelled') coverage.cancelled++;
    else if (r.outcome === 'not_found') coverage.noRecord++;
    else if (r.outcome === 'found') {
      coverage.withRecord++;
      const signal = signalFor(r, rules, names);
      signals.push(signal);
      if (RANK[signal.severity] >= RANK.medium || r.verdict === 'malicious') flagged.push(r.provider);
      else if (r.verdict === 'no_detections' || r.verdict === 'benign') clear.push(r.provider);
    }
  }
  signals.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  const provisional = coverage.pending > 0;

  const unknown = (reason: string): RiskAssessment => ({
    level: 'unknown',
    provisional,
    reasons: [reason, ...signals.map((s) => s.reason)],
    signals,
    disagreement: null,
    coverage,
  });

  if (!item.lookupEligible) {
    return unknown('Kept local (private/reserved address or internal name): not sent to providers');
  }
  if (relevant.length === 0) {
    const supported = providers.some((p) => p.state === 'ready' && p.supports.includes(item.type));
    return unknown(supported ? 'No lookups were run for this indicator' : `No configured provider supports ${item.type} indicators`);
  }

  const top = signals[0]?.severity ?? 'none';
  const disagreement =
    flagged.length && clear.length
      ? {
          flagged,
          clear,
          summary: `${flagged.map((p) => names.get(p) ?? p).join(', ')} flag this indicator, while ${clear
            .map((p) => names.get(p) ?? p)
            .join(', ')} report no detections`,
        }
      : null;

  if (top === 'high' || top === 'medium' || top === 'low') {
    const reasons = signals.filter((s) => s.severity !== 'none').map((s) => s.reason);
    reasons.push(...signals.filter((s) => s.severity === 'none').map((s) => s.reason));
    if (provisional) reasons.push(`${coverage.pending} lookup(s) still pending`);
    if (coverage.failed) reasons.push(`${coverage.failed} lookup(s) failed and are not counted`);
    return { level: top, provisional, reasons, signals, disagreement, coverage };
  }

  if (coverage.withRecord > 0) {
    const reasons = [
      `${coverage.withRecord} provider(s) have a record and none flag it significantly. This is not proof the indicator is safe`,
      ...signals.map((s) => s.reason),
    ];
    if (provisional) reasons.push(`${coverage.pending} lookup(s) still pending`);
    if (coverage.failed) reasons.push(`${coverage.failed} lookup(s) failed and are not counted`);
    return { level: 'low', provisional, reasons, signals, disagreement, coverage };
  }

  if (provisional) return unknown(`Waiting for ${coverage.pending} lookup(s)`);
  if (coverage.failed && !coverage.noRecord) return unknown('Every lookup failed; no evidence either way');
  if (coverage.noRecord) {
    return unknown(
      `No provider has a record of this indicator${coverage.failed ? ` (${coverage.failed} lookup(s) failed)` : ''}. Unknown is not the same as safe`,
    );
  }
  return unknown('Lookups were cancelled before completing');
}

export const RISK_ORDER: Record<RiskLevel, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
