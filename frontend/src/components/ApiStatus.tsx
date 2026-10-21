import { useEffect, useState } from 'react';
import { getHealth } from '../lib/api';

type Status = 'checking' | 'up' | 'down';

export function ApiStatus() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;
    const check = () =>
      getHealth()
        .then(() => !cancelled && setStatus('up'))
        .catch(() => !cancelled && setStatus('down'));
    void check();
    const id = setInterval(check, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const styles: Record<Status, string> = {
    checking: 'bg-slate-400',
    up: 'bg-emerald-500',
    down: 'bg-red-500',
  };
  const labels: Record<Status, string> = { checking: 'Checking API', up: 'API online', down: 'API unreachable' };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <span className={`h-2 w-2 rounded-full ${styles[status]}`} aria-hidden />
      {labels[status]}
    </span>
  );
}
