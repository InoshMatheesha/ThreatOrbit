import { useCallback, useEffect, useState } from 'react';
import { PlusIcon } from '../components/icons';
import { ErrorBanner, Modal, Page, Panel, Skeleton, Spinner } from '../components/ui';
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
            {busy ? <Spinner /> : null} {busy ? 'Adding…' : 'Add member'}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1.5 block font-medium">Full name</span>
        <input className="input w-full" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="block">
        <span className="mb-1.5 block font-medium">Email</span>
        <input className="input w-full" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label className="block">
        <span className="mb-1.5 block font-medium">Role</span>
        <select className="input w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
          <option value="analyst">Analyst</option>
          <option value="admin">Admin</option>
        </select>
        <span className="mt-1.5 block text-muted">{ROLE_HELP[form.role]}</span>
      </label>
      <label className="block">
        <span className="mb-1.5 block font-medium">Temporary password (at least 12 characters)</span>
        <input
          className="input w-full"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <span className="mt-1.5 block text-muted">Share it privately; they can change it from their profile menu after signing in.</span>
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
            <span className="mb-1.5 block font-medium">New temporary password (at least 12 characters)</span>
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

  const active = users?.filter((u) => u.active).length ?? 0;
  const roleSelect = (u: TeamUser) => (
    <select
      className="input"
      aria-label={`Role for ${u.name}`}
      value={u.role}
      onChange={(e) => void change(u, { role: e.target.value as Role })}
    >
      <option value="analyst">Analyst</option>
      <option value="admin">Admin</option>
    </select>
  );
  const statusBadge = (u: TeamUser) => (
    <span className={`badge ${u.active ? 'bg-low-soft text-low' : 'bg-unknown-soft text-unknown'}`}>
      {u.active ? 'Active' : 'Deactivated'}
    </span>
  );
  const actions = (u: TeamUser) => (
    <>
      <button type="button" className="btn" onClick={() => setResetting(u)}>
        Reset password
      </button>
      {u.id !== me.id && (
        <button
          type="button"
          className={u.active ? 'btn-danger' : 'btn'}
          onClick={() =>
            (!u.active || confirm(`Deactivate ${u.name}? They will be signed out immediately.`)) && void change(u, { active: !u.active })
          }
        >
          {u.active ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
    </>
  );

  return (
    <Page
      title="Team"
      subtitle="Changing a role, resetting a password or deactivating someone signs them out everywhere."
      actions={
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
          <PlusIcon size={16} /> Add member
        </button>
      }
    >
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Panel title={users ? `${active} active member${active === 1 ? '' : 's'}` : 'Members'}>
        {users === null ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {users.map((u) => (
                <li key={u.id} className={`space-y-3 px-4 py-4 ${u.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {u.name} {u.id === me.id && <span className="font-normal text-muted">(you)</span>}
                      </div>
                      <div className="truncate text-[12px] text-muted">{u.email}</div>
                    </div>
                    {statusBadge(u)}
                  </div>
                  <div className="text-[12px] text-muted">Last sign-in {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {roleSelect(u)}
                    {actions(u)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-raised/60">
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Role</th>
                    <th className="th">Status</th>
                    <th className="th">Last sign-in</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {users.map((u) => (
                    <tr key={u.id} className={u.active ? '' : 'opacity-60'}>
                      <td className="td">
                        <div className="font-semibold">
                          {u.name} {u.id === me.id && <span className="font-normal text-muted">(you)</span>}
                        </div>
                        <div className="text-muted">{u.email}</div>
                      </td>
                      <td className="td">{roleSelect(u)}</td>
                      <td className="td">{statusBadge(u)}</td>
                      <td className="td text-muted" title={u.lastLoginAt ? dateTime(u.lastLoginAt) : undefined}>
                        {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-2">{actions(u)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      {adding && <AddUserDialog onClose={() => setAdding(false)} onCreated={load} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </Page>
  );
}
