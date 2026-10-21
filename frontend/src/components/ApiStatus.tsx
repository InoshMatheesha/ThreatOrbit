import { useEffect, useState } from 'react';
import { api, type Health } from '../lib/api';

/** Small service indicator. Development fallbacks are surfaced as a warning. */
export function ApiStatus() {
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
  if (health === 'down') return <Dot color="bg-red-500" label="Service unavailable" />;
  const e = health.enrichment;
  if (e && !e.database.connected) return <Dot color="bg-red-500" label="Database offline" />;
  const fallback = e && (e.database.mode === 'embedded' || e.queue.mode === 'memory');
  return (
    <Dot
      color={fallback ? 'bg-amber-500' : 'bg-emerald-500'}
      label="Operational"
      title={fallback ? 'Running on development fallbacks (embedded database or in-process queue)' : 'All systems operational'}
    />
  );
}

function Dot({ color, label, title }: { color: string; label: string; title?: string }) {
  return (
    <span className="hidden items-center gap-1.5 text-xs text-slate-500 md:inline-flex dark:text-slate-400" title={title}>
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
