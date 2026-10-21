import { useEffect, useRef, useState } from 'react';
import { useAuth, useUser } from '../lib/auth';
import { ChangePasswordDialog } from './ChangePasswordDialog';

export function UserMenu() {
  const user = useUser();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
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
        className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-600 text-[10px] font-semibold text-white">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block font-medium leading-tight">{user.name}</span>
          <span className="block text-[10px] capitalize leading-tight text-slate-500">{user.role}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <div className="font-medium">{user.name}</div>
            <div className="truncate text-slate-500">{user.email}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
            onClick={() => {
              setOpen(false);
              setChanging(true);
            }}
          >
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-red-700 hover:bg-slate-50 dark:text-red-400 dark:hover:bg-slate-800"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      )}
      {changing && <ChangePasswordDialog onClose={() => setChanging(false)} />}
    </div>
  );
}
