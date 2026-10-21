import { useMemo, useState } from 'react';
import { TYPE_LABELS, type IndicatorType, type ParsedEntry } from '../../lib/api';

const PAGE_SIZE = 50;

type Filter = 'all' | 'valid' | 'invalid' | 'duplicate' | 'local' | 'notes';

const FILTERS: Array<{ value: Filter; label: string; match: (e: ParsedEntry) => boolean }> = [
  { value: 'all', label: 'All', match: () => true },
  { value: 'valid', label: 'Valid', match: (e) => e.status === 'valid' && !e.duplicate },
  { value: 'invalid', label: 'Invalid', match: (e) => e.status === 'invalid' },
  { value: 'duplicate', label: 'Duplicates', match: (e) => e.duplicate },
  { value: 'local', label: 'Kept local', match: (e) => e.status === 'valid' && !e.lookupEligible },
  { value: 'notes', label: 'Has notes', match: (e) => e.notes.length > 0 },
];

function StatusBadge({ entry }: { entry: ParsedEntry }) {
  if (entry.status === 'invalid') {
    return <span className="badge bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">Invalid</span>;
  }
  if (entry.duplicate) {
    return (
      <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title={`First seen on line ${entry.duplicateOfLine}`}>
        Dup of L{entry.duplicateOfLine}
      </span>
    );
  }
  if (!entry.lookupEligible) {
    return <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">Local</span>;
  }
  return <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Valid</span>;
}

export function PreviewTable({ entries }: { entries: ParsedEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [type, setType] = useState<IndicatorType | 'any'>('any');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.value, entries.filter(f.match).length])) as Record<Filter, number>,
    [entries],
  );

  const rows = useMemo(() => {
    const match = FILTERS.find((f) => f.value === filter)!.match;
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        match(e) &&
        (type === 'any' || e.type === type) &&
        (!q ||
          e.original.toLowerCase().includes(q) ||
          e.normalized?.toLowerCase().includes(q) ||
          e.error?.toLowerCase().includes(q) ||
          e.notes.some((n) => n.toLowerCase().includes(q))),
    );
  }, [entries, filter, type, query]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => reset(setFilter)(f.value)}
              className={`rounded px-2 py-1 text-xs ${
                filter === f.value
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {f.label} <span className="tabular-nums opacity-60">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={type}
            onChange={(e) => reset(setType)(e.target.value as IndicatorType | 'any')}
            aria-label="Indicator type"
            className="input"
          >
            <option value="any">All types</option>
            {(Object.keys(TYPE_LABELS) as IndicatorType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => reset(setQuery)(e.target.value)}
            placeholder="Search"
            aria-label="Search entries"
            className="input w-48"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-left text-xs">
          <colgroup>
            <col className="w-14" />
            <col className="w-[26%]" />
            <col className="w-[30%]" />
            <col className="w-20" />
            <col className="w-24" />
            <col />
          </colgroup>
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
            <tr>
              <th className="px-3 py-1.5 font-medium">Line</th>
              <th className="px-3 py-1.5 font-medium">Original</th>
              <th className="px-3 py-1.5 font-medium">Normalized</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  No entries match these filters.
                </td>
              </tr>
            )}
            {visible.map((e, i) => (
              <tr key={`${e.line}-${i}-${e.original}`} className="align-top hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="px-3 py-1.5 font-mono tabular-nums text-slate-400">{e.line}</td>
                <td className="truncate px-3 py-1.5 font-mono" title={e.original}>
                  {e.original}
                  {e.refanged && <span className="ml-1 text-[10px] text-sky-600 dark:text-sky-400">refanged</span>}
                </td>
                <td className="px-3 py-1.5 font-mono break-all">
                  {e.normalized ?? <span className="text-slate-400">-</span>}
                  {e.display && <div className="text-[11px] text-slate-500">shown as {e.display}</div>}
                </td>
                <td className="px-3 py-1.5">{e.type ? TYPE_LABELS[e.type] : <span className="text-slate-400">-</span>}</td>
                <td className="px-3 py-1.5">
                  <StatusBadge entry={e} />
                </td>
                <td className="px-3 py-1.5">
                  {e.error && <div className="text-red-600 dark:text-red-400">{e.error}</div>}
                  {e.notes.map((n) => (
                    <div key={n} className="text-amber-700 dark:text-amber-400">
                      {n}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 px-3 py-1.5 text-xs text-slate-500 dark:border-slate-800">
        <span>
          {rows.length === 0
            ? '0 entries'
            : `${current * PAGE_SIZE + 1}-${Math.min(rows.length, (current + 1) * PAGE_SIZE)} of ${rows.length.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className="btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
            Prev
          </button>
          <span className="px-1 tabular-nums">
            {current + 1} / {pageCount}
          </span>
          <button type="button" className="btn" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
