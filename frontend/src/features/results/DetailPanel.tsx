import { useEffect, useState } from 'react';
import { ERROR_LABELS, ErrorBanner, Notice, ResultChip, RiskBadge, Spinner, VERDICT_LABELS } from '../../components/ui';
import { api, TYPE_LABELS, type ItemView, type ProviderSnapshot, type ResultView } from '../../lib/api';
import { dateTime, relativeTime } from '../../lib/format';

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
      className="break-all text-sky-700 underline hover:text-sky-900 dark:text-sky-400"
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
  noise: 'Internet noise',
  riot: 'Known business service',
  classification: 'Classification',
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
      <div className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700">
        <span className="font-medium">{provider.name}</span>:{' '}
        {provider.state !== 'ready' ? `not used (${provider.state})` : 'does not support this indicator type'}
      </div>
    );
  }

  const metrics = Object.entries(result.metrics ?? {});
  const retryable = Boolean(onRetry) && result.status === 'failed' && result.error?.kind !== 'invalid_request';

  return (
    <div className="rounded border border-slate-200 text-xs dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{provider.name}</span>
          <ResultChip result={result} />
        </div>
        <span className="text-[11px] text-slate-500" title={result.lookedUpAt ? `Lookup time: ${dateTime(result.lookedUpAt)}` : undefined}>
          {result.lookedUpAt
            ? `${result.cacheStatus === 'hit' ? 'cached · ' : ''}looked up ${relativeTime(result.lookedUpAt)}`
            : result.status}
          {result.attempts > 1 ? ` · ${result.attempts} attempts` : ''}
        </span>
      </div>
      <div className="space-y-2 px-3 py-2">
        {result.summary && <p>{result.summary}</p>}
        {result.verdict && result.status === 'completed' && (
          <p className="text-slate-500">
            Provider verdict: {VERDICT_LABELS[result.verdict]}
            {result.outcome === 'not_found' ? ' (no record: this is not the same as clean)' : ''}
          </p>
        )}
        {result.detections && result.detections.total > 0 && (
          <div>
            <div className="mb-0.5 flex justify-between text-[11px] text-slate-500">
              <span>
                {result.detections.malicious} malicious · {result.detections.suspicious} suspicious · {result.detections.harmless} harmless
                · {result.detections.undetected} undetected
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
              <div className="bg-red-500" style={{ width: `${(result.detections.malicious / result.detections.total) * 100}%` }} />
              <div className="bg-amber-400" style={{ width: `${(result.detections.suspicious / result.detections.total) * 100}%` }} />
            </div>
          </div>
        )}
        {result.abuseConfidence !== undefined && (
          <div>
            <div className="mb-0.5 text-[11px] text-slate-500">Abuse confidence {result.abuseConfidence}%</div>
            <div className="h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
              <div
                className={
                  result.abuseConfidence >= 75
                    ? 'h-full bg-red-500'
                    : result.abuseConfidence >= 25
                      ? 'h-full bg-amber-400'
                      : 'h-full bg-emerald-500'
                }
                style={{ width: `${result.abuseConfidence}%` }}
              />
            </div>
          </div>
        )}
        {metrics.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {metrics.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{METRIC_LABELS[k] ?? k}</dt>
                <dd className="break-all">{typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {result.tags && result.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {result.tags.map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-slate-800">
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
            <SafeLink href={result.permalink}>Open in {provider.name} ↗</SafeLink>
          </div>
        )}
        {result.error && result.status !== 'completed' && (
          <div className={result.status === 'failed' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>
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
            {retrying ? 'Retrying…' : 'Retry this lookup'}
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
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[560px] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      aria-label="Indicator details"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Indicator details</span>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs">
        {error && <ErrorBanner>{error}</ErrorBanner>}
        {!item && !error && (
          <div className="flex items-center gap-2 text-slate-500">
            <Spinner /> Loading…
          </div>
        )}
        {item && (
          <>
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-sm break-all">{item.value}</div>
                <button
                  type="button"
                  className="btn shrink-0"
                  onClick={async () => {
                    await navigator.clipboard.writeText(item.value);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              {item.display && <div className="text-slate-500">Displayed as {item.display}</div>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <RiskBadge level={item.risk.level} provisional={item.risk.provisional} />
                <span className="text-slate-500">{TYPE_LABELS[item.type]}</span>
                <span className="text-slate-500">
                  {item.risk.coverage.withRecord} with record · {item.risk.coverage.noRecord} no record · {item.risk.coverage.failed} failed
                  · {item.risk.coverage.pending} pending
                </span>
              </div>
            </div>

            <div>
              <div className="mb-1 font-semibold">Why this risk level</div>
              <ul className="list-inside list-disc space-y-0.5 text-slate-700 dark:text-slate-300">
                {item.risk.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>

            {item.risk.disagreement && (
              <Notice tone="warn">
                <strong>Providers disagree:</strong> {item.risk.disagreement.summary}.
              </Notice>
            )}

            {item.notes.length > 0 && (
              <div className="text-amber-700 dark:text-amber-400">
                {item.notes.map((n) => (
                  <div key={n}>{n}</div>
                ))}
              </div>
            )}

            <div className="text-slate-500">
              Input line{item.lines.length > 1 ? 's' : ''} {item.lines.join(', ')} · submitted as{' '}
              {item.originals.map((o, i) => (
                <span key={o}>
                  {i > 0 && ', '}
                  <code className="font-mono">{o}</code>
                </span>
              ))}
            </div>

            <div className="space-y-2">
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
  );
}
