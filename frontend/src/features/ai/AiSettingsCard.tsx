import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckIcon, ExternalIcon, KeyIcon, PencilIcon, SparklesIcon, TrashIcon } from '../../components/icons';
import { ErrorBanner, Notice, Skeleton, Spinner } from '../../components/ui';
import { api, type AiProviderId, type AiSettings, type AiStatus } from '../../lib/api';
import { relativeTime } from '../../lib/format';

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI (ChatGPT)',
  anthropic: 'Anthropic Claude',
  openrouter: 'OpenRouter',
  kimi: 'Kimi (Moonshot AI)',
  custom: 'Custom / OpenAI API',
};

const DEFAULT_MODELS: Record<AiProviderId, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  openrouter: 'openai/gpt-4o-mini',
  kimi: 'moonshot-v1-8k',
  custom: 'default',
};

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
  const [baseUrl, setBaseUrl] = useState('');
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const apply = useCallback(async (s: AiSettings) => {
    setSettings(s);
    if (s.provider) setProvider(s.provider);
    setModel(s.model ?? '');
    setBaseUrl(s.baseUrl ?? '');
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
        ...(model.trim() ? { model: model.trim() } : sameProvider && settings?.model ? { model: settings.model } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
      });
      await apply(next);
      setSaved(`${PROVIDER_LABELS[next.provider!]} accepted the key and will use ${next.model}.`);
      setEditing(false);
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
      setEditing(false);
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
  const canSave =
    busy === null &&
    (apiKey.trim().length > 0 || (sameProvider && settings.configured && (model !== settings.model || baseUrl !== (settings.baseUrl ?? ''))));
  const showForm = !settings.configured || editing;

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundImage: 'linear-gradient(135deg, var(--c-brand), var(--c-accent))' }}
      >
        <SparklesIcon size={22} />
      </span>
      <div className="min-w-0 flex-1 basis-[13rem]">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[16px] font-semibold tracking-tight">Plain-English explanations</h2>
          <span className={`badge ${settings.configured ? 'bg-low-soft text-low' : 'bg-unknown-soft text-unknown'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${settings.configured ? 'bg-low' : 'bg-unknown'}`} aria-hidden />
            {settings.configured ? 'On' : 'Off'}
          </span>
        </div>
        {!showForm && settings.configured && (
          <p className="mt-0.5 text-muted">
            Saved {settings.source === 'database' && settings.updatedBy ? `by ${settings.updatedBy} ` : ''}
            {settings.updatedAt ? relativeTime(settings.updatedAt) : ''}. Up to {dailyLimit ?? 100} new explanations a day; saved ones are
            free.
          </p>
        )}
      </div>
      {!showForm && (
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            <PencilIcon size={15} /> Edit
          </button>
          {settings.source === 'database' && (
            <button
              type="button"
              className="btn-ghost !text-high hover:!bg-high-soft"
              disabled={busy !== null}
              onClick={remove}
              aria-label="Remove key"
            >
              {busy === 'remove' ? <Spinner /> : <TrashIcon size={15} />} Remove
            </button>
          )}
        </div>
      )}
    </div>
  );

  // Connected: a compact summary instead of the setup form.
  if (!showForm && settings.configured) {
    return (
      <section className="card p-5 text-[13px]">
        {header}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Fact label="Provider" value={PROVIDER_LABELS[settings.provider!] ?? settings.provider} />
          <Fact label="Model" value={settings.model ?? ''} mono />
          <Fact
            label="Key"
            value={settings.keyHint ?? ''}
            mono
            sub={settings.source === 'database' ? 'Stored in the database' : 'Server environment variable'}
          />
        </div>
        {settings.baseUrl && (
          <div className="mt-3 text-[12px] text-muted">
            Custom Base URL: <code className="font-mono">{settings.baseUrl}</code>
          </div>
        )}
        {saved && (
          <div className="mt-4 flex items-start gap-2 text-low" role="status">
            <CheckIcon size={16} className="mt-0.5" /> {saved}
          </div>
        )}
        {error && (
          <div className="mt-4">
            <ErrorBanner>{error}</ErrorBanner>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card p-5 text-[13px] sm:p-6">
      {header}
      {!settings.configured && (
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ['1', 'Pick a provider', 'Gemini, OpenAI, Claude, OpenRouter, Kimi or custom API.'],
            ['2', 'Paste your key', 'We check it with the provider first.'],
            ['3', 'Done', 'Explain buttons appear on every batch.'],
          ].map(([n, title, text]) => (
            <li key={n} className="flex gap-3 rounded-xl bg-raised/70 p-3.5 ring-1 ring-line">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[12px] font-semibold text-brand">
                {n}
              </span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-muted">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={save} className="mt-5 space-y-4">
        <div>
          <div className="mb-2 font-medium">Select AI Provider</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {settings.providers.map((p) => {
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProvider(p.id);
                    setModel(settings.provider === p.id ? (settings.model ?? '') : (p.defaultModel || DEFAULT_MODELS[p.id] || ''));
                    setBaseUrl(settings.provider === p.id ? (settings.baseUrl ?? '') : (p.defaultBaseUrl ?? ''));
                    setError(null);
                  }}
                  className={`rounded-xl p-3 text-left transition ring-1 ${
                    active
                      ? 'bg-brand/10 text-ink ring-brand'
                      : 'bg-raised/60 text-muted ring-line hover:bg-raised hover:text-ink'
                  }`}
                >
                  <div className="font-semibold text-[13px]">{p.name}</div>
                  <div className="mt-0.5 text-[11px] opacity-75">{p.defaultModel}</div>
                </button>
              );
            })}
          </div>
        </div>

        {(info?.requiresBaseUrl || provider === 'custom' || provider === 'openrouter' || baseUrl) && (
          <label className="block">
            <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2 font-medium">
              API Base URL
              <span className="text-[11px] font-normal text-muted">
                {provider === 'openrouter'
                  ? 'https://openrouter.ai/api/v1'
                  : provider === 'kimi'
                    ? 'https://api.moonshot.cn/v1'
                    : 'e.g. https://api.openai.com/v1'}
              </span>
            </span>
            <input
              className="input w-full font-mono text-[13px]"
              type="text"
              placeholder={info?.defaultBaseUrl ?? 'https://api.openai.com/v1'}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 flex flex-wrap items-center justify-between gap-2 font-medium">
            API key
            {info?.signupUrl && (
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
                sameProvider && settings.configured ? `Saved (${settings.keyHint}). Leave empty to keep it` : 'Paste your API key'
              }
            />
          </span>
        </label>

        <label className="block">
          <span className="mb-1.5 block font-medium">Model</span>
          {models.length > 0 ? (
            <div className="space-y-2">
              <select className="input w-full sm:max-w-sm" value={model} onChange={(e) => setModel(e.target.value)}>
                {!models.some((m) => m.id === model) && model && <option value={model}>{model} (custom)</option>}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 text-[12px] text-muted">
                <span>Or type custom model name:</span>
                <input
                  className="input !py-1 !text-[12px] font-mono sm:max-w-xs"
                  placeholder="e.g. gpt-4o, claude-3-7-sonnet"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <input
              className="input w-full font-mono text-[13px] sm:max-w-sm"
              placeholder={info?.defaultModel || 'Model name'}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          )}
          <span className="mt-1.5 block text-[12px] text-muted">
            Fast models (Flash, GPT-4o-mini, Claude 3.5 Sonnet, Moonshot-8k) work best for fast triage summaries.
          </span>
        </label>

        {provider === 'gemini' && (
          <Notice tone="warn">
            On Google's free tier, the text you send may be used by Google to improve its products. ThreatOrbit sends only indicators and
            what the threat services said about them, never batch labels or names.
          </Notice>
        )}
        {provider === 'openrouter' && (
          <Notice>
            OpenRouter lets you query OpenAI, Anthropic, DeepSeek, Google, and Meta models with a single unified API key.
          </Notice>
        )}
        {provider === 'kimi' && (
          <Notice>
            Kimi (Moonshot AI) uses Chinese-optimized large language models with long context support via an OpenAI-compatible API.
          </Notice>
        )}
        {provider === 'custom' && (
          <Notice>
            Connect to any self-hosted or cloud OpenAI-compatible server (DeepSeek, Groq, Local Ollama, vLLM, LM Studio).
          </Notice>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}

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
          {settings.configured && (
            <button
              type="button"
              className="btn"
              disabled={busy !== null}
              onClick={() => {
                setEditing(false);
                setError(null);
                setApiKey('');
                setProvider(settings.provider ?? 'gemini');
                setModel(settings.model ?? '');
                setBaseUrl(settings.baseUrl ?? '');
              }}
            >
              Cancel
            </button>
          )}
        </div>
        <p className="text-[12px] text-muted">
          The key is verified with the provider before it is saved. It is stored securely on the server and never shown again.
        </p>
      </form>
    </section>
  );
}

function Fact({ label, value, mono = false, sub }: { label: string; value: string; mono?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl bg-raised/70 px-4 py-3 ring-1 ring-line">
      <div className="text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{label}</div>
      <div className={`mt-1 truncate font-medium ${mono ? 'font-mono text-[12.5px]' : 'text-[14px]'}`} title={value}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
