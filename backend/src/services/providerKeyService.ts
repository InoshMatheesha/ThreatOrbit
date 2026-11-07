import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppConfig, ProviderId } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { decryptApiKey, encryptApiKey } from '../lib/crypto.js';
import { ProviderKey, type ProviderKeyDoc } from '../models/ProviderKey.js';
import { createProviderHttp } from '../providers/http.js';
import type { ProviderAdapter, ProviderLimits } from '../providers/types.js';
import { audit } from './audit.js';
import type { Principal } from './authService.js';
import { reserveRequest } from './providerUsage.js';

export interface PublicProviderKey {
  id: string;
  provider: ProviderId;
  label: string;
  keyHint: string;
  active: boolean;
  requestsPerMinute: number | null;
  dailyLimit: number | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

export interface ActiveKeyEntry {
  id: string;
  apiKey: string;
  requestsPerMinute: number;
  dailyLimit: number | null;
  activeCount: number;
  lastUsedAt: number;
}

export class ProviderKeyService {
  private keyCache = new Map<ProviderId, ActiveKeyEntry[]>();
  private cacheExpiresAt = 0;
  private roundRobinIdx = new Map<ProviderId, number>();

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly adapters: readonly ProviderAdapter[],
  ) {}

  /** Invalidate the active key cache when keys are added, updated, or removed. */
  invalidateCache() {
    this.keyCache.clear();
    this.cacheExpiresAt = 0;
  }

  /**
   * List all stored keys without revealing raw secrets.
   */
  async listKeys(): Promise<PublicProviderKey[]> {
    const keys = await ProviderKey.find().sort({ createdAt: -1 }).lean();
    return keys.map((k) => ({
      id: k._id,
      provider: k.provider,
      label: k.label,
      keyHint: k.keyHint,
      active: k.active,
      requestsPerMinute: k.requestsPerMinute ?? null,
      dailyLimit: k.dailyLimit ?? null,
      createdBy: k.createdBy,
      createdAt: k.createdAt,
      updatedAt: k.updatedAt,
    }));
  }

  /**
   * Add a new encrypted API key for a provider.
   */
  async addKey(
    input: {
      provider: ProviderId;
      label: string;
      apiKey: string;
      requestsPerMinute?: number | null;
      dailyLimit?: number | null;
    },
    actor: Principal,
  ): Promise<PublicProviderKey> {
    const trimmedKey = input.apiKey.trim();
    if (!trimmedKey) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'API key cannot be empty');
    }

    const adapter = this.adapters.find((a) => a.id === input.provider);
    if (!adapter) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Unknown provider ${input.provider}`);
    }

    const encrypted = encryptApiKey(trimmedKey);
    const keyHint = trimmedKey.length > 4 ? `...${trimmedKey.slice(-4)}` : trimmedKey;

    const doc = await ProviderKey.create({
      _id: randomUUID(),
      provider: input.provider,
      label: input.label.trim() || `${adapter.name} Key`,
      encryptedKey: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      keyHint,
      active: true,
      requestsPerMinute: input.requestsPerMinute ?? adapter.defaultLimits.requestsPerMinute,
      dailyLimit: input.dailyLimit ?? adapter.defaultLimits.dailyLimit,
      createdBy: { id: actor.id, name: actor.name },
    });

    this.invalidateCache();
    await audit(this.logger, 'provider_key.create', actor, undefined, {
      provider: input.provider,
      keyId: doc._id,
      label: doc.label,
    });

    return {
      id: doc._id,
      provider: doc.provider,
      label: doc.label,
      keyHint: doc.keyHint,
      active: doc.active,
      requestsPerMinute: doc.requestsPerMinute ?? null,
      dailyLimit: doc.dailyLimit ?? null,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Update an existing key's metadata or rotate its secret.
   */
  async updateKey(
    id: string,
    input: {
      label?: string;
      apiKey?: string;
      active?: boolean;
      requestsPerMinute?: number | null;
      dailyLimit?: number | null;
    },
    actor: Principal,
  ): Promise<PublicProviderKey> {
    const doc = await ProviderKey.findById(id);
    if (!doc) {
      throw new ApiError(404, 'NOT_FOUND', 'API key not found');
    }

    if (input.label !== undefined) doc.label = input.label.trim();
    if (input.active !== undefined) doc.active = input.active;
    if (input.requestsPerMinute !== undefined) doc.requestsPerMinute = input.requestsPerMinute;
    if (input.dailyLimit !== undefined) doc.dailyLimit = input.dailyLimit;

    if (input.apiKey && input.apiKey.trim()) {
      const trimmed = input.apiKey.trim();
      const enc = encryptApiKey(trimmed);
      doc.encryptedKey = enc.ciphertext;
      doc.iv = enc.iv;
      doc.tag = enc.tag;
      doc.keyHint = trimmed.length > 4 ? `...${trimmed.slice(-4)}` : trimmed;
    }

    await doc.save();
    this.invalidateCache();

    await audit(this.logger, 'provider_key.update', actor, undefined, {
      provider: doc.provider,
      keyId: doc._id,
      label: doc.label,
      active: doc.active,
    });

    return {
      id: doc._id,
      provider: doc.provider,
      label: doc.label,
      keyHint: doc.keyHint,
      active: doc.active,
      requestsPerMinute: doc.requestsPerMinute ?? null,
      dailyLimit: doc.dailyLimit ?? null,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Delete an API key record.
   */
  async deleteKey(id: string, actor: Principal): Promise<{ ok: boolean }> {
    const doc = await ProviderKey.findById(id);
    if (!doc) {
      throw new ApiError(404, 'NOT_FOUND', 'API key not found');
    }

    await ProviderKey.deleteOne({ _id: id });
    this.invalidateCache();

    await audit(this.logger, 'provider_key.delete', actor, undefined, {
      provider: doc.provider,
      keyId: id,
      label: doc.label,
    });

    return { ok: true };
  }

  /**
   * Test an individual stored key directly against the provider probe endpoint.
   */
  async testKey(id: string, actor: Principal): Promise<{ ok: boolean; message: string; ms: number }> {
    const doc = await ProviderKey.findById(id).lean();
    if (!doc) {
      throw new ApiError(404, 'NOT_FOUND', 'API key not found');
    }

    const adapter = this.adapters.find((a) => a.id === doc.provider);
    if (!adapter) {
      throw new ApiError(400, 'VALIDATION_ERROR', `No adapter found for provider ${doc.provider}`);
    }

    let rawKey: string;
    try {
      rawKey = decryptApiKey({ ciphertext: doc.encryptedKey, iv: doc.iv, tag: doc.tag });
    } catch {
      throw new ApiError(500, 'DECRYPTION_FAILED', 'Could not decrypt the stored key');
    }

    const http = createProviderHttp({
      providerName: adapter.name,
      allowedHosts: adapter.allowedHosts,
      timeoutMs: this.config.enrichment.timeoutMs,
    });

    const started = Date.now();
    try {
      const finding = await adapter.lookup(adapter.probe, { apiKey: rawKey, http });
      await audit(this.logger, 'provider_key.test', actor, undefined, {
        provider: doc.provider,
        keyId: id,
        ok: true,
      });
      return {
        ok: true,
        message: `Key valid. Test lookup of ${adapter.probe.value}: ${finding.summary}`,
        ms: Date.now() - started,
      };
    } catch (e) {
      await audit(this.logger, 'provider_key.test', actor, undefined, {
        provider: doc.provider,
        keyId: id,
        ok: false,
        error: (e as Error).message,
      });
      return {
        ok: false,
        message: (e as Error).message,
        ms: Date.now() - started,
      };
    }
  }

  /**
   * Retrieves all active decrypted keys for a given provider (database keys + env fallback).
   */
  async getActiveKeys(provider: ProviderId): Promise<ActiveKeyEntry[]> {
    const now = Date.now();
    if (this.keyCache.has(provider) && now < this.cacheExpiresAt) {
      return this.keyCache.get(provider)!;
    }

    const adapter = this.adapters.find((a) => a.id === provider);
    const defaultRpm = adapter?.defaultLimits.requestsPerMinute ?? 4;
    const defaultDaily = adapter?.defaultLimits.dailyLimit ?? null;

    const entries: ActiveKeyEntry[] = [];

    // 1. Fetch active keys from database
    try {
      const dbKeys = await ProviderKey.find({ provider, active: true }).lean();
      for (const k of dbKeys) {
        try {
          const decrypted = decryptApiKey({ ciphertext: k.encryptedKey, iv: k.iv, tag: k.tag });
          entries.push({
            id: k._id,
            apiKey: decrypted,
            requestsPerMinute: k.requestsPerMinute ?? defaultRpm,
            dailyLimit: k.dailyLimit ?? defaultDaily,
            activeCount: 0,
            lastUsedAt: 0,
          });
        } catch (e) {
          this.logger.error({ keyId: k._id, provider }, 'Failed to decrypt provider key');
        }
      }
    } catch (e) {
      this.logger.warn({ provider, err: (e as Error).message }, 'Could not read provider keys from database');
    }

    // 2. Include environment key as fallback or additional worker if present and not already registered
    const envKey = this.config.providers[provider]?.apiKey;
    if (envKey && !entries.some((e) => e.apiKey === envKey)) {
      entries.push({
        id: 'env-default',
        apiKey: envKey,
        requestsPerMinute: this.config.providers[provider]?.requestsPerMinute ?? defaultRpm,
        dailyLimit: this.config.providers[provider]?.dailyLimit ?? defaultDaily,
        activeCount: 0,
        lastUsedAt: 0,
      });
    }

    this.keyCache.set(provider, entries);
    this.cacheExpiresAt = now + 15_000; // Cache for 15s
    return entries;
  }

  /**
   * Get dynamic aggregated limits for a provider considering all active keys.
   */
  async getEffectiveLimits(provider: ProviderId, baseLimits: ProviderLimits): Promise<ProviderLimits> {
    const keys = await this.getActiveKeys(provider);
    if (keys.length === 0) return baseLimits;

    const totalRpm = keys.reduce((sum, k) => sum + k.requestsPerMinute, 0);
    const totalDaily = keys.every((k) => k.dailyLimit === null)
      ? null
      : keys.reduce((sum, k) => sum + (k.dailyLimit ?? 0), 0);

    return {
      requestsPerMinute: Math.max(baseLimits.requestsPerMinute, totalRpm),
      dailyLimit: totalDaily ?? baseLimits.dailyLimit,
      concurrency: Math.max(baseLimits.concurrency, keys.length),
    };
  }

  /**
   * Acquire an API key using round-robin and least-busy worker distribution.
   */
  async acquireKey(provider: ProviderId, fallbackKey: string | null): Promise<{ apiKey: string; release: () => void }> {
    const keys = await this.getActiveKeys(provider);
    if (keys.length === 0) {
      if (!fallbackKey) {
        throw new ApiError(503, 'NO_KEY_AVAILABLE', `No active API key for ${provider}`);
      }
      return { apiKey: fallbackKey, release: () => {} };
    }

    // Find key with lowest active count, tie-broken by round-robin
    const idx = this.roundRobinIdx.get(provider) ?? 0;
    const sorted = [...keys].sort((a, b) => a.activeCount - b.activeCount);
    const best = sorted[0]!;

    best.activeCount++;
    best.lastUsedAt = Date.now();
    this.roundRobinIdx.set(provider, (idx + 1) % keys.length);

    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        best.activeCount = Math.max(0, best.activeCount - 1);
      }
    };

    return { apiKey: best.apiKey, release };
  }
}

