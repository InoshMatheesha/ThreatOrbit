import { useCallback, useEffect, useState } from 'react';
import { LayersIcon, TrashIcon } from '../components/icons';
import { BatchStatusBadge, Empty, ErrorBanner, Page, Pager, Panel, ProgressBar, Segmented, Skeleton } from '../components/ui';
import { api, type AuditEntry, type Batch, type Health } from '../lib/api';
import { useUser } from '../lib/auth';
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
  'ai.explain': 'AI explanation written',
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.logout': 'Signed out',
  'auth.password_change': 'Password changed',
  'user.create': 'Team member added',
  'user.update': 'Team member updated',
};

export function BatchesPage() {
  const user = useUser();
  const isAdmin = user.role === 'admin';
  const [mine, setMine] = useState(false);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, events, h] = await Promise.all([
        api.listBatches(page, PAGE_SIZE, mine),
        isAdmin ? api.audit(40) : Promise.resolve([]),
        api.getHealth(),
      ]);
      setBatches(list.data);
      setTotal(list.meta.total);
      setAudit(events);
      setHealth(h);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page, mine, isAdmin]);

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
    <Page
      title="Batches"
      subtitle={
        settings
          ? `Batches are deleted automatically after ${settings.retentionDays} days. Lookup results are reused for ${settings.cacheTtlHours} hours.`
          : 'Every investigation your team has run.'
      }
      actions={
        <>
          <Segmented
            value={mine}
            label="Whose batches"
            options={[
              { value: false, label: 'Team' },
              { value: true, label: 'Mine' },
            ]}
            onChange={(v) => {
              setMine(v);
              setPage(1);
            }}
          />
          {isAdmin && (
            <button type="button" className="btn-danger" onClick={deleteAll} disabled={!total}>
              <TrashIcon size={15} /> Delete all
            </button>
          )}
        </>
      }
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className={`grid items-start gap-5 ${isAdmin ? 'xl:grid-cols-[1fr_340px]' : ''}`}>
        <Panel title={`${total} batch${total === 1 ? '' : 'es'}`}>
          {batches === null ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : batches.length === 0 ? (
            <Empty icon={<LayersIcon size={30} />}>
              {mine ? 'You have not started any batches yet.' : 'No batches yet.'}{' '}
              <Link to="/" className="font-semibold text-brand underline-offset-2 hover:underline">
                Start an investigation
              </Link>
              .
            </Empty>
          ) : (
            <>
              <ul className="divide-y divide-line md:hidden">
                {batches.map((b) => (
                  <li key={b.id}>
                    <Link to={`/batches/${b.id}`} className="block px-4 py-3.5 active:bg-raised">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 font-semibold break-words">{b.label || `Batch ${shortId(b.id)}`}</span>
                        <BatchStatusBadge status={b.status} />
                      </div>
                      <div className="mt-1 text-[12px] text-muted" title={dateTime(b.createdAt)}>
                        {relativeTime(b.createdAt)} by {b.createdBy?.id === user.id ? 'you' : (b.createdBy?.name ?? 'unknown')} ·{' '}
                        {b.totals.indicators} indicators
                      </div>
                      <ProgressBar className="mt-2.5" done={b.counters.completed} failed={b.counters.failed} total={b.counters.total} />
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-raised/60">
                    <tr>
                      <th className="th">Batch</th>
                      <th className="th">Started</th>
                      <th className="th">Status</th>
                      <th className="th">Indicators</th>
                      <th className="th w-56">Lookups</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {batches.map((b) => (
                      <tr key={b.id} className="cursor-pointer transition hover:bg-raised/60" onClick={() => navigate(`/batches/${b.id}`)}>
                        <td className="td">
                          <Link to={`/batches/${b.id}`} className="font-semibold hover:text-brand">
                            {b.label || `Batch ${shortId(b.id)}`}
                          </Link>
                          <div className="text-[12px] text-muted">
                            {b.source.kind === 'file' ? b.source.name : 'pasted text'} ·{' '}
                            {b.providers
                              .filter((p) => p.state === 'ready')
                              .map((p) => p.name)
                              .join(', ')}
                          </div>
                        </td>
                        <td className="td whitespace-nowrap" title={dateTime(b.createdAt)}>
                          {relativeTime(b.createdAt)}
                          <div className="text-[12px] text-muted">
                            by {b.createdBy?.id === user.id ? 'you' : (b.createdBy?.name ?? 'unknown')}
                          </div>
                        </td>
                        <td className="td">
                          <BatchStatusBadge status={b.status} />
                        </td>
                        <td className="td tabular-nums">{b.totals.indicators}</td>
                        <td className="td">
                          <ProgressBar done={b.counters.completed} failed={b.counters.failed} total={b.counters.total} />
                          <div className="mt-1 text-[12px] text-muted tabular-nums">
                            {b.counters.completed}/{b.counters.total} done{b.counters.failed ? ` · ${b.counters.failed} failed` : ''}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {pageCount > 1 && (
            <div className="flex justify-end border-t border-line bg-raised/60 px-4 py-2.5 sm:px-5">
              <Pager page={page} pageCount={pageCount} onPage={setPage} />
            </div>
          )}
        </Panel>

        {isAdmin && (
          <Panel title="Audit log">
            {audit.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto text-[13px]">
                {audit.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="px-4 py-3">
                    <div className="flex justify-between gap-3">
                      <span className="font-semibold">{ACTION_LABELS[e.action] ?? e.action}</span>
                      <span className="shrink-0 text-[12px] text-muted" title={dateTime(e.at)}>
                        {relativeTime(e.at)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">
                      <span className="text-ink">{e.actor?.name ?? 'System'}</span>
                      {e.batchId && <span className="font-mono"> · {shortId(e.batchId)}</span>}
                      {e.details && ' · '}
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
        )}
      </div>
    </Page>
  );
}
