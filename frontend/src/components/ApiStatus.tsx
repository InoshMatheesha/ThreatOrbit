import { useEffect, useState } from 'react';
import { api, type Health } from '../lib/api';

/** API reachability plus a warning when running on development fallbacks. */
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
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (health === null) return <Dot color="bg-slate-400" label="Checking API" />;
  if (health === 'down') return <Dot color="bg-red-500" label="API unreachable" />;
  const e = health.enrichment;
  if (!e?.database.connected) return <Dot color="bg-red-500" label="Database offline" />;
  const fallbacks = [e.database.mode === 'embedded' && 'embedded DB', e.queue.mode === 'memory' && 'in-process queue'].filter(Boolean);
  return (
    <Dot
      color={fallbacks.length ? 'bg-amber-500' : 'bg-emerald-500'}
      label={fallbacks.length ? `Online (dev: ${fallbacks.join(', ')})` : 'Online'}
      title={fallbacks.length ? 'Running on development fallbacks. Fine for one analyst on this PC; see README for MongoDB/Redis setup.' : 'MongoDB and Redis connected'}
    />
  );
}

function Dot({ color, label, title }: { color: string; label: string; title?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" title={title}>
      <span className={`h-2 w-2 rounded-full ${color}`} aria-hidden />
      {label}
    </span>
  );
}
