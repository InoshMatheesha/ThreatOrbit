import { useState, useCallback } from 'react';
import type { ItemView } from '../../lib/api';

// ── URL builders for each service ────────────────────────────────────────────

const SERVICES = [
  {
    id: 'virustotal' as const,
    label: 'VirusTotal',
    color: 'bg-blue-600 hover:bg-blue-500',
    icon: '🔵',
    url: (ip: string) => `https://www.virustotal.com/gui/ip-address/${ip}`,
  },
  {
    id: 'abuseipdb' as const,
    label: 'AbuseIPDB',
    color: 'bg-orange-600 hover:bg-orange-500',
    icon: '🟠',
    url: (ip: string) => `https://www.abuseipdb.com/check/${ip}`,
  },
  {
    id: 'otx' as const,
    label: 'OTX',
    color: 'bg-green-700 hover:bg-green-600',
    icon: '🟢',
    url: (ip: string) => `https://otx.alienvault.com/indicator/ip/${ip}`,
  },
] as const;

type ServiceId = (typeof SERVICES)[number]['id'];

interface FeedbackState {
  serviceId: ServiceId;
  count: number;
}

interface Props {
  /** All items from the current batch results page. */
  items: ItemView[];
}

/**
 * Opens one new tab per IP address for the selected threat-intelligence service.
 *
 * To avoid browser popup-blocker heuristics we:
 *  1. Open tabs synchronously in the same user-gesture callback (no async gaps before first open).
 *  2. Stagger subsequent opens with a minimal setTimeout(0) so the browser event loop
 *     processes each open before the next — this prevents bulk-blocking on some browsers.
 */
function openTabsForService(ips: string[], urlBuilder: (ip: string) => string): Promise<number> {
  return new Promise((resolve) => {
    if (ips.length === 0) { resolve(0); return; }

    // Open the first tab synchronously (must be inside the click handler).
    window.open(urlBuilder(ips[0]), '_blank', 'noopener,noreferrer');

    if (ips.length === 1) { resolve(1); return; }

    // Stagger the remaining tabs via microtask queue to stay within the same
    // user-gesture window while giving browsers time to process each open.
    let i = 1;
    function openNext() {
      if (i >= ips.length) { resolve(ips.length); return; }
      window.open(urlBuilder(ips[i]), '_blank', 'noopener,noreferrer');
      i++;
      setTimeout(openNext, 0);
    }
    setTimeout(openNext, 0);
  });
}

export function BulkVerify({ items }: Props) {
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [busy, setBusy] = useState<ServiceId | null>(null);

  // Extract unique IPv4 / IPv6 addresses that are eligible for external lookup.
  const ipAddresses = [
    ...new Set(
      items
        .filter((item) => (item.type === 'ipv4' || item.type === 'ipv6') && item.lookupEligible)
        .map((item) => item.value),
    ),
  ];

  const handleVerify = useCallback(
    async (service: (typeof SERVICES)[number]) => {
      if (ipAddresses.length === 0 || busy) return;
      setBusy(service.id);
      setFeedback(null);

      const count = await openTabsForService(ipAddresses, service.url);

      setFeedback({ serviceId: service.id, count });
      setBusy(null);

      // Clear the feedback badge after 4 seconds.
      setTimeout(() => setFeedback((f) => (f?.serviceId === service.id ? null : f)), 4000);
    },
    [ipAddresses, busy],
  );

  if (ipAddresses.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight">Bulk IP Verification</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            {ipAddresses.length} IP address{ipAddresses.length !== 1 ? 'es' : ''} identified — open all in an external
            service at once.
          </p>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        {/* IP address chips */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {ipAddresses.map((ip) => (
            <span key={ip} className="chip bg-raised font-mono text-[11px] ring-1 ring-line">
              {ip}
            </span>
          ))}
        </div>

        {/* Service buttons */}
        <div className="flex flex-wrap gap-2">
          {SERVICES.map((service) => {
            const isBusy = busy === service.id;
            const wasDone = feedback?.serviceId === service.id;

            return (
              <button
                key={service.id}
                type="button"
                disabled={busy !== null}
                onClick={() => handleVerify(service)}
                className={`
                  inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold text-white
                  transition-all duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60
                  ${wasDone ? 'bg-emerald-600 hover:bg-emerald-500' : service.color}
                `}
                title={`Open all ${ipAddresses.length} IP${ipAddresses.length !== 1 ? 's' : ''} in ${service.label}`}
              >
                <span aria-hidden>{service.icon}</span>
                {isBusy ? (
                  <>Opening tabs…</>
                ) : wasDone ? (
                  <>✓ Opened {feedback!.count} in {service.label}</>
                ) : (
                  <>
                    {service.label}{' '}
                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] tabular-nums">
                      {ipAddresses.length}
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-[11px] text-muted">
          Each button opens one tab per IP. Allow pop-ups for this site if your browser blocks them.
        </p>
      </div>
    </section>
  );
}

