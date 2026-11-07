import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppConfig, ProviderId } from '../config/env.js';
import { keyHint, type SecretVault } from '../lib/crypto.js';
import { ApiError } from '../lib/errors.js';
import { ProviderKey, providerKeyContext, type ProviderKeyDoc } from '../models/ProviderKey.js';
import { ProviderUsage } from '../models/ProviderUsage.js';
import { ProviderPause } from '../models/Throttle.js';
import type { ProviderRegistry } from '../providers/registry.js';
import { ProviderError, type ProviderLimits } from '../providers/types.js';
import { audit } from './audit.js';
import type { Principal } from './authService.js';
import { keySubject, msUntilNextMinute, reserveMinuteSlot, reserveRequest, utcDay } from './providerUsage.js';

/** How long a process trusts its view of the key pool before re-reading it (other instances may change it). */
const POOL_TTL_MS = 15_000;
/** When every key is paused for longer than this, lookups fail as out of quota instead of waiting. */
const MAX_WAIT_FOR_KEY_MS = 10 * 60_000;

export type KeySource = 'database' | 'environment';

/** A usable key, decrypted, with its effective limits. Never leaves the server. */
export interface PoolKey {
  id: string;
  provider: ProviderId;
  source: KeySource;
  label: string;
  apiKey: string;
  requestsPerMinute: number;
  dailyLimit: number | null;
}

export type KeyGrant =
  | { kind: 'granted'; key: PoolKey }
  /** Every key used its requests for this minute. */
  | { kind: 'rate_limited'; retryInMs: number }
  /** Every key used its daily quota. */
  | { kind: 'quota_exhausted'; keys: number }
  | { kind: 'no_keys' };

export type KeyStatus = 'ok' | 'inactive' | 'rejected' | 'unreadable';

/** Administrator view of a key. Contains only the last four characters of the key itself. */
export interface PublicProviderKey {
  id: string;
  provider: ProviderId;
  source: KeySource;
  label: string;
  keyHint: string;
  active: boolean;
  status: KeyStatus;
  statusMessage: string | null;
  /** Stored overrides (null: provider default). Always null for the environment key, which uses <PROVIDER>_* variables. */
  requestsPerMinute: number | null;
  dailyLimit: number | null;
  effectiveLimits: { requestsPerMinute: number; dailyLimit: number | null };
  usedToday: number;
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface CreateKeyInput {
  provider: ProviderId;
  label: string;
  apiKey: string;
  requestsPerMinute?: number | null | undefined;
  dailyLimit?: number | null | undefined;
}

export interface UpdateKeyInput {
  label?: string | undefined;
  apiKey?: string | undefined;
  active?: boolean | undefined;
  requestsPerMinute?: number | null | undefined;
  dailyLimit?: number | null | undefined;
}

export const ENV_KEY_PREFIX = 'env:';

/**
 * Pool of API keys per provider: the server environment key plus any number of keys
 * administrators add from the app (stored encrypted).
 *
 * Lookups take a key with `acquire()`, which rotates through the pool and only hands out
 * a key that still has room in its own per-minute window and daily quota. Both counters
 * live in MongoDB, so the limits hold across processes and serverless instances. The
 * queue runs one worker per key, so N keys give roughly N times the throughput.
 */
export class ProviderKeyService {
  private cache = new Map<ProviderId, { at: number; keys: PoolKey[] }>();
  private cursor = new Map<ProviderId, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly registry: ProviderRegistry,
    private readonly vault: SecretVault,
  ) {}

  get encryptionAvailable(): boolean {
    return this.vault.available;
  }

  invalidate(provider?: ProviderId) {
    if (provider) this.cache.delete(provider);
    else this.cache.clear();
  }

  /** The stored key in plain text, or null when it cannot be decrypted. */
  private reveal(doc: Pick<ProviderKeyDoc, '_id' | 'encryptedKey' | 'iv' | 'tag'>): string | null {
    return this.vault.tryDecrypt({ ciphertext: doc.encryptedKey, iv: doc.iv, tag: doc.tag }, providerKeyContext(doc._id));
  }

  // ---------------------------------------------------------------- pool

  private defaults(provider: ProviderId): ProviderLimits {
    return this.registry.get(provider).adapter.defaultLimits;
  }

  private envKey(provider: ProviderId): PoolKey | null {
    const runtime = this.registry.get(provider);
    if (!runtime.apiKey) return null;
    return {
      id: `${ENV_KEY_PREFIX}${provider}`,
      provider,
      source: 'environment',
      label: 'Server environment',
      apiKey: runtime.apiKey,
      requestsPerMinute: runtime.baseLimits.requestsPerMinute,
      dailyLimit: runtime.baseLimits.dailyLimit,
    };
  }

  /** Usable keys for a provider: active, not rejected, and decryptable. */
  async pool(provider: ProviderId): Promise<PoolKey[]> {
    const hit = this.cache.get(provider);
    if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.keys;

    const keys: PoolKey[] = [];
    const env = this.envKey(provider);
    if (env) keys.push(env);

    const defaults = this.defaults(provider);
    try {
      const docs = await ProviderKey.find({ provider, active: true, rejectedAt: null }).sort({ createdAt: 1 }).lean();
      for (const doc of docs) {
        const apiKey = this.reveal(doc);
        if (apiKey === null) {
          this.logger.warn({ provider, keyId: doc._id }, 'Stored API key cannot be decrypted (was ENCRYPTION_KEY changed?); skipping it');
          continue;
        }
        if (env && apiKey === env.apiKey) continue; // same key twice would double its limits
        keys.push({
          id: doc._id,
          provider,
          source: 'database',
          label: doc.label,
          apiKey,
          requestsPerMinute: doc.requestsPerMinute ?? defaults.requestsPerMinute,
          dailyLimit: doc.dailyLimit ?? defaults.dailyLimit,
        });
      }
    } catch (err) {
      this.logger.warn({ provider, err: (err as Error).message }, 'Could not read stored API keys; using the environment key only');
    }

    this.cache.set(provider, { at: Date.now(), keys });
    return keys;
  }

  /** Number of usable keys and their combined limits (what the queue may run at). */
  async summary(provider: ProviderId): Promise<{ keyCount: number; limits: ProviderLimits }> {
    const keys = await this.pool(provider);
    const perKeyConcurrency = Math.max(1, this.defaults(provider).concurrency);
    return {
      keyCount: keys.length,
      limits: {
        requestsPerMinute: keys.reduce((sum, k) => sum + k.requestsPerMinute, 0),
        dailyLimit: keys.some((k) => k.dailyLimit === null) ? null : keys.reduce((sum, k) => sum + (k.dailyLimit ?? 0), 0),
        concurrency: perKeyConcurrency * Math.max(1, keys.length),
      },
    };
  }

  /**
   * Reserve one request on the next key in rotation that is not paused and has room this
   * minute and today. A granted request is already counted: make exactly one provider request.
   */
  async acquire(provider: ProviderId): Promise<KeyGrant> {
    const keys = await this.pool(provider);
    if (keys.length === 0) return { kind: 'no_keys' };

    const now = Date.now();
    const pauses = await ProviderPause.find({
      provider: { $in: keys.map((k) => keySubject(k.id)) },
      pausedUntil: { $gt: new Date(now) },
    }).lean();
    const pausedUntil = new Map(pauses.map((p) => [p.provider, p.pausedUntil.getTime()]));

    const start = (this.cursor.get(provider) ?? 0) % keys.length;
    this.cursor.set(provider, start + 1);
    let soonest = Infinity;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[(start + i) % keys.length]!;
      const subject = keySubject(key.id);
      const paused = pausedUntil.get(subject);
      if (paused !== undefined) {
        soonest = Math.min(soonest, paused - now);
        continue;
      }
      // Minute window first: a slot wasted on a key that turns out to be out of quota costs nothing.
      if (!(await reserveMinuteSlot(subject, key.requestsPerMinute))) {
        soonest = Math.min(soonest, msUntilNextMinute(now));
        continue;
      }
      if (!(await reserveRequest(subject, key.dailyLimit))) continue;
      await reserveRequest(provider, null); // provider-wide count shown on the Sources page
      return { kind: 'granted', key };
    }
    return soonest <= MAX_WAIT_FOR_KEY_MS
      ? { kind: 'rate_limited', retryInMs: Math.max(0, soonest) + 250 }
      : { kind: 'quota_exhausted', keys: keys.length };
  }

  /** Hold one key back (it hit its rate limit or quota) while the rest of the pool keeps working. */
  async pauseKey(key: PoolKey, ms: number) {
    await ProviderPause.updateOne({ provider: keySubject(key.id) }, { $max: { pausedUntil: new Date(Date.now() + ms) } }, { upsert: true });
  }

  /**
   * The provider refused a key (HTTP 401/403). A stored key is taken out of rotation until an
   * administrator replaces it or a test passes; the environment key is held back for a while.
   */
  async markRejected(key: PoolKey, reason: string) {
    if (key.source === 'database') {
      await ProviderKey.updateOne({ _id: key.id }, { $set: { rejectedAt: new Date(), rejectedReason: reason.slice(0, 300) } });
      this.invalidate(key.provider);
    } else {
      await this.pauseKey(key, 5 * 60_000);
    }
    this.logger.warn({ provider: key.provider, keyId: key.id }, 'Provider rejected an API key; it was taken out of rotation');
  }

  // ---------------------------------------------------------------- administration

  private async usageToday(): Promise<Map<string, number>> {
    const docs = await ProviderUsage.find({ day: utcDay(), provider: { $regex: /^key:/ } }).lean();
    return new Map(docs.map((d) => [d.provider, d.count]));
  }

  private toPublic(doc: ProviderKeyDoc, usage: Map<string, number>): PublicProviderKey {
    const defaults = this.defaults(doc.provider);
    let status: KeyStatus = 'ok';
    let statusMessage: string | null = null;
    if (this.reveal(doc) === null) {
      status = 'unreadable';
      statusMessage = this.vault.available
        ? 'Cannot be decrypted with the current ENCRYPTION_KEY. Paste the key again.'
        : 'ENCRYPTION_KEY is not set on the server.';
    } else if (doc.rejectedAt) {
      status = 'rejected';
      statusMessage = doc.rejectedReason ?? 'The provider rejected this key.';
    } else if (!doc.active) {
      status = 'inactive';
    }
    return {
      id: doc._id,
      provider: doc.provider,
      source: 'database',
      label: doc.label,
      keyHint: doc.keyHint,
      active: doc.active,
      status,
      statusMessage,
      requestsPerMinute: doc.requestsPerMinute ?? null,
      dailyLimit: doc.dailyLimit ?? null,
      effectiveLimits: {
        requestsPerMinute: doc.requestsPerMinute ?? defaults.requestsPerMinute,
        dailyLimit: doc.dailyLimit ?? defaults.dailyLimit,
      },
      usedToday: usage.get(keySubject(doc._id)) ?? 0,
      createdBy: doc.createdBy ?? null,
      updatedBy: doc.updatedBy?.id ? doc.updatedBy : null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /** Every key, including the read-only environment keys, without revealing any of them. */
  async list(): Promise<PublicProviderKey[]> {
    const usage = await this.usageToday();
    const env: PublicProviderKey[] = this.registry
      .all()
      .map((r) => this.envKey(r.adapter.id))
      .filter((k): k is PoolKey => k !== null)
      .map((k) => ({
        id: k.id,
        provider: k.provider,
        source: 'environment',
        label: k.label,
        keyHint: keyHint(k.apiKey),
        active: true,
        status: 'ok',
        statusMessage: null,
        requestsPerMinute: null,
        dailyLimit: null,
        effectiveLimits: { requestsPerMinute: k.requestsPerMinute, dailyLimit: k.dailyLimit },
        usedToday: usage.get(keySubject(k.id)) ?? 0,
        createdBy: null,
        updatedBy: null,
        createdAt: null,
        updatedAt: null,
      }));
    const known = new Set(this.registry.all().map((r) => r.adapter.id));
    const docs = await ProviderKey.find({ provider: { $in: [...known] } })
      .sort({ provider: 1, createdAt: 1 })
      .lean();
    return [...env, ...docs.map((d) => this.toPublic(d, usage))];
  }

  private async requireDoc(id: string) {
    if (id.startsWith(ENV_KEY_PREFIX)) {
      throw new ApiError(409, 'CONFLICT', 'This key comes from the server environment. Change it there and redeploy.');
    }
    const doc = await ProviderKey.findById(id);
    if (!doc || !this.registry.all().some((r) => r.adapter.id === doc.provider)) throw new ApiError(404, 'NOT_FOUND', 'API key not found');
    return doc;
  }

  private async assertUnique(provider: ProviderId, apiKey: string, exceptId?: string) {
    if (this.envKey(provider)?.apiKey === apiKey) {
      throw new ApiError(409, 'CONFLICT', 'This key is already configured in the server environment.');
    }
    const others = await ProviderKey.find({ provider, keyHint: keyHint(apiKey), ...(exceptId ? { _id: { $ne: exceptId } } : {}) }).lean();
    if (others.some((d) => this.reveal(d) === apiKey)) {
      throw new ApiError(409, 'CONFLICT', 'This key has already been added.');
    }
  }

  async create(input: CreateKeyInput, actor: Principal): Promise<PublicProviderKey> {
    if (!this.registry.all().some((r) => r.adapter.id === input.provider)) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Unknown provider ${input.provider}`);
    }
    const apiKey = input.apiKey.trim();
    await this.assertUnique(input.provider, apiKey);
    const id = randomUUID();
    const sealed = this.vault.encrypt(apiKey, providerKeyContext(id));
    const doc = await ProviderKey.create({
      _id: id,
      provider: input.provider,
      label: input.label.trim(),
      encryptedKey: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
      keyHint: keyHint(apiKey),
      active: true,
      requestsPerMinute: input.requestsPerMinute ?? null,
      dailyLimit: input.dailyLimit ?? null,
      createdBy: { id: actor.id, name: actor.name },
    });
    this.invalidate(input.provider);
    await audit(this.logger, 'provider_key.create', actor, undefined, { provider: input.provider, keyId: id, label: doc.label });
    return this.toPublic(doc.toObject<ProviderKeyDoc>(), await this.usageToday());
  }

  async update(id: string, input: UpdateKeyInput, actor: Principal): Promise<PublicProviderKey> {
    const doc = await this.requireDoc(id);
    const changed: string[] = [];
    if (input.label !== undefined) {
      doc.label = input.label.trim();
      changed.push('label');
    }
    if (input.active !== undefined) {
      doc.active = input.active;
      changed.push('active');
    }
    if (input.requestsPerMinute !== undefined) {
      doc.requestsPerMinute = input.requestsPerMinute;
      changed.push('requestsPerMinute');
    }
    if (input.dailyLimit !== undefined) {
      doc.dailyLimit = input.dailyLimit;
      changed.push('dailyLimit');
    }
    if (input.apiKey !== undefined) {
      const apiKey = input.apiKey.trim();
      await this.assertUnique(doc.provider, apiKey, doc._id);
      const sealed = this.vault.encrypt(apiKey, providerKeyContext(doc._id));
      doc.encryptedKey = sealed.ciphertext;
      doc.iv = sealed.iv;
      doc.tag = sealed.tag;
      doc.keyHint = keyHint(apiKey);
      changed.push('apiKey');
    }
    // A replaced key, or an administrator re-enabling it, gets another chance.
    if (input.apiKey !== undefined || input.active === true) {
      doc.rejectedAt = null;
      doc.rejectedReason = null;
    }
    doc.updatedBy = { id: actor.id, name: actor.name };
    await doc.save();
    if (input.apiKey !== undefined) await ProviderPause.deleteOne({ provider: keySubject(doc._id) });
    this.invalidate(doc.provider);
    await audit(this.logger, 'provider_key.update', actor, undefined, {
      provider: doc.provider,
      keyId: doc._id,
      changed: changed.join(',') || 'none',
      active: doc.active,
    });
    return this.toPublic(doc.toObject<ProviderKeyDoc>(), await this.usageToday());
  }

  async remove(id: string, actor: Principal) {
    const doc = await this.requireDoc(id);
    await ProviderKey.deleteOne({ _id: doc._id });
    await ProviderPause.deleteOne({ provider: keySubject(doc._id) });
    this.invalidate(doc.provider);
    await audit(this.logger, 'provider_key.delete', actor, undefined, { provider: doc.provider, keyId: doc._id, label: doc.label });
  }

  /** One real request with the provider's harmless probe indicator, counted against this key's limits. */
  async test(id: string, actor: Principal): Promise<{ ok: boolean; message: string; kind?: string; ms?: number }> {
    let key: PoolKey;
    if (id.startsWith(ENV_KEY_PREFIX)) {
      const env = this.registry.all().find((r) => `${ENV_KEY_PREFIX}${r.adapter.id}` === id);
      const k = env ? this.envKey(env.adapter.id) : null;
      if (!k) throw new ApiError(404, 'NOT_FOUND', 'API key not found');
      key = k;
    } else {
      const doc = await this.requireDoc(id);
      const apiKey = this.reveal(doc);
      if (apiKey === null) return { ok: false, kind: 'unreadable', message: 'This key cannot be decrypted. Paste it again.' };
      const defaults = this.defaults(doc.provider);
      key = {
        id: doc._id,
        provider: doc.provider,
        source: 'database',
        label: doc.label,
        apiKey,
        requestsPerMinute: doc.requestsPerMinute ?? defaults.requestsPerMinute,
        dailyLimit: doc.dailyLimit ?? defaults.dailyLimit,
      };
    }

    if (!(await reserveMinuteSlot(keySubject(key.id), key.requestsPerMinute))) {
      return {
        ok: false,
        kind: 'rate_limited',
        message: `This key used its ${key.requestsPerMinute} requests for this minute. Try again shortly.`,
      };
    }
    if (!(await reserveRequest(keySubject(key.id), key.dailyLimit))) {
      return { ok: false, kind: 'quota_exhausted', message: 'This key used its daily quota. It resets at 00:00 UTC.' };
    }
    await reserveRequest(key.provider, null);

    const runtime = this.registry.get(key.provider);
    const started = Date.now();
    try {
      const finding = await runtime.adapter.lookup(runtime.adapter.probe, { apiKey: key.apiKey, http: runtime.http });
      // A key that works again goes back into rotation.
      if (key.source === 'database') await ProviderKey.updateOne({ _id: key.id }, { $set: { rejectedAt: null, rejectedReason: null } });
      await ProviderPause.deleteOne({ provider: keySubject(key.id) });
      this.invalidate(key.provider);
      await audit(this.logger, 'provider_key.test', actor, undefined, { provider: key.provider, keyId: key.id, ok: true });
      return {
        ok: true,
        message: `Key works. Test lookup of ${runtime.adapter.probe.value}: ${finding.summary}`,
        ms: Date.now() - started,
      };
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError('provider_error', (err as Error).message);
      if (e.kind === 'auth') await this.markRejected(key, e.message);
      await audit(this.logger, 'provider_key.test', actor, undefined, { provider: key.provider, keyId: key.id, ok: false, kind: e.kind });
      return { ok: false, kind: e.kind, message: e.message, ms: Date.now() - started };
    }
  }
}
