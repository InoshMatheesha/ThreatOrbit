import { useEffect, useState, type ReactNode } from 'react';
import { ExternalIcon, ServerIcon, SparklesIcon } from '../components/icons';
import { ErrorBanner, Notice, Page, Skeleton, Spinner } from '../components/ui';
import { AiSettingsCard } from '../features/ai/AiSettingsCard';
import { api, TYPE_LABELS, type Health, type ProviderInfo } from '../lib/api';
import { useUser } from '../lib/auth';

const STATE_DOTS = { ready: 'bg-low', unconfigured: 'bg-unknown', disabled: 'bg-medium' };

const STATE_STYLES = {
  ready: 'bg-low-soft text-low',
  unconfigured: 'bg-unknown-soft text-unknown',
  disabled: 'bg-medium-soft text-medium',
};

const VISIBLE_TYPES = 4;

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

  const { dailyLimit } = p.limits;
  const pct = dailyLimit ? Math.min(100, (p.usedToday / dailyLimit) * 100) : 0;
  const hiddenTypes = p.supports.slice(VISIBLE_TYPES);

  return (
    <div className="card flex flex-col p-4 text-[13px]">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[15px] leading-tight font-semibold tracking-tight">{p.name}</span>
        <span className={`badge shrink-0 ${STATE_STYLES[p.state]}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${STATE_DOTS[p.state]}`} aria-hidden />
          {p.state === 'ready' ? 'Ready' : p.state === 'unconfigured' ? 'No key' : 'Off'}
        </span>
      </div>
      <p className="mt-1.5 min-h-[4.1em] text-[12.5px] leading-snug text-muted">{p.description}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {p.supports.slice(0, VISIBLE_TYPES).map((t) => (
          <span key={t} className="chip bg-raised !px-1.5 !text-[10.5px] ring-1 ring-line">
            {TYPE_LABELS[t]}
          </span>
        ))}
        {hiddenTypes.length > 0 && (
          <span
            className="chip bg-raised !px-1.5 !text-[10.5px] text-muted ring-1 ring-line"
            title={hiddenTypes.map((t) => TYPE_LABELS[t]).join(', ')}
          >
            +{hiddenTypes.length}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-2.5">
        <div>
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-muted">Today</span>
            <span className="font-medium tabular-nums">
              {dailyLimit === null ? `${p.usedToday} used` : `${p.usedToday} / ${dailyLimit.toLocaleString()}`}
            </span>
          </div>
          {dailyLimit !== null && (
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised ring-1 ring-line ring-inset">
              <div className={`h-full ${pct >= 90 ? 'bg-high' : pct >= 70 ? 'bg-medium' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-muted">Speed</span>
          <span className="font-medium tabular-nums">{p.limits.requestsPerMinute}/min</span>
        </div>
      </div>

      <div className="mt-auto pt-4">
        {p.state === 'ready' && canTest && (
          <button type="button" className="btn w-full" onClick={test} disabled={testing}>
            {testing ? (
              <>
                <Spinner /> Testing…
              </>
            ) : (
              'Test key'
            )}
          </button>
        )}
        {p.state === 'unconfigured' && (
          <div className="space-y-1.5 text-[12px]">
            {p.signupUrl && (
              <a
                className="inline-flex items-center gap-1 font-medium text-brand underline-offset-2 hover:underline"
                href={p.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a free API key <ExternalIcon size={12} />
              </a>
            )}
            {p.credentialEnv && (
              <div className="text-muted">
                Set <code className="font-mono text-[11px]">{p.credentialEnv}</code>
              </div>
            )}
          </div>
        )}
        {result && <div className={`mt-2 text-[12px] ${result.ok ? 'text-low' : 'text-high'}`}>{result.message}</div>}
      </div>
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand">{icon}</span>
        <div>
          <h2 className="text-[15px] leading-tight font-semibold tracking-tight">{title}</h2>
          <p className="text-[12px] text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </section>
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
    <Page title="Sources" subtitle="Where ThreatOrbit gets its answers. API keys are held by the server and never sent to the browser.">
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
      <Section
        icon={<ServerIcon size={16} />}
        title="Threat intelligence sources"
        hint={
          providers
            ? `${providers.filter((p) => p.state === 'ready').length} of ${providers.length} ready. These are asked about every indicator.`
            : 'Loading…'
        }
      >
        {providers === null ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-56 w-full !rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {providers.map((p) => (
              <ProviderCard key={p.id} p={p} canTest={isAdmin} />
            ))}
          </div>
        )}
      </Section>

      <Section
        icon={<SparklesIcon size={16} />}
        title="AI assistant"
        hint="Explains results in plain language for people who are not security experts."
      >
        <AiSettingsCard isAdmin={isAdmin} {...(ai ? { status: ai } : {})} />
      </Section>

      <p className="text-[12px] text-muted">
        Threat source keys are server environment variables; after changing one, redeploy. Lookups only read existing reports: nothing is
        uploaded or submitted for new analysis.
      </p>
    </Page>
  );
}
