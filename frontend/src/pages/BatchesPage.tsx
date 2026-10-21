import { useCallback, useEffect, useState } from 'react';
import { BatchStatusBadge, DemoBadge, Empty, ErrorBanner, Panel, ProgressBar, Spinner } from '../components/ui';
import { api, type AuditEntry, type Batch, type Health } from '../lib/api';
import { dateTime, relativeTime, shortId } from '../lib/format';
import { Link, navigate } from '../lib/router';

const PAGE_SIZE = 25;
const ACTION_LABELS: Record<string, string> = {
  'batch.create': 'Batch created',
  'batch.cancel': 'Batch cancelled',
  'batch.delete': 'Batch deleted',
  'batch.retry_failed': 'Failed lookups retried',
  'result.retry': 'Lookup retried',
  'export.download': 'Results exported',
  'history.delete_all': 'All history deleted',
  'retention.purge': 'Retention purge',
  'provider.test': 'Provider key tested',
};

export function BatchesPage() {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, events, h] = await Promise.all([api.listBatches(page, PAGE_SIZE), api.audit(40), api.getHealth()]);
      setBatches(list.data);
      setTotal(list.meta.total);
      setAudit(events);
      setHealth(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function deleteAll() {
    const typed = prompt('This permanently deletes every batch, result and stored indicator. Type DELETE ALL to confirm.');
    if (typed !== 'DELETE ALL') return;
    try {
      await api.deleteAll();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const settings = health?.enrichment?.settings;

  return (
    <main className="mx-auto grid max-w-[1400px] gap-3 px-4 py-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-semibold">Batch history</h1>
          {settings && (
            <span className="text-xs text-slate-500">
              Batches are deleted automatically after {settings.retentionDays} days · results cached for {settings.cacheTtlHours} h
            </span>
          )}
        </div>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Panel
          title={`${total} batch${total === 1 ? '' : 'es'}`}
          actions={
            <button type="button" className="btn-danger" onClick={deleteAll} disabled={!total}>
              Delete all history
            </button>
          }
        >
          {batches === null ? (
            <Empty>
              <Spinner /> Loading…
            </Empty>
          ) : batches.length === 0 ? (
            <Empty>
              No batches yet. <Link to="/" className="underline">Start an investigation</Link>.
            </Empty>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Batch</th>
                  <th className="px-3 py-1.5 font-medium">Created</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Indicators</th>
                  <th className="w-56 px-3 py-1.5 font-medium">Lookups</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {batches.map((b) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => navigate(`/batches/${b.id}`)}>
                    <td className="px-3 py-1.5">
                      <Link to={`/batches/${b.id}`} className="font-medium hover:underline">
                        {b.label || `Batch ${shortId(b.id)}`}
                      </Link>{' '}
                      {b.demo && <DemoBadge />}
                      <div className="text-[11px] text-slate-500">
                        {b.source.kind === 'file' ? b.source.name : 'pasted text'} · {b.providers.filter((p) => p.state === 'ready').map((p) => p.name).join(', ')}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap" title={dateTime(b.createdAt)}>
                      {relativeTime(b.createdAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <BatchStatusBadge status={b.status} />
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{b.totals.indicators}</td>
                    <td className="px-3 py-1.5">
                      <ProgressBar done={b.counters.completed} failed={b.counters.failed} total={b.counters.total} />
                      <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                        {b.counters.completed}/{b.counters.total} done{b.counters.failed ? ` · ${b.counters.failed} failed` : ''}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pageCount > 1 && (
            <div className="flex justify-end gap-1 border-t border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800">
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </button>
              <span className="px-1 py-1 tabular-nums">
                {page} / {pageCount}
              </span>
              <button type="button" className="btn" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Audit log" className="self-start">
        {audit.length === 0 ? (
          <Empty>No activity yet.</Empty>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto text-xs dark:divide-slate-800">
            {audit.map((e, i) => (
              <li key={`${e.at}-${i}`} className="px-3 py-1.5">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{ACTION_LABELS[e.action] ?? e.action}</span>
                  <span className="text-slate-500" title={dateTime(e.at)}>
                    {relativeTime(e.at)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {e.batchId && <span className="font-mono">{shortId(e.batchId)} </span>}
                  {e.details &&
                    Object.entries(e.details)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
