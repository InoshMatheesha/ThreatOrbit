import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '../lib/auth';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { ChevronDownIcon, KeyIcon, LogoutIcon } from './icons';

/** Avatar menu. `full` shows name and role (sidebar); otherwise only the avatar (top bar). */
export function UserMenu({ full = false }: { full?: boolean }) {
  const user = useUser();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-3 rounded-xl text-left transition hover:bg-raised ${full ? 'border border-line p-2.5' : 'p-1'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
          style={{ backgroundImage: 'linear-gradient(135deg, var(--c-brand), var(--c-accent))' }}
        >
          {initials}
        </span>
        {full && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-tight font-semibold">{user.name}</span>
              <span className="block text-[11px] leading-tight text-muted capitalize">{user.role}</span>
            </span>
            <ChevronDownIcon size={16} className="text-muted" />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={`card animate-sheet absolute z-50 w-64 py-1.5 text-[13px] ${full ? 'bottom-full left-0 mb-2' : 'top-full right-0 mt-2'}`}
        >
          <div className="border-b border-line px-4 py-2.5">
            <div className="font-semibold">{user.name}</div>
            <div className="truncate text-muted">{user.email}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left hover:bg-raised"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
          >
            <KeyIcon size={16} className="text-muted" /> Change password
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-high hover:bg-high-soft"
            onClick={() => void signOut()}
          >
            <LogoutIcon size={16} /> Sign out
          </button>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}
