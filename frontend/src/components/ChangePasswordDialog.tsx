import { useState } from 'react';
import { api } from '../lib/api';
import { ErrorBanner, Modal } from './ui';

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Change password"
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
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !current || next.length < 12 || next !== confirm}
              onClick={submit}
            >
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </>
        )
      }
    >
      {done ? (
        <p>Password changed. You stay signed in here; every other session has been signed out.</p>
      ) : (
        <>
          {[
            ['Current password', current, setCurrent, 'current-password'],
            ['New password (at least 12 characters)', next, setNext, 'new-password'],
            ['Confirm new password', confirm, setConfirm, 'new-password'],
          ].map(([label, value, set, auto]) => (
            <label key={label as string} className="block">
              <span className="mb-1.5 block font-medium">{label as string}</span>
              <input
                type="password"
                className="input w-full"
                autoComplete={auto as string}
                value={value as string}
                onChange={(e) => (set as (v: string) => void)(e.target.value)}
              />
            </label>
          ))}
          {mismatch && <p className="text-high">The new passwords do not match.</p>}
          {error && <ErrorBanner>{error}</ErrorBanner>}
        </>
      )}
    </Modal>
  );
}
