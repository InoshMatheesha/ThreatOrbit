import type { BatchDoc } from '../models/Batch.js';
import type { ItemView } from './resultViews.js';

const CSV_COLUMNS = [
  'batch_id',
  'indicator',
  'type',
  'risk',
  'risk_provisional',
  'risk_reasons',
  'provider_disagreement',
  'provider',
  'lookup_status',
  'outcome',
  'verdict',
  'summary',
  'malicious_engines',
  'total_engines',
  'abuse_confidence',
  'tags',
  'permalink',
  'looked_up_at',
  'cache',
  'error_kind',
  'error_message',
  'source_lines',
  'notes',
] as const;

/**
 * Quote a CSV cell and neutralise spreadsheet formula injection: values starting
 * with = + - @ or a control character are prefixed with an apostrophe.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(batch: BatchDoc, items: ItemView[]): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const item of items) {
    const base = {
      batch_id: batch._id,
      indicator: item.value,
      type: item.type,
      risk: item.risk.level,
      risk_provisional: item.risk.provisional ? 'yes' : 'no',
      risk_reasons: item.risk.reasons.join(' | '),
      provider_disagreement: item.risk.disagreement?.summary ?? '',
      source_lines: item.lines.join(' '),
      notes: item.notes.join(' | '),
    };
    const results = Object.values(item.results);
    if (results.length === 0) {
      rows.push(CSV_COLUMNS.map((c) => csvCell((base as Record<string, unknown>)[c])).join(','));
      continue;
    }
    for (const r of results) {
      const row: Record<string, unknown> = {
        ...base,
        provider: r!.provider,
        lookup_status: r!.status,
        outcome: r!.outcome,
        verdict: r!.verdict,
        summary: r!.summary,
        malicious_engines: r!.detections?.malicious,
        total_engines: r!.detections?.total,
        abuse_confidence: r!.abuseConfidence,
        tags: r!.tags?.join(' '),
        permalink: r!.permalink,
        looked_up_at: r!.lookedUpAt ? new Date(r!.lookedUpAt).toISOString() : '',
        cache: r!.cacheStatus,
        error_kind: r!.error?.kind,
        error_message: r!.error?.message,
      };
      rows.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
    }
  }
  // BOM so Excel opens UTF-8 (IDN display forms) correctly.
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

export function toJson(batch: BatchDoc, items: ItemView[]) {
  return {
    exportedAt: new Date().toISOString(),
    batch: {
      id: batch._id,
      label: batch.label ?? null,
      status: batch.status,
      createdBy: batch.createdBy,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt ?? null,
      totals: batch.totals,
      counters: batch.counters,
      providers: batch.providers,
    },
    indicators: items,
  };
}
