import { useState, type FormEvent } from 'react';
import { ErrorBanner } from '../components/ui';
import { useAuth } from '../lib/auth';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-md border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-10 w-10" />
          <div>
            <div className="text-sm font-semibold">ThreatOrbit</div>
            <div className="text-xs text-slate-500">Sign in to continue</div>
          </div>
        </div>
        <label className="block text-xs">
          <span className="mb-1 block font-medium">Email</span>
          <input
            className="input w-full py-1.5 text-sm"
            type="email"
            autoComplete="username"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-medium">Password</span>
          <input
            className="input w-full py-1.5 text-sm"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <button type="submit" className="btn-primary w-full py-2" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-center text-[11px] text-slate-500">Accounts are created by your team administrator.</p>
      </form>
    </main>
  );
}
