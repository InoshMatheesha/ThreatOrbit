import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config/env.js';
import { ApiError } from './errors.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is designed for
const TAG_BYTES = 16;
const HKDF_SALT = 'threatorbit';
const HKDF_INFO = 'threatorbit:secret-storage:v1';

/** A secret encrypted with AES-256-GCM. All fields are hex. */
export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export type VaultSource = 'environment' | 'file' | 'ephemeral';

/**
 * Encrypts secrets (provider and AI API keys) before they are written to the database,
 * so a database dump or backup alone never reveals them.
 *
 * The master key never lives in the database: it comes from ENCRYPTION_KEY, or in
 * development from a generated key file. Every value is bound to its record with
 * additional authenticated data, so a ciphertext copied onto another record fails to decrypt.
 */
export class SecretVault {
  constructor(
    private readonly key: Buffer | null,
    readonly source: VaultSource | null,
  ) {}

  get available(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new ApiError(
        503,
        'ENCRYPTION_NOT_CONFIGURED',
        'API keys cannot be stored until the server has an ENCRYPTION_KEY (at least 32 random characters). Set it and restart.',
      );
    }
    return this.key;
  }

  encrypt(plaintext: string, context: string): EncryptedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.requireKey(), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('hex'), iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex') };
  }

  /** Throws when the key is wrong, the value was tampered with, or it belongs to another record. */
  decrypt(secret: EncryptedSecret, context: string): string {
    const decipher = createDecipheriv(ALGORITHM, this.requireKey(), Buffer.from(secret.iv, 'hex'), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(secret.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(secret.ciphertext, 'hex')), decipher.final()]).toString('utf8');
  }

  /** Decrypt, or null when it cannot be read (e.g. ENCRYPTION_KEY changed). */
  tryDecrypt(secret: EncryptedSecret, context: string): string | null {
    if (!this.key) return null;
    try {
      return this.decrypt(secret, context);
    } catch {
      return null;
    }
  }
}

/** Last four characters, the only part of a key ever shown again. */
export function keyHint(secret: string): string {
  return secret.length > 8 ? `...${secret.slice(-4)}` : '...';
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, HKDF_SALT, HKDF_INFO, 32));
}

/** Development only: a random master key kept in a file next to the embedded database. */
function readOrCreateKeyFile(file: string): string {
  const target = path.resolve(file);
  try {
    return fs.readFileSync(target, 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(target, `${randomBytes(48).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
  } catch (err) {
    // Another process created it first: use theirs.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  return fs.readFileSync(target, 'utf8').trim();
}

const vaults = new Map<string, SecretVault>();
let ephemeralSecret: string | null = null;

/**
 * The vault for this configuration (shared, so every service uses the same master key).
 * - ENCRYPTION_KEY set: always used.
 * - test: a random key for the life of the process.
 * - development: a key file under .data/ (created on first use).
 * - production without ENCRYPTION_KEY: unavailable; storing keys is refused with a clear error.
 */
export function vaultFor(config: Pick<AppConfig, 'env' | 'secrets'>): SecretVault {
  const { encryptionKey, encryptionKeyFile } = config.secrets;
  const cacheKey = encryptionKey ? `env:${encryptionKey}` : `${config.env}:${encryptionKeyFile}`;
  const cached = vaults.get(cacheKey);
  if (cached) return cached;

  let vault: SecretVault;
  if (encryptionKey) {
    vault = new SecretVault(deriveKey(encryptionKey), 'environment');
  } else if (config.env === 'test') {
    ephemeralSecret ??= randomBytes(48).toString('base64');
    vault = new SecretVault(deriveKey(ephemeralSecret), 'ephemeral');
  } else if (config.env === 'development') {
    let secret: string | null = null;
    try {
      secret = readOrCreateKeyFile(encryptionKeyFile);
    } catch {
      secret = null; // read-only filesystem: behave as unconfigured
    }
    vault = secret && secret.length >= 32 ? new SecretVault(deriveKey(secret), 'file') : new SecretVault(null, null);
  } else {
    vault = new SecretVault(null, null);
  }
  vaults.set(cacheKey, vault);
  return vault;
}
