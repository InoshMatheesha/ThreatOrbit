import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner, Modal, Notice, Spinner } from '../../components/ui';
import { api, createBatch, TYPE_LABELS, type ParseMode, type PreviewResult, type ProviderInfo } from '../../lib/api';
import { duration } from '../../lib/format';
import { Link, navigate } from '../../lib/router';
import type { PreviewInput } from './usePreview';

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
  const [demo, setDemo] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .providers()
      .then((r) => setProviders(r.data))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const eligible = useMemo(() => preview.indicators.filter((i) => i.lookupEligible), [preview]);
  const real = providers?.filter((p) => !p.synthetic) ?? [];
  const ready = real.filter((p) => p.state === 'ready');
  const noProviders = providers !== null && ready.length === 0;
  const useDemo = demo || noProviders;

  const plan = (useDemo ? (providers?.filter((p) => p.synthetic) ?? []) : ready).map((p) => {
    const count = eligible.filter((i) => p.supports.includes(i.type)).length;
    const remainingToday = p.limits.dailyLimit === null ? null : Math.max(0, p.limits.dailyLimit - p.usedToday);
    return { p, count, minutes: count / p.limits.requestsPerMinute, overQuota: remainingToday !== null && count > remainingToday, remainingToday };
  });

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const batch = await createBatch({
        input: input.kind === 'text' ? { kind: 'text', text: input.text } : { kind: 'file', file: input.file },
        mode,
        demo: useDemo,
        acknowledgeThirdPartySharing: !useDemo && acknowledged,
        ...(label.trim() ? { label: label.trim() } : {}),
      });
      navigate(`/batches/${batch.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const canSubmit = providers !== null && !submitting && (useDemo || acknowledged);

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
            {submitting ? 'Starting…' : useDemo ? 'Run demo batch' : 'Start enrichment'}
          </button>
        </>
      }
    >
      {loadError && <ErrorBanner>Could not load providers: {loadError}</ErrorBanner>}
      {!providers && !loadError && (
        <div className="flex items-center gap-2 text-slate-500">
          <Spinner /> Loading providers…
        </div>
      )}

      {noProviders && (
        <Notice tone="warn">
          No provider has an API key yet, so only a demo run is possible. Add keys to <code>backend/.env</code> and restart, then check
          them on the <Link to="/providers" className="underline">Providers</Link> page.
        </Notice>
      )}

      {providers && (
        <>
          <div>
            <div className="mb-1 font-medium">{useDemo ? 'Synthetic demo provider' : 'Providers that will receive lookups'}</div>
            <table className="w-full text-left">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {plan.map(({ p, count, minutes, overQuota, remainingToday }) => (
                  <tr key={p.id}>
                    <td className="py-1 pr-2 font-medium">{p.name}</td>
                    <td className="py-1 pr-2 tabular-nums">{count} lookups</td>
                    <td className="py-1 pr-2 text-slate-500">{count ? duration(minutes) : 'nothing supported'}</td>
                    <td className="py-1 text-slate-500">
                      {overQuota ? <span className="text-amber-600">only {remainingToday} left today</span> : `${p.limits.requestsPerMinute}/min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!useDemo && real.some((p) => p.state !== 'ready') && (
              <p className="mt-1 text-slate-500">
                Not used: {real.filter((p) => p.state !== 'ready').map((p) => `${p.name} (${p.state})`).join(', ')}.
              </p>
            )}
            <p className="mt-1 text-slate-500">
              Types in this batch:{' '}
              {Object.entries(preview.stats.byType)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${TYPE_LABELS[t as keyof typeof TYPE_LABELS]} ${n}`)
                .join(', ')}
              . Fresh cached results are reused without new requests.
            </p>
          </div>

          <label className="block">
            <span className="mb-1 block font-medium">Label (optional)</span>
            <input className="input w-full" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. INC-2041 phishing wave" />
          </label>

          {!noProviders && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} className="mt-0.5" />
              <span>
                <strong>Demo mode</strong>: synthetic results only, nothing leaves this PC and no quota is used. Results are labeled
                SYNTHETIC and are not threat intelligence.
              </span>
            </label>
          )}

          {!useDemo && (
            <Notice tone="warn">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5" />
                <span>
                  I understand these {eligible.length} indicators will be sent to the third-party providers listed above, and none of them
                  are confidential (internal hostnames, customer data in URLs, unreleased sample hashes). Private IPs and internal domains
                  are already excluded.
                </span>
              </label>
            </Notice>
          )}
        </>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}
    </Modal>
  );
}
