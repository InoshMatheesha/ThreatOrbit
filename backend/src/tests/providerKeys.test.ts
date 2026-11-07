import { describe, expect, it } from 'vitest';
import { decryptApiKey, encryptApiKey } from '../lib/crypto.js';
import { ProviderKey } from '../models/ProviderKey.js';
import { useTestDatabase } from './db.js';
import { enrichmentHarness, signedInAgent } from './helpers.js';
import { virusTotal } from '../providers/adapters/virustotal.js';
import { ProviderKeyService } from '../services/providerKeyService.js';
import { loadConfig } from '../config/env.js';
import { pino } from 'pino';

useTestDatabase();

describe('Cryptographic Storage & Provider Key Management', () => {
  it('encrypts and decrypts API keys securely with AES-256-GCM', () => {
    const rawKey = 'super-secret-vt-api-key-12345';
    const encrypted = encryptApiKey(rawKey);

    expect(encrypted.ciphertext).toBeDefined();
    expect(encrypted.ciphertext).not.toBe(rawKey);
    expect(encrypted.iv).toHaveLength(24); // 12 bytes hex
    expect(encrypted.tag).toHaveLength(32); // 16 bytes hex

    const decrypted = decryptApiKey(encrypted);
    expect(decrypted).toBe(rawKey);
  });

  it('generates unique IVs and ciphertexts for identical keys', () => {
    const key = 'identical-key-value';
    const enc1 = encryptApiKey(key);
    const enc2 = encryptApiKey(key);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
    expect(decryptApiKey(enc1)).toBe(key);
    expect(decryptApiKey(enc2)).toBe(key);
  });

  it('ProviderKeyService stores encrypted keys and masks keyHint in listings', async () => {
    const config = loadConfig({ VIRUSTOTAL_API_KEY: 'env-key-9999' });
    const logger = pino({ level: 'silent' });
    const service = new ProviderKeyService(config, logger, [virusTotal]);

    const actor = { id: 'admin-1', email: 'admin@threatorbit.local', name: 'Admin One', role: 'admin' as const };
    const created = await service.addKey(
      { provider: 'virustotal', label: 'Secondary VT Worker', apiKey: 'vt-key-worker-8888' },
      actor,
    );

    expect(created.provider).toBe('virustotal');
    expect(created.label).toBe('Secondary VT Worker');
    expect(created.keyHint).toBe('...8888');

    // Verify database document holds ONLY encrypted values, NEVER plaintext
    const doc = await ProviderKey.findById(created.id).lean();
    expect(doc).toBeDefined();
    expect(doc!.encryptedKey).not.toContain('8888');
    expect(decryptApiKey({ ciphertext: doc!.encryptedKey, iv: doc!.iv, tag: doc!.tag })).toBe('vt-key-worker-8888');

    // List keys
    const list = await service.listKeys();
    expect(list.some((k) => k.keyHint === '...8888')).toBe(true);

    // Verify active keys includes both DB key and env key for parallel processing
    const active = await service.getActiveKeys('virustotal');
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(active.map((a) => a.apiKey)).toContain('vt-key-worker-8888');
    expect(active.map((a) => a.apiKey)).toContain('env-key-9999');

    // Test acquireKey round-robin distribution
    const first = await service.acquireKey('virustotal', null);
    const second = await service.acquireKey('virustotal', null);
    expect(first.apiKey).toBeDefined();
    expect(second.apiKey).toBeDefined();
    first.release();
    second.release();
  });

  it('restricts API key configuration endpoints strictly to admin roles', async () => {
    const h = await enrichmentHarness();
    const { agent: analystAgent } = await signedInAgent(h.app, 'analyst');
    const { agent: adminAgent } = await signedInAgent(h.app, 'admin');

    // Analyst attempts to list or create keys -> 403 Forbidden
    const deniedList = await analystAgent.get('/api/settings/provider-keys');
    expect(deniedList.status).toBe(403);

    const deniedCreate = await analystAgent.post('/api/settings/provider-keys').send({
      provider: 'virustotal',
      label: 'Unauthorized Key',
      apiKey: 'secret-1234',
    });
    expect(deniedCreate.status).toBe(403);

    // Admin can list and create
    const adminList = await adminAgent.get('/api/settings/provider-keys');
    expect(adminList.status).toBe(200);

    const adminCreate = await adminAgent.post('/api/settings/provider-keys').send({
      provider: 'virustotal',
      label: 'Admin Dedicated Key',
      apiKey: 'vt-admin-key-7777',
      requestsPerMinute: 8,
    });
    expect(adminCreate.status).toBe(201);
    expect(adminCreate.body.data.keyHint).toBe('...7777');
    expect(adminCreate.body.data.requestsPerMinute).toBe(8);

    const keyId = adminCreate.body.data.id;

    // Admin updates key
    const adminUpdate = await adminAgent.patch(`/api/settings/provider-keys/${keyId}`).send({
      label: 'Updated Dedicated Key',
      active: false,
    });
    expect(adminUpdate.status).toBe(200);
    expect(adminUpdate.body.data.active).toBe(false);

    // Admin deletes key
    const adminDelete = await adminAgent.delete(`/api/settings/provider-keys/${keyId}`);
    expect(adminDelete.status).toBe(200);

    await h.service.stop();
  });
});

