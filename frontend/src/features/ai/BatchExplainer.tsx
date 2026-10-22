import { useState } from 'react';
import { CheckIcon, CopyIcon, RefreshIcon, SparklesIcon } from '../../components/icons';
import { ErrorBanner, Notice, Skeleton, Spinner } from '../../components/ui';
import { api, type BatchExplanation } from '../../lib/api';
import { relativeTime } from '../../lib/format';
import { useExplanation } from './explain';

export function AiBadge({ children = 'AI explanation' }: { children?: string }) {
  return (
    <span className="chip bg-brand-soft text-brand ring-1 ring-brand/20">
      <SparklesIcon size={13} /> {children}
    </span>
  );
}

export function AiDisclaimer() {
  return (
    <p className="text-[11px] leading-snug text-muted">
      Written by AI from the lookup results in this batch. It can make mistakes, so check the evidence before acting. Indicators and their
      results (not names or labels) are sent to Anthropic to write it.
    </p>
  );
}

function plainText(x: BatchExplanation): string {
  return [
    x.headline,
    '',
    x.overview,
    '',
    'What stands out:',
    ...x.keyPoints.map((p) => `- ${p}`),
    '',
    'What to do next:',
    ...x.nextSteps.map((p, i) => `${i + 1}. ${p}`),
    ...(x.indicators.length ? ['', 'Indicators:', ...x.indicators.map((i) => `- ${i.value}: ${i.headline}. ${i.explanation}`)] : []),
  ].join('\n');
}

export function BatchExplainer({ batchId, terminal }: { batchId: string; terminal: boolean }) {
  const ai = useExplanation(
    {
      load: () => api.getBatchExplanation(batchId),
      generate: (refresh) => api.explainBatch(batchId, refresh),
    },
    [batchId, terminal],
  );
  const [copied, setCopied] = useState(false);

  if (ai.loading) {
    return (
      <section className="card space-y-3 p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </section>
    );
  }

  if (!ai.enabled) {
    return (
      <section className="card flex items-start gap-4 p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-muted">
          <SparklesIcon size={20} />
        </span>
        <div>
          <h2 className="text-[14px] font-semibold">Plain-English explanations are off</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            An administrator can switch them on by adding an Anthropic API key (
            <code className="font-mono text-[12px]">ANTHROPIC_API_KEY</code>) to the server settings.
          </p>
        </div>
      </section>
    );
  }

  const x = ai.data?.explanation;

  return (
    <section className="card relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ backgroundImage: 'linear-gradient(90deg, transparent, var(--c-accent), var(--c-brand), transparent)' }}
        aria-hidden
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <AiBadge>AI analyst</AiBadge>
          {ai.data && <span className="text-[12px] text-muted">written {relativeTime(ai.data.generatedAt)}</span>}
        </div>
        {x && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(plainText(x));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked */
                }
              }}
            >
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn-ghost" disabled={ai.busy} onClick={() => void ai.generate(true)}>
              {ai.busy ? <Spinner /> : <RefreshIcon size={16} />} Rewrite
            </button>
          </div>
        )}
      </div>

      {!x ? (
        <div className="space-y-4 px-4 pt-3 pb-5 sm:px-5">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">Explain these results in plain English</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-muted">
              Get a short summary of what was found, why it matters and what to do next, written for people who are not security experts.
            </p>
          </div>
          {!terminal && <Notice>Lookups are still running. You can explain now, or wait for the full picture.</Notice>}
          {ai.error && <ErrorBanner>{ai.error}</ErrorBanner>}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={ai.busy} onClick={() => void ai.generate()}>
              {ai.busy ? (
                <>
                  <Spinner /> Writing…
                </>
              ) : (
                <>
                  <SparklesIcon size={16} /> Explain results
                </>
              )}
            </button>
            <span className="max-w-md text-[11px] text-muted">
              Sends the indicators and what the services said about them to Anthropic. No names or batch labels.
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-5 px-4 pt-3 pb-5 sm:px-5">
          {ai.data!.stale && (
            <Notice tone="warn">
              New results arrived after this was written.{' '}
              <button type="button" className="font-semibold underline" onClick={() => void ai.generate(true)} disabled={ai.busy}>
                Rewrite it
              </button>{' '}
              to include them.
            </Notice>
          )}
          {ai.error && <ErrorBanner>{ai.error}</ErrorBanner>}
          <div>
            <h2 className="text-[20px] leading-snug font-semibold tracking-tight">{x.headline}</h2>
            <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-ink/90">{x.overview}</p>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {x.keyPoints.length > 0 && (
              <div className="rounded-xl bg-raised/70 p-4 ring-1 ring-line">
                <div className="eyebrow mb-2.5">What stands out</div>
                <ul className="space-y-2 text-[13px]">
                  {x.keyPoints.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {x.nextSteps.length > 0 && (
              <div className="rounded-xl bg-raised/70 p-4 ring-1 ring-line">
                <div className="eyebrow mb-2.5">What to do next</div>
                <ol className="space-y-2 text-[13px]">
                  {x.nextSteps.map((p, i) => (
                    <li key={p} className="flex gap-2.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
                        {i + 1}
                      </span>
                      {p}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {x.indicators.length > 0 && (
            <div>
              <div className="eyebrow mb-2.5">The ones to look at first</div>
              <ul className="space-y-2">
                {x.indicators.map((i) => (
                  <li key={i.value}>
                    <details className="group rounded-xl border border-line bg-surface open:bg-raised/40">
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0">
                          <span className="block font-mono text-[12px] break-all text-muted">{i.value}</span>
                          <span className="mt-0.5 block text-[13px] font-semibold">{i.headline}</span>
                        </span>
                        <span className="mt-1 text-muted transition group-open:rotate-90" aria-hidden>
                          ›
                        </span>
                      </summary>
                      <div className="space-y-2 border-t border-line px-4 py-3 text-[13px]">
                        <p>{i.explanation}</p>
                        {i.nextSteps.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-muted">
                            {i.nextSteps.map((s) => (
                              <li key={s}>{s}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AiDisclaimer />
        </div>
      )}
    </section>
  );
}
