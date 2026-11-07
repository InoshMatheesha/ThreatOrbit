import { useEffect, useMemo, useState } from 'react';
import { ActiveKeys, ErrorBanner, Modal, Notice, Spinner } from '../../components/ui';
import { api, createBatch, TYPE_LABELS, type ParseMode, type PreviewResult, type ProviderInfo } from '../../lib/api';
import { duration } from '../../lib/format';
import { Link, navigate } from '../../lib/router';
import type { PreviewInput } from './usePreview';

/** Providers that can rescan an indicator on request. */
const REANALYSIS_PROVIDERS = new Set(['virustotal']);
/** A reanalysis costs one rescan request plus usually one or two result checks. */
const REANALYSIS_REQUESTS_PER_LOOKUP = 2.5;

interface Props {
  input: PreviewInput;
  mode: ParseMode;
  preview: PreviewResult;
  onClose: () => void;
}

export function EnrichDialog({ input, mode, preview, onClose }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [includeReanalysis, setIncludeReanalysis] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .providers()
      .then((r) => setProviders(r.data))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const eligible = useMemo(() => preview.indicators.filter((i) => i.lookupEligible), [preview]);
  const all = providers ?? [];
  const ready = all.filter((p) => p.state === 'ready');
  const noProviders = providers !== null && ready.length === 0;

  const reanalysisProvider = ready.find((p) => REANALYSIS_PROVIDERS.has(p.id)) ?? null;
  const plan = ready.map((p) => {
    const count = eligible.filter((i) => p.supports.includes(i.type)).length;
    const reanalysing = includeReanalysis && REANALYSIS_PROVIDERS.has(p.id);
    const requests = reanalysing ? Math.ceil(count * REANALYSIS_REQUESTS_PER_LOOKUP) : count;
    const remainingToday = p.limits.dailyLimit === null ? null : Math.max(0, p.limits.dailyLimit - p.usedToday);
    return {
      p,
      count,
      reanalysing,
      // A rescan also waits about a minute for the provider to finish.
      minutes: requests / p.limits.requestsPerMinute + (reanalysing && count ? 1 : 0),
      overQuota: remainingToday !== null && requests > remainingToday,
      remainingToday,
    };
  });

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const batch = await createBatch({
        input: input.kind === 'text' ? { kind: 'text', text: input.text } : { kind: 'file', file: input.file },
        mode,
        acknowledgeThirdPartySharing: acknowledged,
        ...(label.trim() ? { label: label.trim() } : {}),
        ...(includeReanalysis && reanalysisProvider ? { includeReanalysis: true } : {}),
      });
      navigate(`/batches/${batch.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const canSubmit = providers !== null && !noProviders && !submitting && acknowledged;

  return (
    <Modal
      title={`Enrich ${eligible.length} indicator${eligible.length === 1 ? '' : 's'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? (
              <>
                <Spinner /> Starting…
              </>
            ) : (
              'Start enrichment'
            )}
          </button>
        </>
      }
    >
      {loadError && <ErrorBanner>Could not load providers: {loadError}</ErrorBanner>}
      {!providers && !loadError && (
        <div className="flex items-center gap-2 text-muted">
          <Spinner /> Loading providers…
        </div>
      )}

      {noProviders && (
        <Notice tone="warn">
          No threat intel provider is configured yet. An administrator can add provider API keys on the{' '}
          <Link to="/providers" className="font-semibold underline">
            Sources
          </Link>{' '}
          page.
        </Notice>
      )}

      {providers && !noProviders && (
        <>
          <div>
            <div className="eyebrow mb-2">Sources that will be asked</div>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              {plan.map(({ p, count, reanalysing, minutes, overQuota, remainingToday }) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 bg-raised/40 px-3.5 py-2.5">
                  <span className="font-semibold">
                    {p.name}
                    {reanalysing && <span className="ml-2 chip bg-brand-soft !text-[10.5px] text-brand">rescan</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted tabular-nums">
                    {p.keyCount !== undefined && <ActiveKeys count={p.keyCount} showLabel={false} />}
                    {count} lookups · {count ? duration(minutes) : 'nothing supported'} ·{' '}
                    {overQuota ? (
                      <span className="text-medium">only {remainingToday} left today</span>
                    ) : (
                      `${p.limits.requestsPerMinute}/min`
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {all.some((p) => p.state !== 'ready') && (
              <p className="mt-2 text-muted">
                Not used:{' '}
                {all
                  .filter((p) => p.state !== 'ready')
                  .map((p) => `${p.name} (${p.state})`)
                  .join(', ')}
                .
              </p>
            )}
            <p className="mt-2 text-muted">
              In this batch:{' '}
              {Object.entries(preview.stats.byType)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${TYPE_LABELS[t as keyof typeof TYPE_LABELS]} ${n}`)
                .join(', ')}
              . Fresh cached results are reused without new requests
              {includeReanalysis && reanalysisProvider ? `, except ${reanalysisProvider.name}, which rescans` : ''}.
            </p>
          </div>

          {reanalysisProvider && (
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-raised/40 px-3.5 py-3">
              <input
                type="checkbox"
                checked={includeReanalysis}
                onChange={(e) => setIncludeReanalysis(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--c-brand)]"
              />
              <span
                title={`Asks ${reanalysisProvider.name} to rescan each indicator it already knows and waits for the fresh verdict. Unknown indicators are never submitted. For URLs and domains the rescan makes scanners contact the target, which its operator may notice.`}
              >
                <span className="block font-medium">Include Reanalysis</span>
                <span className="mt-0.5 block text-muted">
                  Fresh {reanalysisProvider.name} rescan instead of its stored verdict — slower, about 3x the requests.
                </span>
              </span>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block font-medium">Label (optional)</span>
            <input
              className="input w-full"
              value={label}
              maxLength={120}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. INC-2041 phishing wave"
            />
          </label>

          <Notice tone="warn">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--c-brand)]"
              />
              <span title="Confidential means internal hostnames, customer data in URLs or unreleased sample hashes. Private IPs and internal domains are excluded automatically.">
                These {eligible.length} indicator{eligible.length === 1 ? '' : 's'} will be sent to the sources above, and none are
                confidential.
              </span>
            </label>
          </Notice>
        </>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}
    </Modal>
  );
}
