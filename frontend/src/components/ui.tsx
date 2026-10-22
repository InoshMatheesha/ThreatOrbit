import { useEffect, type ReactNode } from 'react';
import type { BatchStatus, ProviderId, ResultView, RiskLevel, Verdict } from '../lib/api';
import { AlertIcon, InfoIcon, XIcon } from './icons';

/* ---------- Layout ---------- */

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="animate-rise mx-auto w-full max-w-[1240px] px-4 pt-5 pb-28 sm:px-6 sm:pt-8 lg:pb-12">
      {title && (
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-7">
          <div className="min-w-0">
            <h1 className="page-title">{title}</h1>
            {subtitle && <p className="mt-1 max-w-2xl text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="space-y-5">{children}</div>
    </main>
  );
}

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
    <section className={`card overflow-hidden ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return <img src="/logo.png" alt="" width={size} height={size} className={`shrink-0 select-none ${className}`} draggable={false} />;
}

/* ---------- Feedback ---------- */

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-high/30 bg-high-soft px-3.5 py-2.5 text-[13px] text-high"
    >
      <AlertIcon size={16} className="mt-0.5" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  const styles = tone === 'warn' ? 'border-medium/30 bg-medium-soft text-medium' : 'border-brand/25 bg-brand-soft text-brand';
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] ${styles}`}>
      {tone === 'warn' ? <AlertIcon size={16} className="mt-0.5" /> : <InfoIcon size={16} className="mt-0.5" />}
      <div className="min-w-0 text-ink/90">{children}</div>
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-[13px] text-muted">
      {icon && <div className="mb-1 text-line-strong">{icon}</div>}
      <div className="max-w-sm">{children}</div>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`}
      aria-hidden
    />
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/* ---------- Controls ---------- */

export function Segmented<T extends string | boolean>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; hint?: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={`min-h-8 rounded-[10px] px-3 text-[13px] font-medium transition ${
            value === o.value ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Prev
      </button>
      <span className="min-w-14 text-center text-[13px] text-muted tabular-nums">
        {page} / {pageCount}
      </span>
      <button type="button" className="btn" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: ReactNode;
  tone?: 'high' | 'medium' | 'low' | 'brand';
  sub?: ReactNode;
}) {
  const color = tone ? { high: 'text-high', medium: 'text-medium', low: 'text-low', brand: 'text-brand' }[tone] : '';
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className={`text-[24px] leading-none font-semibold tracking-tight tabular-nums ${color}`}>{value}</div>
      <div className="mt-1.5 text-[12px] text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted/80">{sub}</div>}
    </div>
  );
}

/* ---------- Risk ---------- */

const RISK: Record<RiskLevel, { badge: string; dot: string; label: string; plain: string }> = {
  high: { badge: 'bg-high-soft text-high', dot: 'bg-high', label: 'High', plain: 'Likely dangerous' },
  medium: { badge: 'bg-medium-soft text-medium', dot: 'bg-medium', label: 'Medium', plain: 'Worth a look' },
  low: { badge: 'bg-low-soft text-low', dot: 'bg-low', label: 'Low', plain: 'No warning signs' },
  unknown: { badge: 'bg-unknown-soft text-unknown', dot: 'bg-unknown', label: 'Unknown', plain: 'Not enough information' },
};
export const RISK_PLAIN = Object.fromEntries(Object.entries(RISK).map(([k, v]) => [k, v.plain])) as Record<RiskLevel, string>;

export function RiskBadge({ level, provisional }: { level: RiskLevel; provisional?: boolean }) {
  const r = RISK[level];
  return (
    <span
      className={`badge ${r.badge} ${provisional ? 'opacity-70' : ''}`}
      title={provisional ? 'Provisional: some lookups are still pending' : r.plain}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} aria-hidden />
      {r.label}
      {provisional ? '…' : ''}
    </span>
  );
}

/** Donut of how many indicators landed at each risk level. */
export function RiskGauge({ counts, size = 148 }: { counts: Record<RiskLevel, number>; size?: number }) {
  const order: RiskLevel[] = ['high', 'medium', 'low', 'unknown'];
  const total = order.reduce((n, k) => n + counts[k], 0);
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const colors: Record<RiskLevel, string> = {
    high: 'var(--c-high)',
    medium: 'var(--c-medium)',
    low: 'var(--c-low)',
    unknown: 'var(--c-line-strong)',
  };
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${total} indicators by risk`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-raised)" strokeWidth={stroke} />
          {total > 0 &&
            order.map((k) => {
              const len = (counts[k] / total) * c;
              const gap = counts[k] === total ? 0 : Math.min(3, len);
              const el = counts[k] ? (
                <circle
                  key={k}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={colors[k]}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              ) : null;
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[28px] leading-none font-semibold tracking-tight tabular-nums">{total}</div>
          <div className="mt-1 text-[11px] text-muted">indicators</div>
        </div>
      </div>
      <ul className="min-w-[150px] flex-1 space-y-2">
        {order.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${RISK[k].dot}`} aria-hidden />
              {RISK[k].label}
            </span>
            <span className="font-semibold tabular-nums">{counts[k]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERDICT_STYLES: Record<Verdict, string> = {
  malicious: 'bg-high-soft text-high',
  suspicious: 'bg-medium-soft text-medium',
  no_detections: 'bg-low-soft text-low',
  benign: 'bg-brand-soft text-brand',
  unknown: 'bg-unknown-soft text-unknown',
};
export const VERDICT_LABELS: Record<Verdict, string> = {
  malicious: 'Malicious',
  suspicious: 'Suspicious',
  no_detections: 'No detections',
  benign: 'Benign',
  unknown: 'No verdict',
};

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

/** Compact per-provider cell: what the provider said, or why it said nothing. */
export function ResultChip({ result }: { result?: ResultView }) {
  if (!result)
    return (
      <span className="text-[11px] text-muted/70" title="Not supported or not configured for this type">
        n/a
      </span>
    );
  if (result.status === 'queued' && result.error) {
    return (
      <span className="chip bg-medium-soft text-medium" title={result.error.message}>
        <Spinner /> Retrying ({ERROR_LABELS[result.error.kind]?.toLowerCase() ?? 'error'})
      </span>
    );
  }
  if (result.status === 'queued' || result.status === 'running') {
    return (
      <span className="chip bg-raised text-muted">
        <Spinner /> {result.status === 'running' ? 'Running' : 'Queued'}
      </span>
    );
  }
  if (result.status === 'cancelled') return <span className="chip bg-raised text-muted">Cancelled</span>;
  if (result.status === 'failed') {
    return (
      <span className="chip bg-high-soft text-high" title={result.error?.message}>
        {ERROR_LABELS[result.error?.kind ?? ''] ?? 'Error'}
      </span>
    );
  }
  if (result.outcome === 'not_found') {
    return (
      <span className="chip bg-raised text-muted" title={result.summary}>
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
    <span className={`chip ${VERDICT_STYLES[verdict]}`} title={result.summary}>
      {VERDICT_LABELS[verdict]}
      {detail}
      {result.cacheStatus === 'hit' ? ' ·c' : ''}
    </span>
  );
}

/* ---------- Batch status & progress ---------- */

const STATUS_STYLES: Record<BatchStatus, string> = {
  queued: 'bg-unknown-soft text-unknown',
  running: 'bg-brand-soft text-brand',
  cancelling: 'bg-medium-soft text-medium',
  completed: 'bg-low-soft text-low',
  completed_with_errors: 'bg-medium-soft text-medium',
  cancelled: 'bg-unknown-soft text-unknown',
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
      {status === 'running' || status === 'cancelling' ? <Spinner /> : null}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function ProgressBar({
  done,
  failed = 0,
  total,
  className = '',
}: {
  done: number;
  failed?: number;
  total: number;
  className?: string;
}) {
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  return (
    <div
      className={`flex h-2 w-full overflow-hidden rounded-full bg-raised ring-1 ring-line ring-inset ${className}`}
      role="progressbar"
      aria-valuenow={done + failed}
      aria-valuemax={total}
    >
      <div className="bg-low transition-[width] duration-500" style={{ width: pct(done) }} />
      <div className="bg-high transition-[width] duration-500" style={{ width: pct(failed) }} />
    </div>
  );
}

/* ---------- Dialogs ---------- */

/** Centered dialog on desktop, bottom sheet on phones. */
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#050912]/55 backdrop-blur-[3px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card animate-sheet flex max-h-[92dvh] w-full flex-col rounded-b-none sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <button type="button" className="btn-ghost -mr-2 !min-h-8 !px-2" onClick={onClose} aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-[13px]">{children}</div>
        <div className="pb-safe flex flex-col-reverse gap-2 border-t border-line px-5 py-3.5 sm:flex-row sm:justify-end [&>*]:justify-center">
          {footer}
        </div>
      </div>
    </div>
  );
}

export const PROVIDER_SHORT: Record<ProviderId, string> = {
  virustotal: 'VirusTotal',
  abuseipdb: 'AbuseIPDB',
  otx: 'OTX',
  urlhaus: 'URLhaus',
};
