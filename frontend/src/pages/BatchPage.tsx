import { useState } from 'react';
import { BatchStatusBadge, ErrorBanner, Notice, Panel, ProgressBar, Spinner } from '../components/ui';
import { useBatchLive } from '../features/batches/useBatchLive';
import { DetailPanel } from '../features/results/DetailPanel';
import { ResultsTable } from '../features/results/ResultsTable';
import { api, type Batch } from '../lib/api';
import { useUser } from '../lib/auth';
import { dateTime, duration, relativeTime, shortId } from '../lib/format';
import { Link, navigate } from '../lib/router';

function Metric({ label, value, tone, sub }: { label: string; value: number | string; tone?: string; sub?: string }) {
  return (
    <div className="min-w-[120px] flex-1 px-3 py-2">
      <div className={`font-mono text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function ProviderProgressPanel({ batch }: { batch: Batch }) {
  const c = batch.counters;
  const pending = c.queued + c.running;
  return (
    <Panel title="Progress">
      <div className="space-y-2 px-3 py-2 text-xs">
        <div>
          <div className="mb-1 flex justify-between text-slate-600 dark:text-slate-300">
            <span>
              {c.completed + c.failed + c.cancelled} of {c.total} lookups finished
              {c.cached ? ` (${c.cached} from cache)` : ''}
            </span>
            <span>{pending ? `${pending} pending` : batch.terminal ? 'done' : ''}</span>
          </div>
          <ProgressBar done={c.completed} failed={c.failed} total={c.total} />
        </div>
        <table className="w-full">
          <tbody>
            {(batch.progress ?? []).map((p) => {
              const snap = batch.providers.find((s) => s.id === p.provider);
              const eta = p.pending && snap ? duration(p.pending / snap.requestsPerMinute) : null;
              return (
                <tr key={p.provider}>
                  <td className="w-40 py-1 pr-3 font-medium">{snap?.name ?? p.provider}</td>
                  <td className="py-1 pr-3">
                    <ProgressBar done={p.completed} failed={p.failed} total={p.total} />
                  </td>
                  <td className="w-24 py-1 pr-3 text-right tabular-nums">
                    {p.completed + p.failed}/{p.total}
                  </td>
                  <td className="w-72 py-1 text-slate-500">
                    {[
                      p.failed ? `${p.failed} failed` : null,
                      p.cached ? `${p.cached} cached` : null,
                      p.cancelled ? `${p.cancelled} cancelled` : null,
                      eta && !batch.terminal ? `${eta} left at ${snap!.requestsPerMinute}/min` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {batch.providers.some((p) => p.state !== 'ready') && (
          <p className="text-slate-500">
            Not used:{' '}
            {batch.providers
              .filter((p) => p.state !== 'ready')
              .map((p) => `${p.name} (${p.state})`)
              .join(', ')}
          </p>
        )}
      </div>
    </Panel>
  );
}

export function BatchPage({ id }: { id: string }) {
  const user = useUser();
  const { batch, error, version, reload } = useBatchLive(id);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (error && !batch) {
    return (
      <main className="mx-auto max-w-[1400px] space-y-3 px-4 py-4">
        <ErrorBanner>{error}</ErrorBanner>
        <Link to="/batches" className="text-xs underline">
          Back to batches
        </Link>
      </main>
    );
  }
  if (!batch) {
    return (
      <main className="mx-auto flex max-w-[1400px] items-center gap-2 px-4 py-6 text-xs text-slate-500">
        <Spinner /> Loading batch…
      </main>
    );
  }

  const c = batch.counters;
  const risk = batch.summary?.risk ?? { high: 0, medium: 0, low: 0, unknown: 0 };
  const canManage = user.role === 'admin' || batch.createdBy?.id === user.id;
  const active = canManage && !batch.terminal && batch.status !== 'cancelling';
  const canRetry = canManage && c.failed > 0 && batch.status !== 'cancelled' && batch.status !== 'cancelling';

  return (
    <main className="mx-auto max-w-[1400px] space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold">{batch.label || `Batch ${shortId(batch.id)}`}</h1>
            <BatchStatusBadge status={batch.status} />
          </div>
          <div className="mt-0.5 text-xs text-slate-500" title={dateTime(batch.createdAt)}>
            Started by {batch.createdBy?.name ?? 'unknown'} {relativeTime(batch.createdAt)} ·{' '}
            {batch.source.kind === 'file' ? `file ${batch.source.name}` : 'pasted text'} ·{' '}
            {batch.mode === 'extract' ? 'extracted from text' : 'one per line'} · <span className="font-mono">{batch.id}</span>
            {batch.completedAt && ` · finished ${relativeTime(batch.completedAt)}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {active && (
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              onClick={() => confirm('Cancel the remaining lookups in this batch?') && act('cancel', () => api.cancelBatch(batch.id))}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel batch'}
            </button>
          )}
          {canRetry && (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => act('retry', () => api.retryFailed(batch.id))}>
              {busy === 'retry' ? 'Retrying…' : `Retry ${c.failed} failed`}
            </button>
          )}
          <a className="btn" href={`/api/exports/${batch.id}?format=csv`} download>
            Export CSV
          </a>
          <a className="btn" href={`/api/exports/${batch.id}?format=json`} download>
            Export JSON
          </a>
          {canManage && (
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              onClick={async () => {
                if (!confirm('Delete this batch and all of its results? This cannot be undone.')) return;
                await act('delete', () => api.deleteBatch(batch.id));
                navigate('/batches');
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      {!batch.terminal && (
        <Notice>
          {batch.status === 'cancelling'
            ? 'Cancelling: waiting for in-flight lookups to finish.'
            : 'Enrichment in progress. Risk levels marked … are provisional until every lookup for that indicator finishes. You can leave this page; the batch keeps running.'}
        </Notice>
      )}

      <div className="flex flex-wrap divide-x divide-slate-200 rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        <Metric
          label="Indicators"
          value={batch.totals.indicators}
          sub={batch.totals.ineligible ? `${batch.totals.ineligible} kept local` : undefined}
        />
        <Metric label="High risk" value={risk.high} tone={risk.high ? 'text-red-600 dark:text-red-400' : ''} />
        <Metric label="Medium risk" value={risk.medium} tone={risk.medium ? 'text-amber-600 dark:text-amber-400' : ''} />
        <Metric
          label="Completed lookups"
          value={`${c.completed}/${c.total}`}
          tone="text-emerald-600 dark:text-emerald-400"
          sub={c.cached ? `${c.cached} cached` : undefined}
        />
        <Metric label="Pending lookups" value={c.queued + c.running} />
        <Metric label="Failed lookups" value={c.failed} tone={c.failed ? 'text-red-600 dark:text-red-400' : ''} />
        <Metric
          label="Disagreements"
          value={batch.summary?.disagreements ?? 0}
          tone={batch.summary?.disagreements ? 'text-amber-600 dark:text-amber-400' : ''}
        />
      </div>

      <ProviderProgressPanel batch={batch} />
      <ResultsTable batch={batch} version={version} selected={selected} onSelect={setSelected} />

      {selected !== null && (
        <DetailPanel
          batchId={batch.id}
          index={selected}
          version={version}
          canRetry={canManage}
          onClose={() => setSelected(null)}
          onChanged={reload}
        />
      )}
    </main>
  );
}
