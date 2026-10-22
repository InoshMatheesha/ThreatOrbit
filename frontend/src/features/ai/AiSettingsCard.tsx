import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckIcon, ExternalIcon, KeyIcon, SparklesIcon, TrashIcon } from '../../components/icons';
import { ErrorBanner, Notice, Segmented, Skeleton, Spinner } from '../../components/ui';
import { api, type AiProviderId, type AiSettings, type AiStatus } from '../../lib/api';
import { relativeTime } from '../../lib/format';

const PROVIDER_LABELS: Record<AiProviderId, string> = { gemini: 'Google Gemini', anthropic: 'Anthropic Claude' };

/** Read-only for analysts; administrators paste and manage the AI key here. */
export function AiSettingsCard({ isAdmin, status }: { isAdmin: boolean; status?: AiStatus }) {
  if (!isAdmin) {
    const on = status?.enabled;
    return (
      <section className="card flex flex-wrap items-center justify-between gap-4 p-5 text-[13px]">
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <SparklesIcon size={20} />
          </span>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">Plain-English explanations</div>
            <p className="mt-0.5 max-w-xl text-muted">
              {on ? `Written by ${status?.providerName} (${status?.model}).` : 'Off. An administrator can switch them on here.'}
            </p>
          </div>
        </div>
        <span className={`badge ${on ? 'bg-low-soft text-low' : 'bg-unknown-soft text-unknown'}`}>{on ? 'On' : 'Off'}</span>
      </section>
    );
  }
  return <AdminAiSettings dailyLimit={status?.dailyLimit} />;
}

function AdminAiSettings({ dailyLimit }: { dailyLimit?: number | undefined }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [provider, setProvider] = useState<AiProviderId>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const apply = useCallback(async (s: AiSettings) => {
    setSettings(s);
    if (s.provider) setProvider(s.provider);
    setModel(s.model ?? '');
    setApiKey('');
    if (s.configured) {
      api
        .getAiModels()
        .then(setModels)
        .catch(() => setModels([]));
    } else {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    api
      .getAiSettings()
      .then(apply)
      .catch((e: Error) => setError(e.message));
  }, [apply]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setSaved(null);
    try {
      const sameProvider = settings?.provider === provider;
      const next = await api.saveAiSettings({
        provider,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(sameProvider && model ? { model } : {}),
      });
      await apply(next);
      setSaved(`${PROVIDER_LABELS[next.provider!]} accepted the key and will use ${next.model}.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm('Remove the AI key? Plain-English explanations will switch off until a new key is added.')) return;
    setBusy('remove');
    setError(null);
    setSaved(null);
    try {
      await apply(await api.removeAiSettings());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!settings) {
    return error ? <ErrorBanner>{error}</ErrorBanner> : <Skeleton className="h-64 w-full !rounded-2xl" />;
  }

  const info = settings.providers.find((p) => p.id === provider);
  const sameProvider = settings.provider === provider;
  const canSave = busy === null && (apiKey.trim().length > 0 || (sameProvider && settings.configured && model !== settings.model));

  return (
    <section className="card p-5 text-[13px] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <SparklesIcon size={20} />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight">Plain-English explanations</h2>
            <p className="mt-0.5 max-w-xl text-muted">
              An AI model explains results for people who are not security experts. Paste a key below to switch it on. Up to{' '}
              {dailyLimit ?? 100} new explanations a day for the team; saved ones are free.
            </p>
          </div>
        </div>
        <span className={`badge ${settings.configured ? 'bg-low-soft text-low' : 'bg-unknown-soft text-unknown'}`}>
          {settings.configured ? 'On' : 'Off'}
        </span>
      </div>

      {settings.configured && (
        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 rounded-xl bg-raised/70 p-4 ring-1 ring-line">
          <dt className="text-muted">Provider</dt>
          <dd className="font-medium">{PROVIDER_LABELS[settings.provider!]}</dd>
          <dt className="text-muted">Model</dt>
          <dd className="font-mono text-[12px]">{settings.model}</dd>
          <dt className="text-muted">Key</dt>
          <dd className="font-mono text-[12px]">{settings.keyHint}</dd>
          <dt className="text-muted">Stored in</dt>
          <dd>
            {settings.source === 'database'
              ? `the database${settings.updatedBy ? `, saved by ${settings.updatedBy} ${relativeTime(settings.updatedAt ?? undefined)}` : ''}`
              : 'a server environment variable'}
          </dd>
        </dl>
      )}

      <form onSubmit={save} className="mt-5 space-y-4">
        <div>
          <div className="mb-1.5 font-medium">Provider</div>
          <Segmented
            value={provider}
            label="AI provider"
            options={[
              { value: 'gemini' as const, label: 'Google Gemini (free tier)' },
              { value: 'anthropic' as const, label: 'Anthropic Claude (paid)' },
            ]}
            onChange={(v) => {
              setProvider(v);
              setModel(settings.provider === v ? (settings.model ?? '') : '');
              setError(null);
            }}
          />
        </div>

        <label className="block">
          <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2 font-medium">
            API key
            {info && (
              <a
                className="inline-flex items-center gap-1 text-[12px] font-medium text-brand underline-offset-2 hover:underline"
                href={info.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a key <ExternalIcon size={12} />
              </a>
            )}
          </span>
          <span className="relative block">
            <KeyIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              className="input w-full pl-9 font-mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                sameProvider && settings.configured ? `Saved (${settings.keyHint}). Paste a new key to replace it` : 'Paste your API key'
              }
            />
          </span>
        </label>

        {sameProvider && settings.configured && models.length > 0 && (
          <label className="block">
            <span className="mb-1.5 block font-medium">Model</span>
            <select className="input w-full sm:max-w-sm" value={model} onChange={(e) => setModel(e.target.value)}>
              {!models.some((m) => m.id === model) && model && <option value={model}>{model}</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-[12px] text-muted">Flash models are fast and the best fit for short explanations.</span>
          </label>
        )}

        {provider === 'gemini' && (
          <Notice tone="warn">
            On Google's free tier, the text you send may be used by Google to improve its products. ThreatOrbit sends only indicators and
            what the threat services said about them, never batch labels or names. Use a paid Gemini key if that is not acceptable.
          </Notice>
        )}
        {provider === 'anthropic' && <Notice>Claude has no free tier: usage is billed by Anthropic.</Notice>}

        {error && <ErrorBanner>{error}</ErrorBanner>}
        {saved && (
          <div className="flex items-start gap-2 text-low" role="status">
            <CheckIcon size={16} className="mt-0.5" /> {saved}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="submit" className="btn-primary" disabled={!canSave}>
            {busy === 'save' ? (
              <>
                <Spinner /> Checking key…
              </>
            ) : (
              'Save and check key'
            )}
          </button>
          {settings.source === 'database' && (
            <button type="button" className="btn-danger" disabled={busy !== null} onClick={remove}>
              {busy === 'remove' ? <Spinner /> : <TrashIcon size={15} />} Remove key
            </button>
          )}
        </div>
        <p className="text-[12px] text-muted">
          The key is checked with the provider before it is saved. It is stored on the server and is never shown again, only its last four
          characters.
        </p>
      </form>
    </section>
  );
}
