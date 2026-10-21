import { useEffect, type ReactNode } from 'react';
import type { BatchStatus, ProviderId, ResultView, RiskLevel, Verdict } from '../lib/api';

export function Panel({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const styles = {
    info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
    warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200',
  }[tone];
  return <div className={`rounded-md border px-3 py-2 text-xs ${styles}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-10 text-center text-xs text-slate-500">{children}</div>;
}

export function Spinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-sky-600" aria-hidden />;
}

const RISK_STYLES: Record<RiskLevel, string> = {
  high: 'bg-red-600 text-white',
  medium: 'bg-amber-500 text-white',
  low: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  unknown: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
};
const RISK_LABELS: Record<RiskLevel, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' };

export function RiskBadge({ level, provisional }: { level: RiskLevel; provisional?: boolean }) {
  return (
    <span
      className={`badge ${RISK_STYLES[level]} ${provisional ? 'opacity-70' : ''}`}
      title={provisional ? 'Provisional: some lookups are still pending' : undefined}
    >
      {RISK_LABELS[level]}
      {provisional ? '…' : ''}
    </span>
  );
}

const VERDICT_STYLES: Record<Verdict, string> = {
  malicious: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  suspicious: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  no_detections: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  benign: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
export const VERDICT_LABELS: Record<Verdict, string> = {
  malicious: 'Malicious',
  suspicious: 'Suspicious',
  no_detections: 'No detections',
  benign: 'Benign',
  unknown: 'No verdict',
};

/** Compact per-provider cell: what the provider said, or why it said nothing. */
export function ResultChip({ result }: { result?: ResultView }) {
  if (!result)
    return (
      <span className="text-[11px] text-slate-400" title="Not supported or not configured for this type">
        n/a
      </span>
    );
  if (result.status === 'queued' && result.error) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400" title={result.error.message}>
        <Spinner /> Retrying ({ERROR_LABELS[result.error.kind]?.toLowerCase() ?? 'error'})
      </span>
    );
  }
  if (result.status === 'queued' || result.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
        <Spinner /> {result.status === 'running' ? 'Running' : 'Queued'}
      </span>
    );
  }
  if (result.status === 'cancelled') return <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800">Cancelled</span>;
  if (result.status === 'failed') {
    return (
      <span
        className="badge bg-red-50 text-red-700 ring-1 ring-red-200 ring-inset dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
        title={result.error?.message}
      >
        {ERROR_LABELS[result.error?.kind ?? ''] ?? 'Error'}
      </span>
    );
  }
  if (result.outcome === 'not_found') {
    return (
      <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" title={result.summary}>
        No record
      </span>
    );
  }
  const verdict = result.verdict ?? 'unknown';
  let detail = '';
  if (result.detections) detail = ` ${result.detections.malicious}/${result.detections.total}`;
  else if (result.abuseConfidence !== undefined) detail = ` ${result.abuseConfidence}%`;
  else if (typeof result.metrics?.pulses === 'number') detail = ` ${result.metrics.pulses}p`;
  return (
    <span className={`badge ${VERDICT_STYLES[verdict]}`} title={result.summary}>
      {VERDICT_LABELS[verdict]}
      {detail}
      {result.cacheStatus === 'hit' ? ' ·c' : ''}
    </span>
  );
}

export const ERROR_LABELS: Record<string, string> = {
  timeout: 'Timeout',
  rate_limited: 'Rate limited',
  quota_exhausted: 'Quota used',
  auth: 'Auth failed',
  provider_error: 'Provider error',
  network: 'Network error',
  invalid_request: 'Rejected',
  interrupted: 'Interrupted',
};

const STATUS_STYLES: Record<BatchStatus, string> = {
  queued: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  running: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  cancelling: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  completed_with_errors: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  cancelled: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};
const STATUS_LABELS: Record<BatchStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  cancelling: 'Cancelling',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  cancelled: 'Cancelled',
};

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`badge ${STATUS_STYLES[status]}`}>
      {(status === 'running' || status === 'cancelling') && <Spinner />} {STATUS_LABELS[status]}
    </span>
  );
}

export function ProgressBar({ done, failed = 0, total }: { done: number; failed?: number; total: number }) {
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800"
      role="progressbar"
      aria-valuenow={done + failed}
      aria-valuemax={total}
    >
      <div className="bg-emerald-500" style={{ width: pct(done) }} />
      <div className="bg-red-500" style={{ width: pct(failed) }} />
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-4 py-2.5 text-sm font-semibold dark:border-slate-800">{title}</div>
        <div className="space-y-3 px-4 py-3 text-xs">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-2.5 dark:border-slate-800">{footer}</div>
      </div>
    </div>
  );
}

export const PROVIDER_SHORT: Record<ProviderId, string> = {
  virustotal: 'VT',
  abuseipdb: 'AbuseIPDB',
  otx: 'OTX',
  urlhaus: 'URLhaus',
};
