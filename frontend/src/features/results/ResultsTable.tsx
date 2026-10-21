import { useEffect, useState } from 'react';
import { Empty, ErrorBanner, PROVIDER_SHORT, ResultChip, RiskBadge, Spinner } from '../../components/ui';
import { api, TYPE_LABELS, type Batch, type IndicatorType, type ItemView, type ProviderId, type ResultsQuery, type RiskLevel } from '../../lib/api';

const PAGE_SIZE = 50;
const RISKS: Array<RiskLevel | 'all'> = ['all', 'high', 'medium', 'low', 'unknown'];
const STATUS_LABELS: Record<ItemView['status'], string> = { pending: 'Pending', complete: 'Complete', has_failures: 'Has failures', local: 'Kept local' };

interface Props {
  batch: Batch;
  version: number;
  selected: number | null;
  onSelect: (index: number) => void;
}

export function ResultsTable({ batch, version, selected, onSelect }: Props) {
  const [query, setQuery] = useState<ResultsQuery>({ sort: 'risk', order: 'desc', page: 1, pageSize: PAGE_SIZE });
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ItemView[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Debounce the free-text search.
  useEffect(() => {
    const t = setTimeout(() => setQuery((q) => (q.q === (search || undefined) ? q : { ...q, q: search || undefined, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getResults(batch.id, query, controller.signal)
      .then((r) => {
        setRows(r.data);
        setTotal(r.meta.total);
        setError(null);
      })
      .catch((e: Error) => !controller.signal.aborted && setError(e.message));
    return () => controller.abort();
  }, [batch.id, query, version]);

  const set = (patch: Partial<ResultsQuery>) => setQuery((q) => ({ ...q, ...patch, page: patch.page ?? 1 }));
  const columns = batch.providers.filter((p) => p.state === 'ready');
  const counts = batch.summary?.risk;
  const page = query.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Risk filter">
          {RISKS.map((r) => {
            const active = (query.risk ?? 'all') === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ risk: r === 'all' ? undefined : r })}
                className={`rounded px-2 py-1 text-xs capitalize ${
                  active ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {r} {r !== 'all' && counts ? <span className="tabular-nums opacity-60">{counts[r]}</span> : null}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={Boolean(query.disagreement)} onChange={(e) => set({ disagreement: e.target.checked || undefined })} />
          Disagreements {batch.summary?.disagreements ? `(${batch.summary.disagreements})` : ''}
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <select className="input" aria-label="Type" value={query.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as IndicatorType | undefined })}>
            <option value="">All types</option>
            {(Object.keys(TYPE_LABELS) as IndicatorType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Provider" value={query.provider ?? ''} onChange={(e) => set({ provider: (e.target.value || undefined) as ProviderId | undefined })}>
            <option value="">Any provider</option>
            {columns.map((p) => (
              <option key={p.id} value={p.id}>
                Looked up by {p.name}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Status" value={query.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as ItemView['status'] | undefined })}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select className="input" aria-label="Sort" value={`${query.sort}:${query.order}`} onChange={(e) => {
            const [sort, order] = e.target.value.split(':') as [ResultsQuery['sort'], ResultsQuery['order']];
            set({ sort, order });
          }}>
            <option value="risk:desc">Highest risk first</option>
            <option value="risk:asc">Lowest risk first</option>
            <option value="line:asc">Input order</option>
            <option value="value:asc">Indicator A-Z</option>
            <option value="type:asc">Type</option>
          </select>
          <input type="search" className="input w-44" placeholder="Search value, tag, summary" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {error && <div className="p-3"><ErrorBanner>{error}</ErrorBanner></div>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-3 py-1.5 font-medium">Line</th>
              <th className="px-3 py-1.5 font-medium">Indicator</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Risk</th>
              {columns.map((p) => (
                <th key={p.id} className="px-3 py-1.5 font-medium whitespace-nowrap">
                  {PROVIDER_SHORT[p.id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows === null && (
              <tr>
                <td colSpan={4 + columns.length} className="px-3 py-6 text-center text-slate-500">
                  <Spinner /> Loading results…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={4 + columns.length}>
                  <Empty>No indicators match these filters.</Empty>
                </td>
              </tr>
            )}
            {rows?.map((item) => (
              <tr
                key={item.index}
                onClick={() => onSelect(item.index)}
                className={`cursor-pointer align-top hover:bg-slate-50 dark:hover:bg-slate-800/40 ${selected === item.index ? 'bg-sky-50 dark:bg-sky-950/40' : ''}`}
              >
                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-400">{item.lines[0]}</td>
                <td className="max-w-[420px] px-3 py-1.5 font-mono break-all">
                  {item.value}
                  {item.display && <div className="text-[11px] text-slate-500">shown as {item.display}</div>}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">{TYPE_LABELS[item.type]}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <RiskBadge level={item.risk.level} provisional={item.risk.provisional} />
                  {item.risk.disagreement && (
                    <span className="ml-1 text-amber-600" title={item.risk.disagreement.summary} aria-label="Providers disagree">
                      ⚠
                    </span>
                  )}
                </td>
                {columns.map((p) => (
                  <td key={p.id} className="px-3 py-1.5 whitespace-nowrap">
                    {item.lookupEligible ? <ResultChip result={item.results[p.id]} /> : <span className="text-[11px] text-slate-400">local</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800">
        <span>
          {total.toLocaleString()} indicator{total === 1 ? '' : 's'} · <span className="opacity-70">·c = cached result</span>
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className="btn" disabled={page <= 1} onClick={() => set({ page: page - 1 })}>
            Prev
          </button>
          <span className="px-1 tabular-nums">
            {page} / {pageCount}
          </span>
          <button type="button" className="btn" disabled={page >= pageCount} onClick={() => set({ page: page + 1 })}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
