import { useMemo, useState } from 'react';
import { Pager } from '../../components/ui';
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
  if (entry.status === 'invalid') return <span className="badge bg-high-soft text-high">Invalid</span>;
  if (entry.duplicate) {
    return (
      <span className="badge bg-medium-soft text-medium" title={`First seen on line ${entry.duplicateOfLine}`}>
        Duplicate of line {entry.duplicateOfLine}
      </span>
    );
  }
  if (!entry.lookupEligible) return <span className="badge bg-unknown-soft text-unknown">Kept local</span>;
  return <span className="badge bg-low-soft text-low">Valid</span>;
}

function Details({ entry }: { entry: ParsedEntry }) {
  return (
    <>
      {entry.error && <div className="text-high">{entry.error}</div>}
      {entry.notes.map((n) => (
        <div key={n} className="text-medium">
          {n}
        </div>
      ))}
    </>
  );
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

  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  return (
    <section className="card overflow-hidden">
      <div className="space-y-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => reset(setFilter)(f.value)}
              className={`chip !px-3 !py-1.5 !text-[12px] transition ${
                filter === f.value ? 'bg-ink text-canvas' : 'bg-raised text-muted ring-1 ring-line hover:text-ink'
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
            placeholder="Search entries"
            aria-label="Search entries"
            className="input min-w-0 flex-1 sm:max-w-xs"
          />
        </div>
      </div>

      {visible.length === 0 && <div className="px-4 py-10 text-center text-[13px] text-muted">No entries match these filters.</div>}

      {/* Phones: one card per entry. */}
      <ul className="divide-y divide-line md:hidden">
        {visible.map((e, i) => (
          <li key={`${e.line}-${i}-${e.original}`} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[13px] break-all">{e.normalized ?? e.original}</div>
                {e.normalized && e.normalized !== e.original && (
                  <div className="font-mono text-[11px] break-all text-muted">
                    from {e.original}
                    {e.refanged ? ' (refanged)' : ''}
                  </div>
                )}
              </div>
              <StatusBadge entry={e} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
              <span>Line {e.line}</span>
              {e.type && <span>{TYPE_LABELS[e.type]}</span>}
            </div>
            <div className="mt-1 text-[12px]">
              <Details entry={e} />
            </div>
          </li>
        ))}
      </ul>

      {/* Larger screens: a table. */}
      <div className="hidden overflow-x-auto md:block">
        {visible.length > 0 && (
          <table className="w-full table-fixed text-left text-[13px]">
            <colgroup>
              <col className="w-16" />
              <col className="w-[26%]" />
              <col className="w-[28%]" />
              <col className="w-24" />
              <col className="w-40" />
              <col />
            </colgroup>
            <thead className="bg-raised/60">
              <tr>
                <th className="th">Line</th>
                <th className="th">Original</th>
                <th className="th">Normalized</th>
                <th className="th">Type</th>
                <th className="th">Status</th>
                <th className="th">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((e, i) => (
                <tr key={`${e.line}-${i}-${e.original}`} className="hover:bg-raised/50">
                  <td className="td font-mono text-muted tabular-nums">{e.line}</td>
                  <td className="td truncate font-mono" title={e.original}>
                    {e.original}
                    {e.refanged && <span className="chip ml-1.5 bg-brand-soft text-brand">refanged</span>}
                  </td>
                  <td className="td font-mono break-all">
                    {e.normalized ?? <span className="text-muted">-</span>}
                    {e.display && <div className="text-[11px] text-muted">shown as {e.display}</div>}
                  </td>
                  <td className="td">{e.type ? TYPE_LABELS[e.type] : <span className="text-muted">-</span>}</td>
                  <td className="td">
                    <StatusBadge entry={e} />
                  </td>
                  <td className="td text-[12px]">
                    <Details entry={e} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-raised/60 px-4 py-2.5 text-[12px] text-muted sm:px-5">
        <span>
          {rows.length === 0
            ? '0 entries'
            : `${current * PAGE_SIZE + 1}-${Math.min(rows.length, (current + 1) * PAGE_SIZE)} of ${rows.length.toLocaleString()}`}
        </span>
        <Pager page={current + 1} pageCount={pageCount} onPage={(p) => setPage(p - 1)} />
      </div>
    </section>
  );
}
