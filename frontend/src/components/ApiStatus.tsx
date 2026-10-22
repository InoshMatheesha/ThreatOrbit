import { useEffect, useState } from 'react';
import { api, type Health } from '../lib/api';

/** Small service indicator. Development fallbacks are surfaced as a warning. */
export function ApiStatus({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<Health | null | 'down'>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      api
        .getHealth()
        .then((h) => !cancelled && setHealth(h))
        .catch(() => !cancelled && setHealth('down'));
    void check();
    const id = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (health === null) return null;
  if (health === 'down') return <Dot color="bg-high" label="Service unavailable" compact={compact} />;
  const e = health.enrichment;
  if (e && !e.database.connected) return <Dot color="bg-high" label="Database offline" compact={compact} />;
  const fallback = e && (e.database.mode === 'embedded' || e.queue.mode === 'memory');
  return (
    <Dot
      color={fallback ? 'bg-medium' : 'bg-low'}
      label={fallback ? 'Development mode' : 'All systems operational'}
      title={fallback ? 'Running on development fallbacks (embedded database or in-process queue)' : undefined}
      compact={compact}
    />
  );
}

function Dot({ color, label, title, compact }: { color: string; label: string; title?: string; compact: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted" title={title ?? label}>
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${color}`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
      </span>
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  );
}
