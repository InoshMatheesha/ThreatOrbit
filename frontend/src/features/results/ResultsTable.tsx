import { useEffect, useState } from 'react';
import { AlertIcon, SearchIcon } from '../../components/icons';
import { Empty, ErrorBanner, Pager, PROVIDER_SHORT, ResultChip, RiskBadge, Spinner } from '../../components/ui';
import {
  api,
  TYPE_LABELS,
  type Batch,
  type IndicatorType,
  type ItemView,
  type ProviderId,
  type ResultsQuery,
  type RiskLevel,
} from '../../lib/api';

const PAGE_SIZE = 50;
const RISKS: Array<RiskLevel | 'all'> = ['all', 'high', 'medium', 'low', 'unknown'];
const STATUS_LABELS: Record<ItemView['status'], string> = {
  pending: 'Pending',
  complete: 'Complete',
  has_failures: 'Has failures',
  local: 'Kept local',
};
const RISK_DOT: Record<RiskLevel, string> = { high: 'bg-high', medium: 'bg-medium', low: 'bg-low', unknown: 'bg-unknown' };

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
    <section className="card overflow-hidden">
      <div className="space-y-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5" role="radiogroup" aria-label="Risk filter">
          {RISKS.map((r) => {
            const active = (query.risk ?? 'all') === r;
            return (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ risk: r === 'all' ? undefined : r })}
                className={`chip !px-3 !py-1.5 !text-[12px] capitalize transition ${
                  active ? 'bg-ink text-canvas' : 'bg-raised text-muted ring-1 ring-line hover:text-ink'
                }`}
              >
                {r !== 'all' && <span className={`h-1.5 w-1.5 rounded-full ${RISK_DOT[r]}`} aria-hidden />}
                {r} {r !== 'all' && counts ? <span className="tabular-nums opacity-70">{counts[r]}</span> : null}
              </button>
            );
          })}
          <label className="ml-2 flex shrink-0 cursor-pointer items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--c-brand)]"
              checked={Boolean(query.disagreement)}
              onChange={(e) => set({ disagreement: e.target.checked || undefined })}
            />
            Sources disagree {batch.summary?.disagreements ? `(${batch.summary.disagreements})` : ''}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              type="search"
              className="input w-full pl-9"
              placeholder="Search value, tag or summary"
              aria-label="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input"
            aria-label="Type"
            value={query.type ?? ''}
            onChange={(e) => set({ type: (e.target.value || undefined) as IndicatorType | undefined })}
          >
            <option value="">All types</option>
            {(Object.keys(TYPE_LABELS) as IndicatorType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Provider"
            value={query.provider ?? ''}
            onChange={(e) => set({ provider: (e.target.value || undefined) as ProviderId | undefined })}
          >
            <option value="">Any source</option>
            {columns.map((p) => (
              <option key={p.id} value={p.id}>
                Looked up by {p.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Status"
            value={query.status ?? ''}
            onChange={(e) => set({ status: (e.target.value || undefined) as ItemView['status'] | undefined })}
          >
            <option value="">Any status</option>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            className="input"
            aria-label="Sort"
            value={`${query.sort}:${query.order}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split(':') as [ResultsQuery['sort'], ResultsQuery['order']];
              set({ sort, order });
            }}
          >
            <option value="risk:desc">Highest risk first</option>
            <option value="risk:asc">Lowest risk first</option>
            <option value="line:asc">Input order</option>
            <option value="value:asc">Indicator A-Z</option>
            <option value="type:asc">Type</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="p-4">
          <ErrorBanner>{error}</ErrorBanner>
        </div>
      )}
      {rows === null && (
        <div className="flex items-center justify-center gap-2 px-4 py-12 text-[13px] text-muted">
          <Spinner /> Loading results…
        </div>
      )}
      {rows?.length === 0 && <Empty icon={<SearchIcon size={28} />}>No indicators match these filters.</Empty>}

      {/* Phones: one tappable card per indicator. */}
      <ul className="divide-y divide-line md:hidden">
        {rows?.map((item) => (
          <li key={item.index}>
            <button
              type="button"
              onClick={() => onSelect(item.index)}
              className={`block w-full px-4 py-3.5 text-left transition active:bg-raised ${selected === item.index ? 'bg-brand-soft/60' : ''}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[13px] break-all">{item.value}</div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {TYPE_LABELS[item.type]} · line {item.lines[0]}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {item.risk.disagreement && <AlertIcon size={15} className="text-medium" aria-label="Sources disagree" />}
                  <RiskBadge level={item.risk.level} provisional={item.risk.provisional} />
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {item.lookupEligible ? (
                  columns.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
                      {PROVIDER_SHORT[p.id]}
                      <ResultChip result={item.results[p.id]} />
                    </span>
                  ))
                ) : (
                  <span className="chip bg-unknown-soft text-unknown">Kept local, not sent</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Larger screens: a table. */}
      {rows && rows.length > 0 && (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-raised/60">
              <tr>
                <th className="th w-14">Line</th>
                <th className="th">Indicator</th>
                <th className="th">Type</th>
                <th className="th">Risk</th>
                {columns.map((p) => (
                  <th key={p.id} className="th whitespace-nowrap">
                    {PROVIDER_SHORT[p.id]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((item) => (
                <tr
                  key={item.index}
                  onClick={() => onSelect(item.index)}
                  className={`cursor-pointer transition hover:bg-raised/60 ${selected === item.index ? 'bg-brand-soft/60' : ''}`}
                >
                  <td className="td font-mono text-muted tabular-nums">{item.lines[0]}</td>
                  <td className="td max-w-[380px] font-mono break-all">
                    {item.value}
                    {item.display && <div className="text-[11px] text-muted">shown as {item.display}</div>}
                  </td>
                  <td className="td whitespace-nowrap">{TYPE_LABELS[item.type]}</td>
                  <td className="td whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <RiskBadge level={item.risk.level} provisional={item.risk.provisional} />
                      {item.risk.disagreement && (
                        <span title={item.risk.disagreement.summary} className="text-medium">
                          <AlertIcon size={15} aria-label="Sources disagree" />
                        </span>
                      )}
                    </span>
                  </td>
                  {columns.map((p) => (
                    <td key={p.id} className="td whitespace-nowrap">
                      {item.lookupEligible ? (
                        <ResultChip result={item.results[p.id]} />
                      ) : (
                        <span className="text-[11px] text-muted/70">local</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised/60 px-4 py-2.5 text-[12px] text-muted sm:px-5">
        <span>
          {total.toLocaleString()} indicator{total === 1 ? '' : 's'} ·{' '}
          <span className="opacity-80">·c means a saved result was reused</span>
        </span>
        <Pager page={page} pageCount={pageCount} onPage={(p) => set({ page: p })} />
      </div>
    </section>
  );
}
