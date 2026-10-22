import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertIcon,
  DownloadIcon,
  KeyIcon,
  LayersIcon,
  LoginIcon,
  PulseIcon,
  SearchIcon,
  ServerIcon,
  SparklesIcon,
  TrashIcon,
  UsersIcon,
} from '../components/icons';
import { Empty, ErrorBanner, Page, Skeleton, Stat } from '../components/ui';
import { api, type AuditEntry } from '../lib/api';
import { relativeTime, shortId } from '../lib/format';
import { Link } from '../lib/router';

type Category = 'batches' | 'ai' | 'signins' | 'sources' | 'team' | 'data';
type Tone = 'brand' | 'low' | 'medium' | 'high' | 'muted';

const CATEGORIES: Array<{ id: Category; label: string; Icon: typeof PulseIcon }> = [
  { id: 'batches', label: 'Batches', Icon: LayersIcon },
  { id: 'ai', label: 'AI', Icon: SparklesIcon },
  { id: 'signins', label: 'Sign-ins', Icon: LoginIcon },
  { id: 'sources', label: 'Sources', Icon: ServerIcon },
  { id: 'team', label: 'Team', Icon: UsersIcon },
  { id: 'data', label: 'Data', Icon: TrashIcon },
];

const TONES: Record<Tone, string> = {
  brand: 'bg-brand-soft text-brand',
  low: 'bg-low-soft text-low',
  medium: 'bg-medium-soft text-medium',
  high: 'bg-high-soft text-high',
  muted: 'bg-unknown-soft text-unknown',
};

const PROVIDERS: Record<string, string> = { virustotal: 'VirusTotal', abuseipdb: 'AbuseIPDB', otx: 'AlienVault OTX', urlhaus: 'URLhaus' };
const providerName = (id: unknown) => PROVIDERS[String(id)] ?? String(id);

function categoryOf(action: string): Category {
  if (action.startsWith('batch.') || action === 'result.retry' || action === 'export.download') return 'batches';
  if (action.startsWith('ai.')) return 'ai';
  if (action.startsWith('auth.')) return 'signins';
  if (action === 'provider.test' || action.startsWith('settings.')) return 'sources';
  if (action.startsWith('user.')) return 'team';
  return 'data';
}

interface Described {
  title: string;
  detail?: string;
  tone: Tone;
  Icon: typeof PulseIcon;
  /** The batch this event is about, when it can be opened. */
  batch?: string;
}

const n = (v: unknown) => (typeof v === 'number' ? v.toLocaleString() : '');

/** Plain sentences instead of raw key/value pairs. */
function describe(e: AuditEntry): Described {
  const d = e.details ?? {};
  const base = { batch: e.batchId };
  switch (e.action) {
    case 'batch.create':
      return {
        ...base,
        title: 'Started a batch',
        detail: [
          d.indicators !== undefined && `${n(d.indicators)} indicators`,
          d.lookups !== undefined && `${n(d.lookups)} lookups`,
          Number(d.cached) > 0 && `${n(d.cached)} from saved results`,
        ]
          .filter(Boolean)
          .join(' · '),
        tone: 'brand',
        Icon: LayersIcon,
      };
    case 'batch.cancel':
      return {
        ...base,
        title: 'Cancelled a batch',
        detail: d.cancelledLookups !== undefined ? `${n(d.cancelledLookups)} lookups stopped` : '',
        tone: 'medium',
        Icon: LayersIcon,
      };
    case 'batch.delete':
      return {
        title: 'Deleted a batch',
        detail: d.lookupsDeleted !== undefined ? `${n(d.lookupsDeleted)} lookups removed` : '',
        tone: 'medium',
        Icon: TrashIcon,
      };
    case 'batch.retry_failed':
      return {
        ...base,
        title: 'Retried failed lookups',
        detail: d.lookups !== undefined ? `${n(d.lookups)} lookups queued again` : '',
        tone: 'brand',
        Icon: LayersIcon,
      };
    case 'result.retry':
      return { ...base, title: 'Retried one lookup', detail: d.provider ? providerName(d.provider) : '', tone: 'brand', Icon: LayersIcon };
    case 'export.download':
      return {
        ...base,
        title: 'Exported results',
        detail: d.format ? String(d.format).toUpperCase() : '',
        tone: 'brand',
        Icon: DownloadIcon,
      };
    case 'ai.explain':
      return {
        ...base,
        title: 'Asked for an AI explanation',
        detail: [d.scope === 'batch' ? 'Whole batch' : 'One indicator', d.model].filter(Boolean).join(' · '),
        tone: 'brand',
        Icon: SparklesIcon,
      };
    case 'settings.ai_update':
      return {
        title: 'Updated the AI settings',
        detail: [d.provider === 'gemini' ? 'Google Gemini' : d.provider === 'anthropic' ? 'Anthropic Claude' : d.provider, d.model]
          .filter(Boolean)
          .join(' · '),
        tone: 'brand',
        Icon: SparklesIcon,
      };
    case 'settings.ai_remove':
      return { title: 'Removed the AI key', tone: 'medium', Icon: SparklesIcon };
    case 'provider.test':
      return d.ok
        ? { title: `Tested the ${providerName(d.provider)} key`, detail: 'Working', tone: 'low', Icon: ServerIcon }
        : {
            title: `Tested the ${providerName(d.provider)} key`,
            detail: `Failed${d.kind ? `: ${String(d.kind).replaceAll('_', ' ')}` : ''}`,
            tone: 'high',
            Icon: ServerIcon,
          };
    case 'auth.login':
      return { title: 'Signed in', tone: 'low', Icon: LoginIcon };
    case 'auth.logout':
      return { title: 'Signed out', tone: 'muted', Icon: LoginIcon };
    case 'auth.login_failed':
      return {
        title: 'Failed sign-in',
        detail:
          d.reason === 'unknown_user'
            ? 'No such account'
            : d.reason === 'inactive'
              ? 'Account is deactivated'
              : d.locked
                ? 'Account locked for a while'
                : 'Wrong password',
        tone: 'high',
        Icon: AlertIcon,
      };
    case 'auth.password_change':
      return { title: 'Changed their password', tone: 'medium', Icon: KeyIcon };
    case 'user.create':
      return { title: 'Added a team member', detail: d.role ? `As ${d.role}` : '', tone: 'brand', Icon: UsersIcon };
    case 'user.update':
      return {
        title: 'Updated a team member',
        detail: [
          d.role && `Role set to ${d.role}`,
          d.active === false && 'Deactivated',
          d.active === true && 'Reactivated',
          d.passwordReset && 'Password reset',
        ]
          .filter(Boolean)
          .join(' · '),
        tone: 'medium',
        Icon: UsersIcon,
      };
    case 'history.delete_all':
      return {
        title: 'Deleted all history',
        detail: [d.batches !== undefined && `${n(d.batches)} batches`, d.lookups !== undefined && `${n(d.lookups)} lookups`]
          .filter(Boolean)
          .join(' · '),
        tone: 'high',
        Icon: TrashIcon,
      };
    case 'retention.purge':
      return {
        title: 'Automatic cleanup',
        detail: [
          d.batches !== undefined && `${n(d.batches)} old batches removed`,
          d.retentionDays !== undefined && `older than ${d.retentionDays} days`,
        ]
          .filter(Boolean)
          .join(' · '),
        tone: 'muted',
        Icon: TrashIcon,
      };
    default:
      return {
        title: e.action.replaceAll('.', ' ').replaceAll('_', ' '),
        detail: Object.entries(d)
          .map(([k, v]) => `${k}: ${v}`)
          .join(' · '),
        tone: 'muted',
        Icon: PulseIcon,
      };
  }
}

function dayLabel(date: Date): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(date)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function ActivityPage() {
  const [events, setEvents] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .audit(500)
        .then((r) => {
          if (!cancelled) {
            setEvents(r);
            setError(null);
          }
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of events ?? []) c[categoryOf(e.action)] = (c[categoryOf(e.action)] ?? 0) + 1;
    return c;
  }, [events]);

  const today = useMemo(() => {
    const since = Date.now() - 86_400_000;
    const recent = (events ?? []).filter((e) => new Date(e.at).getTime() >= since);
    return {
      events: recent.length,
      people: new Set(recent.flatMap((e) => (e.actor ? [e.actor.id] : []))).size,
      batches: recent.filter((e) => e.action === 'batch.create').length,
      problems: recent.filter((e) => e.action === 'auth.login_failed' || (e.action === 'provider.test' && !e.details?.ok)).length,
    };
  }, [events]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = (events ?? []).filter((e) => {
      if (category !== 'all' && categoryOf(e.action) !== category) return false;
      if (!q) return true;
      const d = describe(e);
      return `${d.title} ${d.detail ?? ''} ${e.actor?.name ?? 'system'} ${e.actor?.email ?? ''}`.toLowerCase().includes(q);
    });
    // Newest first. Runs of the same sign-in event by one person fold into a single row ("signed in x6").
    const out: Array<{ label: string; items: Array<{ entry: AuditEntry; count: number; oldest: string }> }> = [];
    const foldable = new Set(['auth.login', 'auth.logout']);
    for (const e of shown) {
      const label = dayLabel(new Date(e.at));
      let group = out[out.length - 1];
      if (group?.label !== label) {
        group = { label, items: [] };
        out.push(group);
      }
      const last = group.items[group.items.length - 1];
      if (last && foldable.has(e.action) && last.entry.action === e.action && last.entry.actor?.id === e.actor?.id) {
        last.count++;
        last.oldest = e.at;
      } else {
        group.items.push({ entry: e, count: 1, oldest: e.at });
      }
    }
    return { out, total: shown.length };
  }, [events, category, query]);

  return (
    <Page title="Activity" subtitle="A record of who did what, and when. Indicator values and API keys are never written to it.">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Events in 24 hours" value={events ? today.events : '-'} />
        <Stat label="People active" value={events ? today.people : '-'} tone="brand" />
        <Stat label="Batches started" value={events ? today.batches : '-'} />
        <Stat
          label="Things to look at"
          value={events ? today.problems : '-'}
          tone={today.problems ? 'high' : undefined}
          sub="failed sign-ins or key tests"
        />
      </div>

      <section className="card overflow-hidden">
        <div className="space-y-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            <FilterChip active={category === 'all'} onClick={() => setCategory('all')}>
              All <span className="tabular-nums opacity-70">{events?.length ?? 0}</span>
            </FilterChip>
            {CATEGORIES.map(({ id, label, Icon }) => (
              <FilterChip key={id} active={category === id} onClick={() => setCategory(id)}>
                <Icon size={13} /> {label} <span className="tabular-nums opacity-70">{counts[id] ?? 0}</span>
              </FilterChip>
            ))}
          </div>
          <div className="relative sm:max-w-sm">
            <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              type="search"
              className="input w-full pl-9"
              placeholder="Search by person or action"
              aria-label="Search activity"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {events === null ? (
          <div className="space-y-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : groups.total === 0 ? (
          <Empty icon={<PulseIcon size={30} />}>{events.length === 0 ? 'No activity yet.' : 'Nothing matches these filters.'}</Empty>
        ) : (
          <div className="px-4 pb-6 sm:px-5">
            {groups.out.map((g) => (
              <div key={g.label}>
                <div className="sticky top-14 z-10 -mx-4 bg-surface/95 px-4 pt-5 pb-2 backdrop-blur sm:-mx-5 sm:px-5 lg:top-0">
                  <span className="eyebrow">{g.label}</span>
                </div>
                <ol className="relative ml-[17px] border-l border-line">
                  {g.items.map((it, i) => (
                    <Row key={`${it.entry.at}-${i}`} entry={it.entry} count={it.count} oldest={it.oldest} />
                  ))}
                </ol>
              </div>
            ))}
            {events.length >= 500 && <p className="mt-6 text-center text-[12px] text-muted">Showing the latest 500 events.</p>}
          </div>
        )}
      </section>
    </Page>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip shrink-0 !px-3 !py-1.5 !text-[12px] transition ${active ? 'bg-ink text-canvas' : 'bg-raised text-muted ring-1 ring-line hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function Row({ entry: e, count, oldest }: { entry: AuditEntry; count: number; oldest: string }) {
  const d = describe(e);
  return (
    <li className="relative py-3 pl-8">
      <span
        className={`absolute top-3.5 -left-[17px] flex h-[34px] w-[34px] items-center justify-center rounded-full ring-4 ring-surface ${TONES[d.tone]}`}
      >
        <d.Icon size={16} />
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <div className="min-w-0 text-[13px]">
          <span className="font-semibold">{e.actor?.name ?? 'System'}</span>{' '}
          <span className="text-ink/85">{d.title.charAt(0).toLowerCase() + d.title.slice(1)}</span>
          {count > 1 && <span className="chip ml-2 bg-raised text-muted ring-1 ring-line">x{count}</span>}
        </div>
        <time className="text-[12px] text-muted tabular-nums" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
          {clock(e.at)} · {relativeTime(e.at)}
        </time>
      </div>
      {(d.detail || d.batch || count > 1) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          {count > 1 && <span>First one at {clock(oldest)}</span>}
          {d.detail && <span>{d.detail}</span>}
          {d.batch && d.title !== 'Deleted a batch' && (
            <Link
              to={`/batches/${d.batch}`}
              className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline"
            >
              Open batch <span className="font-mono text-[11px]">{shortId(d.batch)}</span>
            </Link>
          )}
        </div>
      )}
    </li>
  );
}
