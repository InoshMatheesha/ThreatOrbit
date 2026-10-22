import { useState } from 'react';
import { DownloadIcon, TrashIcon, XIcon, RefreshIcon } from '../components/icons';
import { BatchStatusBadge, ErrorBanner, Notice, Page, Panel, ProgressBar, RiskGauge, Skeleton, Stat } from '../components/ui';
import { BatchExplainer } from '../features/ai/BatchExplainer';
import { useBatchLive } from '../features/batches/useBatchLive';
import { DetailPanel } from '../features/results/DetailPanel';
import { ResultsTable } from '../features/results/ResultsTable';
import { api, type Batch } from '../lib/api';
import { useUser } from '../lib/auth';
import { dateTime, duration, relativeTime, shortId } from '../lib/format';
import { Link, navigate } from '../lib/router';

function ProviderProgressPanel({ batch }: { batch: Batch }) {
  const c = batch.counters;
  const pending = c.queued + c.running;
  return (
    <Panel title="Progress">
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div>
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-[13px]">
            <span className="font-medium">
              {c.completed + c.failed + c.cancelled} of {c.total} lookups finished
              {c.cached ? <span className="font-normal text-muted"> ({c.cached} from saved results)</span> : ''}
            </span>
            <span className="text-muted">{pending ? `${pending} pending` : batch.terminal ? 'done' : ''}</span>
          </div>
          <ProgressBar done={c.completed} failed={c.failed} total={c.total} />
        </div>
        <ul className="divide-y divide-line">
          {(batch.progress ?? []).map((p) => {
            const snap = batch.providers.find((s) => s.id === p.provider);
            const eta = p.pending && snap ? duration(p.pending / snap.requestsPerMinute) : null;
            const note = [
              p.failed ? `${p.failed} failed` : null,
              p.cached ? `${p.cached} saved` : null,
              p.cancelled ? `${p.cancelled} cancelled` : null,
              eta && !batch.terminal ? `${eta} left at ${snap!.requestsPerMinute}/min` : null,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={p.provider} className="grid gap-x-4 gap-y-1.5 py-3 text-[13px] sm:grid-cols-[150px_1fr_72px] sm:items-center">
                <span className="font-semibold">{snap?.name ?? p.provider}</span>
                <ProgressBar done={p.completed} failed={p.failed} total={p.total} />
                <span className="text-muted tabular-nums sm:text-right">
                  {p.completed + p.failed}/{p.total}
                </span>
                {note && <span className="text-[12px] text-muted sm:col-start-2 sm:col-end-4">{note}</span>}
              </li>
            );
          })}
        </ul>
        {batch.providers.some((p) => p.state !== 'ready') && (
          <p className="text-[12px] text-muted">
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
      <Page>
        <ErrorBanner>{error}</ErrorBanner>
        <Link to="/batches" className="text-[13px] font-medium text-brand underline-offset-2 hover:underline">
          Back to batches
        </Link>
      </Page>
    );
  }
  if (!batch) {
    return (
      <Page>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Page>
    );
  }

  const c = batch.counters;
  const risk = batch.summary?.risk ?? { high: 0, medium: 0, low: 0, unknown: 0 };
  const canManage = user.role === 'admin' || batch.createdBy?.id === user.id;
  const active = canManage && !batch.terminal && batch.status !== 'cancelling';
  const canRetry = canManage && c.failed > 0 && batch.status !== 'cancelled' && batch.status !== 'cancelling';

  return (
    <Page
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {batch.label || `Batch ${shortId(batch.id)}`}
          <BatchStatusBadge status={batch.status} />
        </span>
      }
      subtitle={
        <span title={dateTime(batch.createdAt)}>
          Started by {batch.createdBy?.name ?? 'unknown'} {relativeTime(batch.createdAt)} ·{' '}
          {batch.source.kind === 'file' ? `file ${batch.source.name}` : 'pasted text'} ·{' '}
          {batch.mode === 'extract' ? 'extracted from text' : 'list'}
          {batch.completedAt && ` · finished ${relativeTime(batch.completedAt)}`}
        </span>
      }
      actions={
        <>
          {active && (
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              onClick={() => confirm('Cancel the remaining lookups in this batch?') && act('cancel', () => api.cancelBatch(batch.id))}
            >
              <XIcon size={15} /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel batch'}
            </button>
          )}
          {canRetry && (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => act('retry', () => api.retryFailed(batch.id))}>
              <RefreshIcon size={15} /> {busy === 'retry' ? 'Retrying…' : `Retry ${c.failed} failed`}
            </button>
          )}
          <a className="btn" href={`/api/exports/${batch.id}?format=csv`} download>
            <DownloadIcon size={15} /> CSV
          </a>
          <a className="btn" href={`/api/exports/${batch.id}?format=json`} download>
            <DownloadIcon size={15} /> JSON
          </a>
          {canManage && (
            <button
              type="button"
              className="btn-danger"
              disabled={busy !== null}
              aria-label="Delete batch"
              onClick={async () => {
                if (!confirm('Delete this batch and all of its results? This cannot be undone.')) return;
                await act('delete', () => api.deleteBatch(batch.id));
                navigate('/batches');
              }}
            >
              <TrashIcon size={15} /> Delete
            </button>
          )}
        </>
      }
    >
      {actionError && <ErrorBanner>{actionError}</ErrorBanner>}
      {!batch.terminal && (
        <Notice>
          {batch.status === 'cancelling'
            ? 'Cancelling: waiting for in-flight lookups to finish.'
            : 'Enrichment is in progress. Risk levels marked with … may still change. Keeping this page open gives the fastest progress.'}
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,400px)_1fr]">
        <section className="card p-5">
          <div className="eyebrow mb-4">Risk overview</div>
          <RiskGauge counts={risk} />
        </section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="High risk" value={risk.high} tone={risk.high ? 'high' : undefined} />
          <Stat label="Medium risk" value={risk.medium} tone={risk.medium ? 'medium' : undefined} />
          <Stat
            label="Sources disagree"
            value={batch.summary?.disagreements ?? 0}
            tone={batch.summary?.disagreements ? 'medium' : undefined}
          />
          <Stat label="Lookups done" value={`${c.completed}/${c.total}`} tone="low" sub={c.cached ? `${c.cached} saved` : undefined} />
          <Stat label="Still pending" value={c.queued + c.running} />
          <Stat
            label="Failed lookups"
            value={c.failed}
            tone={c.failed ? 'high' : undefined}
            sub={batch.totals.ineligible ? `${batch.totals.ineligible} kept local` : undefined}
          />
        </div>
      </div>

      <BatchExplainer batchId={batch.id} terminal={batch.terminal} />

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
    </Page>
  );
}
