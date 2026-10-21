import { useEffect, useState } from 'react';
import { Empty, ErrorBanner, Notice, Panel, Spinner } from '../components/ui';
import { api, TYPE_LABELS, type Health, type ProviderInfo } from '../lib/api';
import { useUser } from '../lib/auth';

const STATE_STYLES = {
  ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  unconfigured: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  disabled: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

function ProviderCard({ p, canTest }: { p: ProviderInfo; canTest: boolean }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      setResult(await api.testProvider(p.id));
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 text-xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{p.name}</span>
        <span className={`badge ${STATE_STYLES[p.state]}`}>
          {p.state === 'ready' ? 'Ready' : p.state === 'unconfigured' ? 'No API key' : 'Disabled'}
        </span>
      </div>
      <p className="mt-1 text-slate-600 dark:text-slate-300">{p.description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {p.supports.map((t) => (
          <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-slate-800">
            {TYPE_LABELS[t]}
          </span>
        ))}
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600 dark:text-slate-300">
        <dt className="text-slate-500">Rate limit</dt>
        <dd>
          {p.limits.requestsPerMinute}/min, {p.limits.concurrency} at a time
        </dd>
        <dt className="text-slate-500">Daily quota</dt>
        <dd>{p.limits.dailyLimit === null ? 'none enforced locally' : `${p.usedToday} of ${p.limits.dailyLimit} used today (UTC)`}</dd>
        {p.credentialEnv && (
          <>
            <dt className="text-slate-500">Key setting</dt>
            <dd>
              <code>{p.credentialEnv}</code>
            </dd>
          </>
        )}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {p.state === 'ready' && canTest && (
          <button type="button" className="btn" onClick={test} disabled={testing}>
            {testing ? (
              <>
                <Spinner /> Testing…
              </>
            ) : (
              'Test key'
            )}
          </button>
        )}
        {p.state === 'unconfigured' && p.signupUrl && (
          <a className="text-sky-700 underline dark:text-sky-400" href={p.signupUrl} target="_blank" rel="noopener noreferrer">
            Get a free API key ↗
          </a>
        )}
      </div>
      {result && (
        <div className={`mt-2 ${result.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

export function ProvidersPage() {
  const user = useUser();
  const isAdmin = user.role === 'admin';
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.providers(), api.getHealth()])
      .then(([p, h]) => {
        setProviders(p.data);
        setHealth(h);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const e = health?.enrichment;
  return (
    <main className="mx-auto max-w-[1400px] space-y-3 px-4 py-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-base font-semibold">Threat intel providers</h1>
        <span className="text-xs text-slate-500">API keys are held by the server and never sent to the browser</span>
      </div>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {isAdmin && e && (e.database.mode === 'embedded' || e.queue.mode === 'memory') && (
        <Notice tone="warn">
          Development fallbacks active:{' '}
          {[
            e.database.mode === 'embedded' && 'embedded MongoDB (data kept in backend/.data)',
            e.queue.mode === 'memory' && 'in-process queue (unfinished lookups resume from the database after a restart)',
          ]
            .filter(Boolean)
            .join('; ')}
          . Configure MONGODB_URI (and optionally REDIS_URL) for production.
        </Notice>
      )}
      <Panel title="Providers">
        {providers === null ? (
          <Empty>
            <Spinner /> Loading…
          </Empty>
        ) : (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((p) => (
              <ProviderCard key={p.id} p={p} canTest={isAdmin} />
            ))}
          </div>
        )}
      </Panel>
      <p className="text-xs text-slate-500">
        Keys are set as server environment variables; after changing one, restart (redeploy) the backend. Lookups only read existing
        reports: nothing is uploaded or submitted for new analysis.
      </p>
    </main>
  );
}
