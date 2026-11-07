import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IndicatorType, ItemView, ProviderId } from '../../lib/api';

// ── Indicator kinds and the services that can show each one ──────────────────

type Kind = 'ip' | 'domain' | 'url' | 'hash';

const KIND_OF: Record<IndicatorType, Kind> = {
  ipv4: 'ip',
  ipv6: 'ip',
  domain: 'domain',
  url: 'url',
  md5: 'hash',
  sha1: 'hash',
  sha256: 'hash',
};

const KIND_LABELS: Record<Kind, [singular: string, plural: string]> = {
  ip: ['IP', 'IPs'],
  domain: ['domain', 'domains'],
  url: ['URL', 'URLs'],
  hash: ['hash', 'hashes'],
};

const enc = encodeURIComponent;

interface ExternalService {
  id: ProviderId;
  label: string;
  icon: string;
  color: string;
  /** Page for an indicator of each kind. Kinds without a builder are opened only via a lookup's permalink. */
  pages: Partial<Record<Kind, (value: string) => string>>;
}

export const EXTERNAL_SERVICES: readonly ExternalService[] = [
  {
    id: 'virustotal',
    label: 'VirusTotal',
    icon: '🔵',
    color: 'bg-[#0052cc] hover:bg-[#0065ff] text-white ring-1 ring-blue-400/40',
    pages: {
      ip: (v) => `https://www.virustotal.com/gui/ip-address/${enc(v)}`,
      domain: (v) => `https://www.virustotal.com/gui/domain/${enc(v)}`,
      hash: (v) => `https://www.virustotal.com/gui/file/${enc(v)}`,
      // VirusTotal identifies URLs by a hash of their canonical form; without a lookup permalink, search for it.
      url: (v) => `https://www.virustotal.com/gui/search/${enc(enc(v))}`,
    },
  },
  {
    id: 'abuseipdb',
    label: 'AbuseIPDB',
    icon: '🟠',
    color: 'bg-[#e65100] hover:bg-[#f57c00] text-white ring-1 ring-orange-400/40',
    pages: {
      ip: (v) => `https://www.abuseipdb.com/check/${enc(v)}`,
      domain: (v) => `https://www.abuseipdb.com/check/${enc(v)}`,
    },
  },
  {
    id: 'otx',
    label: 'OTX',
    icon: '🟢',
    color: 'bg-[#0d8050] hover:bg-[#10a366] text-white ring-1 ring-emerald-400/40',
    pages: {
      ip: (v) => `https://otx.alienvault.com/indicator/ip/${enc(v)}`,
      domain: (v) => `https://otx.alienvault.com/indicator/domain/${enc(v)}`,
      url: (v) => `https://otx.alienvault.com/indicator/url/${enc(v)}`,
      hash: (v) => `https://otx.alienvault.com/indicator/file/${enc(v)}`,
    },
  },
  {
    id: 'urlhaus',
    label: 'URLhaus',
    icon: '🟣',
    color: 'bg-[#5b3fa8] hover:bg-[#6d4fc2] text-white ring-1 ring-violet-400/40',
    pages: {
      url: (v) => `https://urlhaus.abuse.ch/browse.php?search=${enc(v)}`,
      domain: (v) => `https://urlhaus.abuse.ch/browse.php?search=${enc(v)}`,
      ip: (v) => `https://urlhaus.abuse.ch/browse.php?search=${enc(v)}`,
    },
  },
];

/**
 * Pages to open for one service: the exact report link from a finished lookup when there
 * is one, otherwise the service's page for that kind of indicator. Unique, in input order.
 */
function pagesFor(service: ExternalService, items: ItemView[]): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    const permalink = item.results[service.id]?.permalink;
    const url = permalink && /^https:\/\//i.test(permalink) ? permalink : service.pages[KIND_OF[item.type]]?.(item.value);
    if (url) urls.add(url);
  }
  return [...urls];
}

/**
 * Open one tab per page. Runs synchronously inside the click handler so it stays within the
 * browser's user-activation window; browsers that still block extra tabs are detected and reported.
 */
function openTabs(urls: string[]): { opened: number; blocked: boolean } {
  let opened = 0;
  let blocked = false;
  for (const url of urls) {
    try {
      // With noopener, window.open returns null even on success in some browsers, so open first and detach.
      const w = window.open(url, '_blank');
      if (!w) {
        blocked = true;
        continue;
      }
      w.opener = null;
      opened++;
    } catch {
      blocked = true;
    }
  }
  return { opened, blocked };
}

interface Feedback {
  serviceId: ProviderId;
  opened: number;
  blocked: boolean;
}

export interface BulkVerifyProps {
  /** Every indicator in the batch (only provider-eligible ones are opened). */
  items: ItemView[];
  className?: string;
}

/** Toolbar that opens every indicator of the batch in a provider's website, one tab each. */
export function BulkVerify({ items, className = '' }: BulkVerifyProps) {
  const [scope, setScope] = useState<Kind | 'all'>('all');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Indicators kept local (private IPs, internal domains) are never sent anywhere, not even as a tab.
  const eligible = useMemo(() => items.filter((i) => i.lookupEligible), [items]);
  const counts = useMemo(() => {
    const c: Record<Kind, number> = { ip: 0, domain: 0, url: 0, hash: 0 };
    for (const item of eligible) c[KIND_OF[item.type]]++;
    return c;
  }, [eligible]);
  const kinds = (Object.keys(counts) as Kind[]).filter((k) => counts[k] > 0);
  const activeScope = scope !== 'all' && counts[scope] === 0 ? 'all' : scope;
  const inScope = useMemo(
    () => (activeScope === 'all' ? eligible : eligible.filter((i) => KIND_OF[i.type] === activeScope)),
    [eligible, activeScope],
  );
  const targets = useMemo(() => EXTERNAL_SERVICES.map((s) => ({ service: s, urls: pagesFor(s, inScope) })), [inScope]);

  const open = useCallback((service: ExternalService, urls: string[]) => {
    if (urls.length === 0) return;
    const result = openTabs(urls);
    setFeedback({ serviceId: service.id, ...result });
    if (timer.current) clearTimeout(timer.current);
    if (!result.blocked) timer.current = setTimeout(() => setFeedback(null), 4500);
  }, []);

  if (eligible.length === 0) return null;

  const scopeLabel =
    activeScope === 'all'
      ? kinds.map((k) => `${counts[k]} ${KIND_LABELS[k][counts[k] === 1 ? 0 : 1]}`).join(', ')
      : `${counts[activeScope]} ${KIND_LABELS[activeScope][counts[activeScope] === 1 ? 0 : 1]}`;

  return (
    <div className={`border-b border-line bg-raised/60 px-4 py-3 sm:px-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[12px] font-bold text-brand ring-1 ring-brand/30"
            aria-hidden
          >
            ⚡
          </span>
          <span className="text-[13px] font-semibold text-ink">Open all in tabs</span>
          <span className="text-[12px] text-muted">{scopeLabel}</span>
          {kinds.length > 1 && (
            <span className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Indicators to open">
              {(['all', ...kinds] as Array<Kind | 'all'>).map((k) => {
                const active = activeScope === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setScope(k)}
                    className={`chip !px-2 !py-0.5 !text-[11px] capitalize transition ${
                      active ? 'bg-ink text-canvas' : 'bg-raised text-muted ring-1 ring-line hover:text-ink'
                    }`}
                  >
                    {k === 'all' ? 'All' : KIND_LABELS[k][1]}
                  </button>
                );
              })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {targets.map(({ service, urls }) => {
            const done = feedback?.serviceId === service.id && !feedback.blocked;
            return (
              <button
                key={service.id}
                type="button"
                disabled={urls.length === 0}
                onClick={() => open(service, urls)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold shadow-sm transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
                  done ? 'bg-emerald-600 text-white ring-1 ring-emerald-400/40' : service.color
                }`}
                title={
                  urls.length
                    ? `Open ${urls.length} tab${urls.length === 1 ? '' : 's'} in ${service.label}`
                    : `${service.label} has no page for these indicators`
                }
              >
                <span aria-hidden>{service.icon}</span>
                {done ? (
                  <span>
                    ✓ Opened {feedback.opened} in {service.label}
                  </span>
                ) : (
                  <span>
                    {service.label}
                    <span className="ml-1.5 rounded-full bg-white/25 px-1.5 text-[10px] tabular-nums">{urls.length}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {feedback?.blocked && (
        <div
          role="status"
          className="mt-2.5 flex items-center gap-2 rounded-md bg-medium-soft px-3 py-1.5 text-[12px] text-medium ring-1 ring-medium/30"
        >
          <span aria-hidden>⚠️</span>
          <span>
            Opened {feedback.opened} of the tabs; your browser blocked the rest. Allow pop-ups for this site (icon in the address bar), then
            click again.
          </span>
        </div>
      )}
    </div>
  );
}
