import type { ReactNode } from 'react';
import { useUser } from '../lib/auth';
import { Link, usePath } from '../lib/router';
import { ApiStatus } from './ApiStatus';
import { LayersIcon, ScanIcon, ServerIcon, UsersIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { Logo } from './ui';
import { UserMenu } from './UserMenu';

function useNav() {
  const user = useUser();
  const path = usePath();
  return [
    { to: '/', label: 'Investigate', Icon: ScanIcon, active: path === '/' },
    { to: '/batches', label: 'Batches', Icon: LayersIcon, active: path.startsWith('/batches') },
    { to: '/providers', label: 'Sources', Icon: ServerIcon, active: path.startsWith('/providers') },
    ...(user.role === 'admin' ? [{ to: '/users', label: 'Team', Icon: UsersIcon, active: path.startsWith('/users') }] : []),
  ];
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <Logo size={34} />
      <span className="leading-tight">
        <span className="block text-[16px] font-semibold tracking-tight">ThreatOrbit</span>
        <span className="block text-[11px] text-muted">Indicator triage</span>
      </span>
    </Link>
  );
}

/** Desktop and Windows laptops: a fixed sidebar. Phones and tablets: a top bar and a bottom tab bar. */
export function AppShell({ children }: { children: ReactNode }) {
  const nav = useNav();
  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/80 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <nav className="mt-8 flex flex-col gap-1" aria-label="Main">
          {nav.map(({ to, label, Icon, active }) => (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition ${
                active ? 'bg-brand-soft font-semibold text-brand' : 'text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              <Icon size={19} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="px-2">
            <ApiStatus />
          </div>
          <ThemeToggle />
          <UserMenu full />
        </div>
      </aside>

      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Brand />
          <div className="flex items-center gap-1">
            <ApiStatus compact />
            <ThemeToggle compact />
            <UserMenu />
          </div>
        </div>
      </header>

      <div className="lg:pl-64">{children}</div>

      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
          {nav.map(({ to, label, Icon, active }) => (
            <li key={to}>
              <Link
                to={to}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition ${
                  active ? 'text-brand' : 'text-muted'
                }`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition ${active ? 'bg-brand-soft' : ''}`}>
                  <Icon size={20} />
                </span>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
