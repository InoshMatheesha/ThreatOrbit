import { ApiStatus } from './ApiStatus';

export function Header() {
  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight">Threat Intel Hub</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            ThreatOrbit
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">Local only · no auth</span>
          <ApiStatus />
        </div>
      </div>
    </header>
  );
}
