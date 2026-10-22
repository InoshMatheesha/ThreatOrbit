import { useState } from 'react';
import { OrbitArt } from '../components/OrbitArt';
import { ErrorBanner, Page } from '../components/ui';
import { BulkInput } from '../features/bulk-input/BulkInput';
import { EnrichDialog } from '../features/bulk-input/EnrichDialog';
import { usePreview, type PreviewInput } from '../features/bulk-input/usePreview';
import { PreviewSummary } from '../features/results/PreviewSummary';
import { PreviewTable } from '../features/results/PreviewTable';
import type { ParseMode } from '../lib/api';

const STEPS = [
  ['1', 'Paste or upload', 'Any mix of IPs, domains, links and file hashes. Messy or defanged is fine.'],
  ['2', 'Check the preview', 'See what was understood. Nothing leaves this page yet.'],
  ['3', 'Enrich', 'Four threat-intelligence sources are asked, and each result is explained.'],
];

export function InvestigatePage() {
  const [input, setInput] = useState<PreviewInput>({ kind: 'text', text: '' });
  const [mode, setMode] = useState<ParseMode>('lines');
  const { result, error, loading } = usePreview(input, mode);
  const [enriching, setEnriching] = useState(false);

  return (
    <Page
      title="Investigate indicators"
      subtitle={
        loading
          ? 'Reading your list…'
          : 'Checked on this page first. Nothing is sent to any threat-intelligence source until you choose Enrich and confirm.'
      }
    >
      <BulkInput input={input} mode={mode} onInputChange={setInput} onModeChange={setMode} />

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {result ? (
        <>
          <PreviewSummary result={result} onEnrich={() => setEnriching(true)} />
          <PreviewTable entries={result.entries} />
          {enriching && <EnrichDialog input={input} mode={mode} preview={result} onClose={() => setEnriching(false)} />}
        </>
      ) : (
        !error && (
          <section className="card overflow-hidden">
            <div className="grid items-center gap-6 p-6 sm:p-8 md:grid-cols-[auto_1fr]">
              <OrbitArt size={200} className="mx-auto hidden md:block" />
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight">How it works</h2>
                <ol className="mt-4 space-y-4">
                  {STEPS.map(([n, title, text]) => (
                    <li key={n} className="flex gap-3.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">
                        {n}
                      </span>
                      <span>
                        <span className="block text-[14px] font-semibold">{title}</span>
                        <span className="block text-[13px] text-muted">{text}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        )
      )}
    </Page>
  );
}
