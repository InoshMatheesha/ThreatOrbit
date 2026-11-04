import { useState, useCallback, useMemo } from 'react';
import type { ItemView } from '../../lib/api';

// ── Service definitions & query builders ─────────────────────────────────────

export const EXTERNAL_SERVICES = [
  {
    id: 'virustotal' as const,
    label: 'VirusTotal',
    buttonLabel: 'Open all in VirusTotal',
    shortLabel: 'VirusTotal',
    color: 'bg-[#0052cc] hover:bg-[#0065ff] text-white shadow-sm ring-1 ring-blue-400/40',
    activeColor: 'bg-emerald-600 text-white ring-1 ring-emerald-400/40',
    icon: '🔵',
    url: (ip: string) => `https://www.virustotal.com/gui/ip-address/${encodeURIComponent(ip)}`,
  },
  {
    id: 'abuseipdb' as const,
    label: 'AbuseIPDB',
    buttonLabel: 'Open all in AbuseIPDB',
    shortLabel: 'AbuseIPDB',
    color: 'bg-[#e65100] hover:bg-[#f57c00] text-white shadow-sm ring-1 ring-orange-400/40',
    activeColor: 'bg-emerald-600 text-white ring-1 ring-emerald-400/40',
    icon: '🟠',
    url: (ip: string) => `https://www.abuseipdb.com/check/${encodeURIComponent(ip)}`,
  },
  {
    id: 'otx' as const,
    label: 'OTX',
    buttonLabel: 'Open all in OTX',
    shortLabel: 'OTX (AlienVault)',
    color: 'bg-[#0d8050] hover:bg-[#10a366] text-white shadow-sm ring-1 ring-emerald-400/40',
    activeColor: 'bg-emerald-600 text-white ring-1 ring-emerald-400/40',
    icon: '🟢',
    url: (ip: string) => `https://otx.alienvault.com/indicator/ip/${encodeURIComponent(ip)}`,
  },
] as const;

export type ExternalServiceId = (typeof EXTERNAL_SERVICES)[number]['id'];

interface FeedbackState {
  serviceId: ExternalServiceId;
  count: number;
  blocked: boolean;
}

export interface BulkVerifyProps {
  /** Optional array of ItemView records to extract IPs from */
  items?: ItemView[] | null;
  /** Optional array of raw IP address strings */
  ips?: string[];
  /** Display variant: 'bar' (embedded in table toolbar) or 'card' (standalone panel) */
  variant?: 'bar' | 'card';
  className?: string;
}

/**
 * Programmatically opens one new browser tab per IP for the given service.
 * Executed synchronously inside the click handler to stay within browser
 * user-activation security policies.
 */
function openTabsForService(ips: string[], urlBuilder: (ip: string) => string): { opened: number; blocked: boolean } {
  if (ips.length === 0) return { opened: 0, blocked: false };

  let opened = 0;
  let blocked = false;

  for (let i = 0; i < ips.length; i++) {
    const ip = ips[i];
    if (!ip) continue;
    try {
      const w = window.open(urlBuilder(ip), '_blank', 'noopener,noreferrer');
      if (!w || w.closed || typeof w.closed === 'undefined') {
        // Browser popup blocker intervened on this tab
        blocked = true;
      } else {
        opened++;
      }
    } catch {
      blocked = true;
    }
  }

  return { opened, blocked };
}

export function BulkVerify({ items, ips, variant = 'bar', className = '' }: BulkVerifyProps) {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busy, setBusy] = useState<ExternalServiceId | null>(null);

  // Extract unique IP addresses from either explicit list or ItemView items
  const ipAddresses = useMemo(() => {
    if (ips && ips.length > 0) {
      return [...new Set(ips)];
    }
    if (items && items.length > 0) {
      return [
        ...new Set(
          items
            .filter((item) => item.type === 'ipv4' || item.type === 'ipv6')
            .map((item) => item.value),
        ),
      ];
    }
    return [];
  }, [items, ips]);

  const handleVerify = useCallback(
    (service: (typeof EXTERNAL_SERVICES)[number]) => {
      if (ipAddresses.length === 0 || busy !== null) return;

      setBusy(service.id);
      setFeedback(null);

      const result = openTabsForService(ipAddresses, service.url);

      setFeedback({
        serviceId: service.id,
        count: result.opened,
        blocked: result.blocked,
      });
      setBusy(null);

      // Auto-dismiss the positive feedback badge after 4.5 seconds
      setTimeout(() => {
        setFeedback((prev) => (prev?.serviceId === service.id ? null : prev));
      }, 4500);
    },
    [ipAddresses, busy],
  );

  // Do not render anything if there are no IPs identified
  if (ipAddresses.length === 0) return null;

  // Render integrated toolbar bar variant (inside ResultsTable)
  if (variant === 'bar') {
    return (
      <div className={`border-b border-line bg-raised/60 px-4 py-3 sm:px-5 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-soft text-[12px] font-bold text-brand ring-1 ring-brand/30">
              ⚡
            </span>
            <div>
              <span className="text-[13px] font-semibold text-ink">
                Bulk Verification
              </span>
              <span className="ml-1.5 text-[12px] text-muted">
                — Open all <strong className="text-ink">{ipAddresses.length} IP{ipAddresses.length !== 1 ? 's' : ''}</strong> in one click:
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {EXTERNAL_SERVICES.map((service) => {
              const isBusy = busy === service.id;
              const wasDone = feedback?.serviceId === service.id;

              return (
                <button
                  key={service.id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => handleVerify(service)}
                  className={`
                    inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60
                    ${wasDone ? service.activeColor : service.color}
                  `}
                  title={`Open all ${ipAddresses.length} identified IPs in ${service.label} tabs`}
                >
                  <span aria-hidden>{service.icon}</span>
                  {isBusy ? (
                    <span>Opening…</span>
                  ) : wasDone ? (
                    <span>✓ Opened {feedback?.count ?? ipAddresses.length} in {service.label}</span>
                  ) : (
                    <span>
                      {service.buttonLabel}{' '}
                      <span className="ml-1 rounded-full bg-white/25 px-1.5 py-0.2 text-[10px] tabular-nums">
                        {ipAddresses.length}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Warning if the browser's popup blocker stopped any tabs */}
        {feedback?.blocked && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-400 ring-1 ring-amber-500/20">
            <span>⚠️</span>
            <span>
              Your browser may have blocked additional tabs. Click the pop-up blocker icon in your browser address bar and choose <strong>"Always allow pop-ups from this site"</strong>.
            </span>
          </div>
        )}
      </div>
    );
  }

  // Render standalone card variant
  return (
    <section className={`card overflow-hidden ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight">Bulk IP Verification</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {ipAddresses.length} IP address{ipAddresses.length !== 1 ? 'es' : ''} identified — programmatically open all external searches in one click.
          </p>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        {/* Identified IP chips */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {ipAddresses.map((ip) => (
            <span key={ip} className="chip bg-raised font-mono text-[11px] ring-1 ring-line">
              {ip}
            </span>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2.5">
          {EXTERNAL_SERVICES.map((service) => {
            const isBusy = busy === service.id;
            const wasDone = feedback?.serviceId === service.id;

            return (
              <button
                key={service.id}
                type="button"
                disabled={busy !== null}
                onClick={() => handleVerify(service)}
                className={`
                  inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold
                  transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60
                  ${wasDone ? service.activeColor : service.color}
                `}
                title={`Open all ${ipAddresses.length} IP${ipAddresses.length !== 1 ? 's' : ''} in ${service.label}`}
              >
                <span aria-hidden>{service.icon}</span>
                {isBusy ? (
                  <>Opening tabs…</>
                ) : wasDone ? (
                  <>✓ Opened {feedback?.count ?? ipAddresses.length} in {service.label}</>
                ) : (
                  <>
                    {service.buttonLabel}{' '}
                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] tabular-nums">
                      {ipAddresses.length}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        {feedback?.blocked ? (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-400 ring-1 ring-amber-500/20">
            <span>⚠️</span>
            <span>
              Your browser blocked some tabs. Please click the pop-up icon in your address bar and select <strong>"Always allow pop-ups"</strong>.
            </span>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted">
            Each button programmatically opens a new browser tab for each identified IP pre-loaded with the external search query.
          </p>
        )}
      </div>
    </section>
  );
}
