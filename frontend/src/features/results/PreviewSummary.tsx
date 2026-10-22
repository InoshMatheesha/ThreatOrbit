import { useState } from 'react';
import { CheckIcon, CopyIcon } from '../../components/icons';
import { ErrorBanner, Notice, Stat } from '../../components/ui';
import { TYPE_LABELS, type IndicatorType, type PreviewResult } from '../../lib/api';

interface Props {
  result: PreviewResult;
  onEnrich: () => void;
}

export function PreviewSummary({ result, onEnrich }: Props) {
  const { stats, limits, indicators } = result;
  const [copied, setCopied] = useState(false);

  const eligible = indicators.filter((i) => i.lookupEligible).map((i) => i.value);

  async function copyClean() {
    try {
      await navigator.clipboard.writeText(eligible.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="Total" value={stats.total.toLocaleString()} />
        <Stat label="Valid" value={stats.valid.toLocaleString()} tone="low" />
        <Stat label="Invalid" value={stats.invalid.toLocaleString()} tone={stats.invalid ? 'high' : undefined} />
        <Stat label="Duplicates" value={stats.duplicates.toLocaleString()} tone={stats.duplicates ? 'medium' : undefined} />
        <Stat label="Unique" value={stats.unique.toLocaleString()} />
        <Stat label="To enrich" value={stats.eligible.toLocaleString()} tone="brand" />
        <Stat label="Kept local" value={stats.ineligible.toLocaleString()} sub={stats.ineligible ? 'private or internal' : undefined} />
      </div>

      {(Object.keys(stats.byType) as IndicatorType[]).some((t) => stats.byType[t] > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {(Object.keys(stats.byType) as IndicatorType[])
            .filter((t) => stats.byType[t] > 0)
            .map((t) => (
              <span key={t} className="chip bg-raised text-ink ring-1 ring-line">
                {TYPE_LABELS[t]} <span className="font-semibold tabular-nums">{stats.byType[t]}</span>
              </span>
            ))}
        </div>
      )}

      {!limits.withinBatchLimit && (
        <ErrorBanner>
          {stats.eligible.toLocaleString()} indicators to enrich is over the batch limit of {limits.maxBatchSize}. Remove {limits.overBy} or
          split the input into several batches.
        </ErrorBanner>
      )}

      <div className="card flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <Notice tone="warn">
            <strong>Before enriching:</strong> eligible indicators are sent to outside services (VirusTotal, AbuseIPDB, AlienVault OTX,
            URLhaus). Do not submit anything sensitive, such as internal hostnames or customer data inside URLs. Private IPs and internal
            domains stay on this computer.
          </Notice>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
          <button type="button" className="btn" onClick={copyClean} disabled={eligible.length === 0}>
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            {copied ? 'Copied' : `Copy clean list (${eligible.length})`}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={stats.eligible === 0 || !limits.withinBatchLimit}
            onClick={onEnrich}
            title={!limits.withinBatchLimit ? 'Over the batch limit' : undefined}
          >
            Enrich {stats.eligible.toLocaleString()} indicators
          </button>
        </div>
      </div>
    </section>
  );
}
