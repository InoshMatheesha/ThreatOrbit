import { useState } from 'react';
import { TYPE_LABELS, type IndicatorType, type PreviewResult } from '../../lib/api';

interface Props {
  result: PreviewResult;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'warn' | 'muted' }) {
  const color = {
    good: 'text-emerald-600 dark:text-emerald-400',
    bad: 'text-red-600 dark:text-red-400',
    warn: 'text-amber-600 dark:text-amber-400',
    muted: 'text-slate-500 dark:text-slate-400',
  }[tone ?? 'muted'];
  return (
    <div className="min-w-[88px] px-3 py-2">
      <div className={`font-mono text-lg font-semibold tabular-nums ${tone ? color : ''}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

export function PreviewSummary({ result }: Props) {
  const { stats, limits, indicators } = result;
  const [copied, setCopied] = useState(false);

  const eligible = indicators.filter((i) => i.lookupEligible).map((i) => i.value);

  async function copyClean() {
    await navigator.clipboard.writeText(eligible.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap divide-x divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        <Stat label="Total" value={stats.total} />
        <Stat label="Valid" value={stats.valid} tone="good" />
        <Stat label="Invalid" value={stats.invalid} tone={stats.invalid ? 'bad' : undefined} />
        <Stat label="Duplicates" value={stats.duplicates} tone={stats.duplicates ? 'warn' : undefined} />
        <Stat label="Unique" value={stats.unique} />
        <Stat label="To enrich" value={stats.eligible} tone="good" />
        <Stat label="Kept local" value={stats.ineligible} tone="muted" />
        <div className="flex flex-1 flex-wrap items-center gap-1.5 px-3 py-2">
          {(Object.keys(stats.byType) as IndicatorType[])
            .filter((t) => stats.byType[t] > 0)
            .map((t) => (
              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-slate-800">
                {TYPE_LABELS[t]} {stats.byType[t]}
              </span>
            ))}
        </div>
      </div>

      {!limits.withinBatchLimit && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {stats.eligible.toLocaleString()} indicators to enrich exceeds the batch limit of {limits.maxBatchSize}. Remove {limits.overBy} or split the input into several batches.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
        <p className="max-w-3xl">
          <strong>Before enriching:</strong> eligible indicators will be sent to third-party providers (VirusTotal, AbuseIPDB, AlienVault OTX,
          URLhaus, GreyNoise). Don't submit indicators that are themselves sensitive, like internal hostnames or customer data in URLs. Private
          IPs and internal domains are already kept local.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={copyClean} disabled={eligible.length === 0}>
            {copied ? 'Copied' : `Copy clean list (${eligible.length})`}
          </button>
          <button
            type="button"
            disabled
            title="Provider lookups arrive in the next build stage. Nothing is sent anywhere yet."
            className="cursor-not-allowed rounded bg-sky-600/40 px-3 py-1.5 text-xs font-medium text-white/70"
          >
            Enrich {stats.eligible} · coming soon
          </button>
        </div>
      </div>
    </section>
  );
}
