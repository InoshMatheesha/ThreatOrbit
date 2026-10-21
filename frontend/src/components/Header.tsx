import { Link, usePath } from '../lib/router';
import { ApiStatus } from './ApiStatus';

const NAV = [
  { to: '/', label: 'Investigate', match: (p: string) => p === '/' },
  { to: '/batches', label: 'Batches', match: (p: string) => p.startsWith('/batches') },
  { to: '/providers', label: 'Providers', match: (p: string) => p.startsWith('/providers') },
];

export function Header() {
  const path = usePath();
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-center gap-5">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-tight">Threat Intel Hub</span>
          </Link>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  n.match(path)
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-slate-500 md:inline dark:text-slate-400">Local only · no auth</span>
          <ApiStatus />
        </div>
      </div>
    </header>
  );
}
