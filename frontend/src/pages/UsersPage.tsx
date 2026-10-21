import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBanner, Modal, Panel, Spinner } from '../components/ui';
import { api, type Role, type TeamUser } from '../lib/api';
import { useUser } from '../lib/auth';
import { dateTime, relativeTime } from '../lib/format';

const ROLE_HELP: Record<Role, string> = {
  admin: 'Manages the team, sees the audit log, tests provider keys, and can change or delete any batch.',
  analyst: 'Runs investigations, sees the whole team’s batches, and can change or delete their own.',
};

function AddUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'analyst' as Role, password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.createUser(form);
      onCreated();
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const valid = form.name.trim() && /\S+@\S+\.\S+/.test(form.email) && form.password.length >= 12;
  return (
    <Modal
      title="Add team member"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!valid || busy} onClick={submit}>
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block font-medium">Full name</span>
        <input className="input w-full" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="block">
        <span className="mb-1 block font-medium">Email</span>
        <input className="input w-full" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label className="block">
        <span className="mb-1 block font-medium">Role</span>
        <select className="input w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="analyst">Analyst</option>
          <option value="admin">Admin</option>
        </select>
        <span className="mt-1 block text-slate-500">{ROLE_HELP[form.role]}</span>
      </label>
      <label className="block">
        <span className="mb-1 block font-medium">Temporary password (at least 12 characters)</span>
        <input
          className="input w-full"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <span className="mt-1 block text-slate-500">Share it privately; they can change it from their profile menu after signing in.</span>
      </label>
      {error && <ErrorBanner>{error}</ErrorBanner>}
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: TeamUser; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    try {
      await api.updateUser(user.id, { password });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Modal
      title={`Reset password for ${user.name}`}
      onClose={onClose}
      footer={
        done ? (
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={password.length < 12} onClick={submit}>
              Reset password
            </button>
          </>
        )
      }
    >
      {done ? (
        <p>Password reset. {user.name} has been signed out everywhere and must use the new password.</p>
      ) : (
        <>
          <label className="block">
            <span className="mb-1 block font-medium">New temporary password (at least 12 characters)</span>
            <input
              className="input w-full"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <ErrorBanner>{error}</ErrorBanner>}
        </>
      )}
    </Modal>
  );
}

export function UsersPage() {
  const me = useUser();
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<TeamUser | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api.users());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(user: TeamUser, changes: Parameters<typeof api.updateUser>[1]) {
    setError(null);
    try {
      await api.updateUser(user.id, changes);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-3 px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">Team</h1>
        <span className="text-xs text-slate-500">
          Changing a role, resetting a password or deactivating signs that person out everywhere
        </span>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Panel
        title={
          users
            ? `${users.filter((u) => u.active).length} active member${users.filter((u) => u.active).length === 1 ? '' : 's'}`
            : 'Members'
        }
        actions={
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            Add member
          </button>
        }
      >
        {users === null ? (
          <Empty>
            <Spinner /> Loading…
          </Empty>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-1.5 font-medium">Name</th>
                <th className="px-3 py-1.5 font-medium">Role</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium">Last sign-in</th>
                <th className="px-3 py-1.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.map((u) => (
                <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                  <td className="px-3 py-1.5">
                    <div className="font-medium">
                      {u.name} {u.id === me.id && <span className="text-slate-500">(you)</span>}
                    </div>
                    <div className="text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="input"
                      aria-label={`Role for ${u.name}`}
                      value={u.role}
                      onChange={(e) => void change(u, { role: e.target.value as Role })}
                    >
                      <option value="analyst">Analyst</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`badge ${u.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}
                    >
                      {u.active ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-500" title={u.lastLoginAt ? dateTime(u.lastLoginAt) : undefined}>
                    {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <button type="button" className="btn mr-1" onClick={() => setResetting(u)}>
                      Reset password
                    </button>
                    {u.id !== me.id && (
                      <button
                        type="button"
                        className={u.active ? 'btn-danger' : 'btn'}
                        onClick={() =>
                          (!u.active || confirm(`Deactivate ${u.name}? They will be signed out immediately.`)) &&
                          void change(u, { active: !u.active })
                        }
                      >
                        {u.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {adding && <AddUserDialog onClose={() => setAdding(false)} onCreated={load} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </main>
  );
}
