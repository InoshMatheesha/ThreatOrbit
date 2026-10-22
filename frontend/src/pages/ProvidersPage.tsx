import { useEffect, useState } from 'react';
import { ExternalIcon } from '../components/icons';
import { ErrorBanner, Notice, Page, Skeleton, Spinner } from '../components/ui';
import { AiSettingsCard } from '../features/ai/AiSettingsCard';
import { api, TYPE_LABELS, type Health, type ProviderInfo } from '../lib/api';
import { useUser } from '../lib/auth';

const STATE_STYLES = {
  ready: 'bg-low-soft text-low',
  unconfigured: 'bg-unknown-soft text-unknown',
  disabled: 'bg-medium-soft text-medium',
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
    <div className="card flex flex-col p-5 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <span className="text-[16px] font-semibold tracking-tight">{p.name}</span>
        <span className={`badge ${STATE_STYLES[p.state]}`}>
          {p.state === 'ready' ? 'Ready' : p.state === 'unconfigured' ? 'No API key' : 'Disabled'}
        </span>
      </div>
      <p className="mt-1.5 text-muted">{p.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {p.supports.map((t) => (
          <span key={t} className="chip bg-raised ring-1 ring-line">
            {TYPE_LABELS[t]}
          </span>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted">Rate limit</dt>
        <dd>
          {p.limits.requestsPerMinute}/min, {p.limits.concurrency} at a time
        </dd>
        <dt className="text-muted">Daily quota</dt>
        <dd>{p.limits.dailyLimit === null ? 'none enforced locally' : `${p.usedToday} of ${p.limits.dailyLimit} used today (UTC)`}</dd>
        {p.credentialEnv && (
          <>
            <dt className="text-muted">Key setting</dt>
            <dd>
              <code className="font-mono text-[12px]">{p.credentialEnv}</code>
            </dd>
          </>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
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
          <a
            className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline"
            href={p.signupUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get a free API key <ExternalIcon size={13} />
          </a>
        )}
      </div>
      {result && <div className={`mt-3 ${result.ok ? 'text-low' : 'text-high'}`}>{result.message}</div>}
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
  const ai = health?.ai;
  return (
    <Page title="Sources" subtitle="The services ThreatOrbit asks. API keys are held by the server and are never sent to the browser.">
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
      {providers === null ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-60 w-full !rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => (
            <ProviderCard key={p.id} p={p} canTest={isAdmin} />
          ))}
        </div>
      )}

      <AiSettingsCard isAdmin={isAdmin} {...(ai ? { status: ai } : {})} />

      <p className="text-[12px] text-muted">
        Keys are set as server environment variables; after changing one, redeploy. Lookups only read existing reports: nothing is uploaded
        or submitted for new analysis.
      </p>
    </Page>
  );
}
