import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckIcon, KeyIcon, PencilIcon, PlusIcon, TrashIcon, XIcon } from '../../components/icons';
import { ActiveKeys, Empty, ErrorBanner, Notice, Skeleton, Spinner } from '../../components/ui';
import { api, type ProviderId, type ProviderInfo, type ProviderKey, type ProviderKeyStatus } from '../../lib/api';
import { relativeTime } from '../../lib/format';

const STATUS: Record<ProviderKeyStatus, { label: string; className: string }> = {
  ok: { label: 'In rotation', className: 'bg-low-soft text-low' },
  inactive: { label: 'Paused', className: 'bg-unknown-soft text-unknown' },
  rejected: { label: 'Rejected', className: 'bg-high-soft text-high' },
  unreadable: { label: 'Unreadable', className: 'bg-high-soft text-high' },
};

/** Empty input means "use the provider default". */
function parseLimit(value: string): number | null | 'invalid' {
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : 'invalid';
}

interface Props {
  providers: ProviderInfo[];
  /** Called after any change so provider cards can show the new state and limits. */
  onChange: () => void;
}

/**
 * Administrator-only: the pool of API keys per provider. Lookups rotate across every key in
 * rotation and run one in parallel per key. Keys are stored encrypted and never shown again.
 */
export function ProviderKeysCard({ providers, onChange }: Props) {
  const [keys, setKeys] = useState<ProviderKey[] | null>(null);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.providerKeys();
      setKeys(r.data);
      setEncryptionAvailable(r.meta.encryptionAvailable);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = useCallback(async () => {
    await load();
    onChange();
  }, [load, onChange]);

  if (keys === null) return error ? <ErrorBanner>{error}</ErrorBanner> : <Skeleton className="h-48 w-full !rounded-2xl" />;

  const names = new Map(providers.map((p) => [p.id, p.name]));
  const byProvider = providers
    .map((p) => ({ provider: p, keys: keys.filter((k) => k.provider === p.id) }))
    .filter((g) => g.keys.length > 0);

  return (
    <section className="card overflow-hidden text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <p className="max-w-2xl text-muted">
          Add several keys per source to look up large batches faster: lookups rotate across every key in rotation, run in parallel (one
          worker per key), and each key keeps to its own per-minute and daily limits. Keys are encrypted before they are stored and are
          never shown again.
        </p>
        {!adding && (
          <button type="button" className="btn-primary" onClick={() => setAdding(true)} disabled={!encryptionAvailable}>
            <PlusIcon size={15} /> Add key
          </button>
        )}
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        {!encryptionAvailable && (
          <Notice tone="warn">
            The server has no <code className="font-mono text-[12px]">ENCRYPTION_KEY</code>, so API keys cannot be stored. Set it to at
            least 32 random characters (for example the output of <code className="font-mono text-[12px]">openssl rand -base64 48</code>)
            and restart or redeploy.
          </Notice>
        )}
        {error && <ErrorBanner>{error}</ErrorBanner>}

        {adding && (
          <AddKeyForm
            providers={providers}
            onCancel={() => setAdding(false)}
            onAdded={async () => {
              setAdding(false);
              await changed();
            }}
          />
        )}

        {byProvider.length === 0 && !adding ? (
          <Empty icon={<KeyIcon size={28} />}>No API keys yet. Add one to switch a source on.</Empty>
        ) : (
          byProvider.map(({ provider, keys: list }) => (
            <div key={provider.id}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{names.get(provider.id)}</span>
                <span className="flex items-center gap-2 text-[12px] text-muted tabular-nums">
                  <ActiveKeys count={list.filter((k) => k.status === 'ok').length} showLabel={false} />
                  {list.filter((k) => k.status === 'ok').length} in rotation · {provider.limits.requestsPerMinute}/min combined
                </span>
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {list.map((k) => (
                  <KeyRow key={k.id} k={k} onChanged={changed} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AddKeyForm({ providers, onCancel, onAdded }: { providers: ProviderInfo[]; onCancel: () => void; onAdded: () => Promise<void> }) {
  const choices = providers.filter((p) => p.state !== 'disabled' && p.credentialEnv !== null);
  const [provider, setProvider] = useState<ProviderId>(choices[0]?.id ?? 'virustotal');
  const [label, setLabel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [rpm, setRpm] = useState('');
  const [daily, setDaily] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = providers.find((p) => p.id === provider);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const requestsPerMinute = parseLimit(rpm);
    const dailyLimit = parseLimit(daily);
    if (requestsPerMinute === 'invalid' || dailyLimit === 'invalid') {
      setError('Limits must be whole numbers of at least 1, or empty for the default.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addProviderKey({ provider, label: label.trim(), apiKey: apiKey.trim(), requestsPerMinute, dailyLimit });
      await onAdded();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl bg-raised/60 p-4 ring-1 ring-line">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block font-medium">Source</span>
          <select className="input w-full" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block font-medium">Name</span>
          <input
            className="input w-full"
            value={label}
            maxLength={120}
            required
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. SOC shared key 2"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block font-medium">API key</span>
        <span className="relative block">
          <KeyIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            className="input w-full pl-9 font-mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={`Paste the ${info?.name ?? ''} API key`}
          />
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <LimitInput label="Requests per minute" value={rpm} onChange={setRpm} placeholder="Default for the free tier" />
        <LimitInput label="Requests per day" value={daily} onChange={setDaily} placeholder="Default for the free tier" />
      </div>
      <p className="text-[12px] text-muted">Leave the limits empty for a free-tier key; raise them only for a paid plan.</p>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy || !label.trim() || !apiKey.trim()}>
          {busy ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            'Save key'
          )}
        </button>
      </div>
    </form>
  );
}

function LimitInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-medium">{label}</span>
      <input
        className="input w-full tabular-nums"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder={placeholder}
      />
    </label>
  );
}

function KeyRow({ k, onChanged }: { k: ProviderKey; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'test' | 'toggle' | 'delete' | 'save' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [label, setLabel] = useState(k.label);
  const [apiKey, setApiKey] = useState('');
  const [rpm, setRpm] = useState(k.requestsPerMinute?.toString() ?? '');
  const [daily, setDaily] = useState(k.dailyLimit?.toString() ?? '');
  const env = k.source === 'environment';
  const status = STATUS[k.status];
  const { requestsPerMinute, dailyLimit } = k.effectiveLimits;

  async function run(name: NonNullable<typeof busy>, fn: () => Promise<unknown>, after = true) {
    setBusy(name);
    setResult(null);
    try {
      await fn();
      if (after) await onChanged();
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const r = parseLimit(rpm);
    const d = parseLimit(daily);
    if (r === 'invalid' || d === 'invalid') {
      setResult({ ok: false, message: 'Limits must be whole numbers of at least 1, or empty for the default.' });
      return;
    }
    await run('save', async () => {
      await api.updateProviderKey(k.id, {
        ...(label.trim() !== k.label ? { label: label.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(r !== k.requestsPerMinute ? { requestsPerMinute: r } : {}),
        ...(d !== k.dailyLimit ? { dailyLimit: d } : {}),
      });
      setEditing(false);
      setApiKey('');
    });
  }

  if (editing) {
    return (
      <li className="bg-raised/40 px-3.5 py-3">
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block font-medium">Name</span>
              <input className="input w-full" value={label} maxLength={120} required onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block font-medium">Replace key</span>
              <input
                className="input w-full font-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={`Saved (${k.keyHint}). Leave empty to keep it`}
              />
            </label>
            <LimitInput
              label="Requests per minute"
              value={rpm}
              onChange={setRpm}
              placeholder={k.requestsPerMinute === null ? `Default (${requestsPerMinute})` : 'Default'}
            />
            <LimitInput
              label="Requests per day"
              value={daily}
              onChange={setDaily}
              placeholder={k.dailyLimit === null && dailyLimit !== null ? `Default (${dailyLimit})` : 'Default'}
            />
          </div>
          {result && !result.ok && <ErrorBanner>{result.message}</ErrorBanner>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn" onClick={() => setEditing(false)} disabled={busy !== null}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy !== null || !label.trim()}>
              {busy === 'save' ? <Spinner /> : <CheckIcon size={15} />} Save
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="bg-raised/40 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{k.label}</span>
            <code className="font-mono text-[12px] text-muted">{k.keyHint}</code>
            <span className={`badge ${status.className}`}>
              {k.status === 'ok' && <span className="h-1.5 w-1.5 rounded-full bg-low animate-key-pulse" aria-hidden />}
              {status.label}
            </span>
            {env && <span className="badge bg-unknown-soft text-unknown">Environment</span>}
          </div>
          <div className="mt-0.5 text-[12px] text-muted tabular-nums">
            {requestsPerMinute}/min ·{' '}
            {dailyLimit === null ? `${k.usedToday} used today` : `${k.usedToday} / ${dailyLimit.toLocaleString()} today`}
            {env
              ? ' · set by a server environment variable'
              : k.updatedBy && k.updatedAt
                ? ` · changed by ${k.updatedBy.name} ${relativeTime(k.updatedAt)}`
                : k.createdBy && k.createdAt
                  ? ` · added by ${k.createdBy.name} ${relativeTime(k.createdAt)}`
                  : ''}
          </div>
          {k.statusMessage && <div className="mt-1 text-[12px] text-high">{k.statusMessage}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className="btn !px-2.5 !py-1 !text-[12px]"
            disabled={busy !== null || k.status === 'unreadable'}
            onClick={() =>
              run(
                'test',
                async () => {
                  const r = await api.testProviderKey(k.id);
                  setResult(r);
                  await onChanged();
                },
                false,
              )
            }
          >
            {busy === 'test' ? <Spinner /> : null} Test
          </button>
          {!env && (
            <>
              <button
                type="button"
                className="btn !px-2.5 !py-1 !text-[12px]"
                disabled={busy !== null}
                onClick={() => run('toggle', () => api.updateProviderKey(k.id, { active: !k.active }))}
              >
                {busy === 'toggle' ? <Spinner /> : null} {k.active ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 !text-[12px]"
                disabled={busy !== null}
                onClick={() => setEditing(true)}
                aria-label={`Edit ${k.label}`}
              >
                <PencilIcon size={14} /> Edit
              </button>
              <button
                type="button"
                className="btn-ghost !px-2 !py-1 !text-[12px] !text-high hover:!bg-high-soft"
                disabled={busy !== null}
                aria-label={`Delete ${k.label}`}
                onClick={() => {
                  if (!confirm(`Delete the key "${k.label}"? Lookups stop using it immediately.`)) return;
                  void run('delete', () => api.deleteProviderKey(k.id));
                }}
              >
                {busy === 'delete' ? <Spinner /> : <TrashIcon size={14} />} Delete
              </button>
            </>
          )}
        </div>
      </div>
      {result && (
        <div className={`mt-2 flex items-start gap-1.5 text-[12px] ${result.ok ? 'text-low' : 'text-high'}`} role="status">
          {result.ok ? <CheckIcon size={14} className="mt-0.5" /> : <XIcon size={14} className="mt-0.5" />}
          <span className="break-words">{result.message}</span>
        </div>
      )}
    </li>
  );
}
