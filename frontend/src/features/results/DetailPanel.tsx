import { useEffect, useState } from 'react';
import { CheckIcon, CopyIcon, ExternalIcon, RefreshIcon, XIcon } from '../../components/icons';
import {
  ERROR_LABELS,
  ErrorBanner,
  Notice,
  ResultChip,
  RISK_PLAIN,
  RiskBadge,
  Skeleton,
  Spinner,
  VERDICT_LABELS,
} from '../../components/ui';
import { api, TYPE_LABELS, type ItemView, type ProviderSnapshot, type ResultView } from '../../lib/api';
import { dateTime, relativeTime } from '../../lib/format';
import { ItemExplainer } from '../ai/ItemExplainer';

interface Props {
  batchId: string;
  index: number;
  version: number;
  /** Whether the current user may retry lookups in this batch. */
  canRetry: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Only https links from providers are rendered as links (no javascript:/data: URLs). */
function SafeLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (!/^https:\/\//i.test(href)) return <span className="break-all">{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 break-all text-brand underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

const METRIC_LABELS: Record<string, string> = {
  reputation: 'Reputation',
  lastAnalysis: 'Last analysis',
  country: 'Country',
  asOwner: 'AS owner',
  asn: 'ASN',
  network: 'Network',
  registrar: 'Registrar',
  created: 'Created',
  categories: 'Categories',
  fileType: 'File type',
  fileName: 'File name',
  fileSize: 'File size',
  threatLabel: 'Threat label',
  finalUrl: 'Final URL',
  httpStatus: 'HTTP status',
  title: 'Page title',
  totalReports: 'Reports (90 d)',
  distinctReporters: 'Distinct reporters',
  lastReported: 'Last reported',
  usageType: 'Usage type',
  isp: 'ISP',
  domain: 'Domain',
  tor: 'Tor exit node',
  whitelisted: 'Whitelisted',
  pulses: 'Pulses',
  malwareFamilies: 'Malware families',
  adversaries: 'Adversaries',
  whitelistedBy: 'Whitelisted by',
  urlStatus: 'URL status',
  threat: 'Threat',
  dateAdded: 'Date added',
  payloads: 'Payloads',
  blacklists: 'Blocklists',
  signature: 'Signature',
  firstSeen: 'First seen',
  lastSeen: 'Last seen',
  urlCount: 'Malware URLs',
  onlineUrls: 'Online now',
  name: 'Name',
};

function ProviderCard({
  result,
  provider,
  onRetry,
}: {
  result?: ResultView;
  provider: ProviderSnapshot;
  onRetry?: (id: string) => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!result) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted">
        <span className="font-semibold text-ink">{provider.name}</span>:{' '}
        {provider.state !== 'ready' ? `not used (${provider.state})` : 'does not support this indicator type'}
      </div>
    );
  }

  const metrics = Object.entries(result.metrics ?? {});
  const retryable = Boolean(onRetry) && result.status === 'failed' && result.error?.kind !== 'invalid_request';

  return (
    <div className="overflow-hidden rounded-xl border border-line text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-raised/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{provider.name}</span>
          <ResultChip result={result} />
        </div>
        <span className="text-[11px] text-muted" title={result.lookedUpAt ? `Lookup time: ${dateTime(result.lookedUpAt)}` : undefined}>
          {result.lookedUpAt
            ? `${result.cacheStatus === 'hit' ? 'cached · ' : ''}looked up ${relativeTime(result.lookedUpAt)}`
            : result.status}
          {result.attempts > 1 ? ` · ${result.attempts} attempts` : ''}
        </span>
      </div>
      <div className="space-y-3 px-4 py-3">
        {result.summary && <p>{result.summary}</p>}
        {result.verdict && result.status === 'completed' && (
          <p className="text-muted">
            Provider verdict: {VERDICT_LABELS[result.verdict]}
            {result.outcome === 'not_found' ? ' (no record: this is not the same as clean)' : ''}
          </p>
        )}
        {result.detections && result.detections.total > 0 && (
          <div>
            <div className="mb-1 text-[12px] text-muted">
              {result.detections.malicious} malicious · {result.detections.suspicious} suspicious · {result.detections.harmless} harmless ·{' '}
              {result.detections.undetected} undetected
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-raised ring-1 ring-line ring-inset">
              <div className="bg-high" style={{ width: `${(result.detections.malicious / result.detections.total) * 100}%` }} />
              <div className="bg-medium" style={{ width: `${(result.detections.suspicious / result.detections.total) * 100}%` }} />
            </div>
          </div>
        )}
        {result.abuseConfidence !== undefined && (
          <div>
            <div className="mb-1 text-[12px] text-muted">Abuse confidence {result.abuseConfidence}%</div>
            <div className="h-2 overflow-hidden rounded-full bg-raised ring-1 ring-line ring-inset">
              <div
                className={
                  result.abuseConfidence >= 75 ? 'h-full bg-high' : result.abuseConfidence >= 25 ? 'h-full bg-medium' : 'h-full bg-low'
                }
                style={{ width: `${result.abuseConfidence}%` }}
              />
            </div>
          </div>
        )}
        {metrics.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {metrics.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{METRIC_LABELS[k] ?? k}</dt>
                <dd className="break-all">{typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {result.tags && result.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.tags.map((t) => (
              <span key={t} className="chip bg-raised font-mono ring-1 ring-line">
                {t}
              </span>
            ))}
          </div>
        )}
        {result.references && result.references.length > 0 && (
          <ul className="list-inside list-disc space-y-0.5">
            {result.references.map((r) => (
              <li key={r.url}>
                <SafeLink href={r.url}>{r.title}</SafeLink>
              </li>
            ))}
          </ul>
        )}
        {result.permalink && (
          <div>
            <SafeLink href={result.permalink}>
              Open in {provider.name} <ExternalIcon size={13} />
            </SafeLink>
          </div>
        )}
        {result.error && result.status !== 'completed' && (
          <div className={result.status === 'failed' ? 'text-high' : 'text-medium'}>
            <strong>{ERROR_LABELS[result.error.kind] ?? result.error.kind}:</strong> {result.error.message}
          </div>
        )}
        {retryable && (
          <button
            type="button"
            className="btn"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              setError(null);
              try {
                await onRetry!(result.id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setRetrying(false);
              }
            }}
          >
            {retrying ? <Spinner /> : <RefreshIcon size={15} />} {retrying ? 'Retrying…' : 'Retry this lookup'}
          </button>
        )}
        {error && <ErrorBanner>{error}</ErrorBanner>}
      </div>
    </div>
  );
}

export function DetailPanel({ batchId, index, version, canRetry, onClose, onChanged }: Props) {
  const [item, setItem] = useState<ItemView | null>(null);
  const [providers, setProviders] = useState<ProviderSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getItem(batchId, index)
      .then((r) => {
        if (cancelled) return;
        setItem(r.data);
        setProviders(r.meta.providers);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [batchId, index, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-[#050912]/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <aside
        className="animate-slide-in absolute inset-y-0 right-0 flex w-full flex-col bg-surface shadow-2xl sm:max-w-[580px] sm:border-l sm:border-line"
        aria-label="Indicator details"
      >
        <div className="pt-safe flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <span className="eyebrow">Indicator details</span>
          <button type="button" className="btn-ghost !px-2.5" onClick={onClose} aria-label="Close details">
            <XIcon size={18} />
          </button>
        </div>
        <div className="pb-safe flex-1 space-y-5 overflow-y-auto px-4 py-5 text-[13px] sm:px-5">
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {!item && !error && (
            <div className="space-y-3">
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
          {item && (
            <>
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="font-mono text-[16px] leading-snug font-medium break-all">{item.value}</div>
                  <button
                    type="button"
                    className="btn shrink-0"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(item.value);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      } catch {
                        /* clipboard blocked */
                      }
                    }}
                  >
                    {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                {item.display && <div className="mt-1 text-muted">Displayed as {item.display}</div>}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <RiskBadge level={item.risk.level} provisional={item.risk.provisional} />
                  <span className="font-medium">{RISK_PLAIN[item.risk.level]}</span>
                  <span className="text-muted">{TYPE_LABELS[item.type]}</span>
                </div>
                <div className="mt-1.5 text-[12px] text-muted">
                  {item.risk.coverage.withRecord} with a record · {item.risk.coverage.noRecord} no record · {item.risk.coverage.failed}{' '}
                  failed · {item.risk.coverage.pending} pending
                </div>
              </div>

              <ItemExplainer batchId={batchId} index={index} />

              <div>
                <div className="eyebrow mb-2">Why this risk level</div>
                <ul className="space-y-1.5">
                  {item.risk.reasons.map((r) => (
                    <li key={r} className="flex gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted" aria-hidden />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>

              {item.risk.disagreement && (
                <Notice tone="warn">
                  <strong>Sources disagree:</strong> {item.risk.disagreement.summary}.
                </Notice>
              )}

              {item.notes.length > 0 && (
                <div className="space-y-1 text-medium">
                  {item.notes.map((n) => (
                    <div key={n}>{n}</div>
                  ))}
                </div>
              )}

              <div className="text-[12px] text-muted">
                Input line{item.lines.length > 1 ? 's' : ''} {item.lines.join(', ')} · submitted as{' '}
                {item.originals.map((o, i) => (
                  <span key={o}>
                    {i > 0 && ', '}
                    <code className="font-mono">{o}</code>
                  </span>
                ))}
              </div>

              <div className="space-y-3">
                <div className="eyebrow">Evidence by source</div>
                {providers
                  .filter((p) => p.state === 'ready' || item.results[p.id])
                  .map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      result={item.results[p.id]}
                      {...(canRetry
                        ? {
                            onRetry: async (id: string) => {
                              await api.retryResult(id);
                              onChanged();
                            },
                          }
                        : {})}
                    />
                  ))}
                {providers
                  .filter((p) => p.state !== 'ready' && !item.results[p.id])
                  .map((p) => (
                    <ProviderCard key={p.id} provider={p} />
                  ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
