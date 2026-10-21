import { useState } from 'react';
import { BulkInput } from '../features/bulk-input/BulkInput';
import { usePreview, type PreviewInput } from '../features/bulk-input/usePreview';
import { PreviewSummary } from '../features/results/PreviewSummary';
import { PreviewTable } from '../features/results/PreviewTable';
import type { ParseMode } from '../lib/api';

export function InvestigatePage() {
  const [input, setInput] = useState<PreviewInput>({ kind: 'text', text: '' });
  const [mode, setMode] = useState<ParseMode>('lines');
  const { result, error, loading } = usePreview(input, mode);

  return (
    <main className="mx-auto max-w-[1400px] space-y-3 px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">Bulk IOC preview</h1>
        <span className="text-xs text-slate-500">
          {loading ? 'Parsing…' : 'Validated locally. Nothing is sent to threat intel providers at this step.'}
        </span>
      </div>

      <BulkInput input={input} mode={mode} onInputChange={setInput} onModeChange={setMode} />

      {error && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {result ? (
        <>
          <PreviewSummary result={result} />
          <PreviewTable entries={result.entries} />
        </>
      ) : (
        !error && (
          <div className="rounded-md border border-dashed border-slate-300 px-3 py-10 text-center text-xs text-slate-500 dark:border-slate-700">
            Paste indicators, drop a file, or click <em>Load sample</em> to see the preview.
          </div>
        )
      )}
    </main>
  );
}
