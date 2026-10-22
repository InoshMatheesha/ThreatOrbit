import { RefreshIcon, SparklesIcon } from '../../components/icons';
import { ErrorBanner, Skeleton, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { AiBadge, AiDisclaimer } from './BatchExplainer';
import { useExplanation } from './explain';

const CONFIDENCE: Record<'low' | 'medium' | 'high', string> = {
  low: 'The evidence is thin, so treat this as a hint.',
  medium: 'There is some evidence behind this.',
  high: 'The evidence is strong.',
};

/** Plain-English explanation of one indicator, shown at the top of the detail panel. */
export function ItemExplainer({ batchId, index }: { batchId: string; index: number }) {
  const ai = useExplanation(
    {
      load: () => api.getItemExplanation(batchId, index),
      generate: (refresh) => api.explainItem(batchId, index, refresh),
    },
    [batchId, index],
  );

  if (ai.loading) return <Skeleton className="h-24 w-full" />;
  if (!ai.enabled) return null;
  const x = ai.data?.explanation;

  return (
    <section className="rounded-2xl border border-brand/25 bg-brand-soft/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <AiBadge>Plain English</AiBadge>
        {x && (
          <button
            type="button"
            className="btn-ghost !min-h-8 !px-2"
            disabled={ai.busy}
            onClick={() => void ai.generate(true)}
            aria-label="Rewrite explanation"
          >
            {ai.busy ? <Spinner /> : <RefreshIcon size={15} />}
          </button>
        )}
      </div>
      {!x ? (
        <div className="mt-3 space-y-3">
          <p className="text-[13px] text-ink/85">Not sure what this means? Get a short explanation without the jargon.</p>
          {ai.error && <ErrorBanner>{ai.error}</ErrorBanner>}
          <button type="button" className="btn-primary" disabled={ai.busy} onClick={() => void ai.generate()}>
            {ai.busy ? (
              <>
                <Spinner /> Writing…
              </>
            ) : (
              <>
                <SparklesIcon size={16} /> Explain this
              </>
            )}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3 text-[13px]">
          {ai.data!.stale && <p className="text-medium">Results changed since this was written. Use the refresh button to update it.</p>}
          {ai.error && <ErrorBanner>{ai.error}</ErrorBanner>}
          <h3 className="text-[16px] leading-snug font-semibold tracking-tight">{x.headline}</h3>
          <div>
            <div className="eyebrow mb-0.5">What it is</div>
            <p>{x.whatIsIt}</p>
          </div>
          <div>
            <div className="eyebrow mb-0.5">Why it matters</div>
            <p>{x.whyItMatters}</p>
          </div>
          {x.nextSteps.length > 0 && (
            <div>
              <div className="eyebrow mb-1">What to do</div>
              <ul className="list-disc space-y-1 pl-5">
                {x.nextSteps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[12px] text-muted">{CONFIDENCE[x.confidence]}</p>
          <AiDisclaimer provider={ai.status?.providerName} />
        </div>
      )}
    </section>
  );
}
