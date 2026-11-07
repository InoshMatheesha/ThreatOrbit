import type { RiskRules } from '../config/riskRules.js';
import type { ProviderId } from '../config/env.js';
import type { BatchDoc, BatchItem } from '../models/Batch.js';
import type { EnrichmentResultDoc, LookupStatus } from '../models/EnrichmentResult.js';
import type { IndicatorType } from '../parser/types.js';
import { assessRisk, RISK_ORDER, type RiskAssessment, type RiskLevel } from './riskEngine.js';

export interface ResultView {
  id: string;
  provider: ProviderId;
  status: LookupStatus;
  attempts: number;
  outcome?: string;
  verdict?: string;
  summary?: string;
  detections?: EnrichmentResultDoc['detections'];
  abuseConfidence?: number;
  metrics?: Record<string, string | number | boolean>;
  tags?: string[];
  references?: Array<{ title: string; url: string }>;
  permalink?: string;
  lookedUpAt?: Date;
  expiresAt?: Date;
  cacheStatus?: 'hit' | 'miss';
  error?: { kind: string; message: string; httpStatus?: number; at: Date };
}

export interface ItemView extends BatchItem {
  risk: RiskAssessment;
  /** Per provider: the lookup, or null when that provider does not support this type / is not configured. */
  results: Partial<Record<ProviderId, ResultView>>;
  status: 'pending' | 'complete' | 'has_failures' | 'local';
}

export function toResultView(r: EnrichmentResultDoc): ResultView {
  return {
    id: String(r._id),
    provider: r.provider,
    status: r.status,
    attempts: r.attempts,
    ...(r.outcome ? { outcome: r.outcome } : {}),
    ...(r.verdict ? { verdict: r.verdict } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(r.detections ? { detections: r.detections } : {}),
    ...(r.abuseConfidence !== undefined && r.abuseConfidence !== null ? { abuseConfidence: r.abuseConfidence } : {}),
    ...(r.metrics ? { metrics: r.metrics } : {}),
    ...(r.tags?.length ? { tags: r.tags } : {}),
    ...(r.references?.length ? { references: r.references } : {}),
    ...(r.permalink ? { permalink: r.permalink } : {}),
    ...(r.lookedUpAt ? { lookedUpAt: r.lookedUpAt } : {}),
    ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}),
    ...(r.cacheStatus ? { cacheStatus: r.cacheStatus } : {}),
    ...(r.error?.kind ? { error: r.error } : {}),
  };
}

/**
 * Mongo projections per endpoint. The results table and the risk engine need far less
 * than the detail view, and these documents are fetched by the hundred on every poll.
 */
export const RESULT_FIELDS = {
  /** Detail view: everything. */
  full: {},
  /** Results table: `summary` and `tags` are still needed to answer the search box. */
  list: { references: 0 },
  /**
   * Batch header: only risk levels and per-provider progress are derived, so this fetches
   * the handful of fields the risk rules read and nothing else. Keep it in step with
   * `signalFor` in riskEngine.ts — a metric missing here reads as absent and can change a level.
   */
  summary: {
    itemIndex: 1,
    provider: 1,
    type: 1,
    status: 1,
    outcome: 1,
    verdict: 1,
    detections: 1,
    abuseConfidence: 1,
    cacheStatus: 1,
    'metrics.totalReports': 1,
    'metrics.pulses': 1,
    'metrics.onlineUrls': 1,
    'metrics.urlStatus': 1,
    'metrics.urlCount': 1,
  },
} as const;

/** Only the pulse count is rendered in a table cell; the rest of OTX's metrics are detail-view only. */
function listMetrics(metrics: ResultView['metrics']) {
  return typeof metrics?.pulses === 'number' ? { pulses: metrics.pulses } : undefined;
}

/**
 * One row of the results table.
 *
 * Drops everything only the detail view renders: the per-provider risk sentences and
 * signals, the original spellings, engine tags, references and the metrics other than the
 * pulse count. Those are all sent in full by `GET /batches/:id/items/:index`, which the
 * detail view requests when a row is opened, so nothing becomes unreachable. Filtering,
 * sorting and the risk summary all run over the complete views before this trim, so the
 * search box still matches on summaries and tags.
 */
export function toListItem(item: ItemView): ItemView {
  const results: Partial<Record<ProviderId, ResultView>> = {};
  for (const [id, r] of Object.entries(item.results) as Array<[ProviderId, ResultView]>) {
    const metrics = listMetrics(r.metrics);
    const { tags: _tags, references: _references, metrics: _metrics, lookedUpAt: _lookedUpAt, expiresAt: _expiresAt, ...rest } = r;
    results[id] = { ...rest, ...(metrics ? { metrics } : {}) };
  }
  return { ...item, originals: [], risk: { ...item.risk, reasons: [], signals: [] }, results };
}

export function buildItemViews(batch: BatchDoc, results: EnrichmentResultDoc[], rules: RiskRules): ItemView[] {
  const byItem = new Map<number, EnrichmentResultDoc[]>();
  for (const r of results) byItem.set(r.itemIndex, [...(byItem.get(r.itemIndex) ?? []), r]);

  return batch.items.map((item) => {
    const own = byItem.get(item.index) ?? [];
    const risk = assessRisk(item, own, batch.providers, rules);
    const views: Partial<Record<ProviderId, ResultView>> = {};
    for (const r of own) views[r.provider] = toResultView(r);
    let status: ItemView['status'];
    if (!item.lookupEligible) status = 'local';
    else if (own.some((r) => r.status === 'queued' || r.status === 'running')) status = 'pending';
    else if (own.some((r) => r.status === 'failed')) status = 'has_failures';
    else status = 'complete';
    return { ...item, risk, results: views, status };
  });
}

export interface ItemQuery {
  type?: IndicatorType;
  risk?: RiskLevel;
  provider?: ProviderId;
  status?: ItemView['status'];
  disagreement?: boolean;
  q?: string;
  sort: 'risk' | 'value' | 'type' | 'line';
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export function filterItems(items: ItemView[], q: ItemQuery) {
  const needle = q.q?.trim().toLowerCase();
  const filtered = items.filter(
    (i) =>
      (!q.type || i.type === q.type) &&
      (!q.risk || i.risk.level === q.risk) &&
      (!q.provider || Boolean(i.results[q.provider])) &&
      (!q.status || i.status === q.status) &&
      (!q.disagreement || Boolean(i.risk.disagreement)) &&
      (!needle ||
        i.value.toLowerCase().includes(needle) ||
        i.display?.toLowerCase().includes(needle) ||
        i.originals.some((o) => o.toLowerCase().includes(needle)) ||
        Object.values(i.results).some(
          (r) => r?.summary?.toLowerCase().includes(needle) || r?.tags?.some((t) => t.toLowerCase().includes(needle)),
        )),
  );

  const dir = q.order === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let cmp = 0;
    if (q.sort === 'risk') cmp = RISK_ORDER[a.risk.level] - RISK_ORDER[b.risk.level] || a.risk.signals.length - b.risk.signals.length;
    else if (q.sort === 'value') cmp = a.value.localeCompare(b.value);
    else if (q.sort === 'type') cmp = a.type.localeCompare(b.type);
    else cmp = (a.lines[0] ?? 0) - (b.lines[0] ?? 0);
    return cmp * dir || (a.lines[0] ?? 0) - (b.lines[0] ?? 0);
  });

  const total = filtered.length;
  const start = (q.page - 1) * q.pageSize;
  return { total, items: filtered.slice(start, start + q.pageSize) };
}

export function riskSummary(items: ItemView[]) {
  const counts: Record<RiskLevel, number> = { high: 0, medium: 0, low: 0, unknown: 0 };
  let disagreements = 0;
  let provisional = 0;
  for (const i of items) {
    counts[i.risk.level]++;
    if (i.risk.disagreement) disagreements++;
    if (i.risk.provisional) provisional++;
  }
  return { risk: counts, disagreements, provisional };
}

export interface ProviderProgress {
  provider: ProviderId;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  cancelled: number;
  cached: number;
}

export function providerProgress(results: EnrichmentResultDoc[]): ProviderProgress[] {
  const map = new Map<ProviderId, ProviderProgress>();
  for (const r of results) {
    const p = map.get(r.provider) ?? { provider: r.provider, total: 0, completed: 0, failed: 0, pending: 0, cancelled: 0, cached: 0 };
    p.total++;
    if (r.status === 'completed') p.completed++;
    else if (r.status === 'failed') p.failed++;
    else if (r.status === 'cancelled') p.cancelled++;
    else p.pending++;
    if (r.cacheStatus === 'hit') p.cached++;
    map.set(r.provider, p);
  }
  return [...map.values()];
}
