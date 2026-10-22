import { useState, type FormEvent } from 'react';
import { ShieldCheckIcon, SparklesIcon, ScanIcon } from '../components/icons';
import { OrbitArt } from '../components/OrbitArt';
import { ThemeToggle } from '../components/ThemeToggle';
import { ErrorBanner, Logo, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';

const POINTS = [
  {
    Icon: ScanIcon,
    title: 'Paste hundreds, check them all',
    text: 'IPs, domains, links and file hashes, cleaned and de-duplicated for you.',
  },
  {
    Icon: ShieldCheckIcon,
    title: 'Four trusted sources, one verdict',
    text: 'VirusTotal, AbuseIPDB, AlienVault OTX and URLhaus, with the reasons shown.',
  },
  {
    Icon: SparklesIcon,
    title: 'Plain-English explanations',
    text: 'Know what it means and what to do next, even without a security background.',
  },
];

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{
          backgroundImage:
            'radial-gradient(900px 600px at 20% 0%, rgba(21,115,232,.35), transparent 60%), radial-gradient(700px 500px at 100% 100%, rgba(8,180,212,.22), transparent 60%), linear-gradient(160deg, #070d1a, #0a1428 60%, #060a13)',
        }}
      >
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <span className="text-[20px] font-semibold tracking-tight">ThreatOrbit</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <OrbitArt size={360} />
        </div>
        <div className="max-w-lg">
          <h2 className="text-[30px] leading-tight font-semibold tracking-tight">Know what is dangerous, and why.</h2>
          <ul className="mt-7 space-y-4">
            {POINTS.map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 text-[#7cc0ff] ring-1 ring-white/10">
                  <Icon size={18} />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold">{title}</span>
                  <span className="block text-[13px] text-white/60">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <main className="relative flex items-center justify-center px-5 py-10 sm:px-8">
        <div className="absolute top-4 right-4 w-48">
          <ThemeToggle />
        </div>
        <form onSubmit={submit} className="animate-rise w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo size={44} />
            <span className="text-[22px] font-semibold tracking-tight">ThreatOrbit</span>
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1.5 text-[13px] text-muted">Sign in to start investigating.</p>

          <div className="mt-7 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Email</span>
              <input
                className="input w-full"
                type="email"
                autoComplete="username"
                inputMode="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="input w-full pr-16"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3.5 text-[12px] font-medium text-muted hover:text-ink"
                  onClick={() => setShow(!show)}
                  aria-pressed={show}
                  aria-label={show ? 'Hide password' : 'Show password'}
                >
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button type="submit" className="btn-primary w-full !min-h-11 !text-[14px]" disabled={busy}>
              {busy ? (
                <>
                  <Spinner /> Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </div>
          <p className="mt-6 text-center text-[12px] text-muted">Accounts are created by your team administrator.</p>
        </form>
      </main>
    </div>
  );
}
