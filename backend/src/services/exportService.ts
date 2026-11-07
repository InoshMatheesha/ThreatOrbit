import type { BatchDoc } from '../models/Batch.js';
import type { ItemView } from './resultViews.js';

const CSV_COLUMNS = [
  'indicator',
  'Virus total count',
  'total_engines',
  'abuse_confidence',
  'sophos detection',
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

export function toCsv(_batch: BatchDoc, items: ItemView[]): string {
  const rows: string[] = [CSV_COLUMNS.join(',')];
  for (const item of items) {
    const vt = item.results.virustotal;
    const abuse = item.results.abuseipdb;
    const sophos = vt?.metrics?.sophos ?? '';
    const row = [
      csvCell(item.value),
      csvCell(vt?.detections?.malicious ?? ''),
      csvCell(vt?.detections?.total ?? ''),
      csvCell(abuse?.abuseConfidence ?? ''),
      csvCell(sophos),
    ];
    rows.push(row.join(','));
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
