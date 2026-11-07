import { model, Schema } from 'mongoose';
import type { ProviderId } from '../config/env.js';

/**
 * An administrator-managed API key for a threat intel provider. Several keys per
 * provider form a pool: lookups are spread across them and each key keeps its own
 * per-minute and daily limits. The key itself is stored only encrypted (see SecretVault).
 */
export interface ProviderKeyDoc {
  _id: string;
  provider: ProviderId;
  label: string;
  /** AES-256-GCM ciphertext, nonce and tag (hex), bound to this record's id. */
  encryptedKey: string;
  iv: string;
  tag: string;
  /** Last four characters, for recognising the key in the UI. */
  keyHint: string;
  active: boolean;
  /** Per-key limits; null means the provider's default. */
  requestsPerMinute: number | null;
  dailyLimit: number | null;
  /** Set when the provider rejected the key (HTTP 401/403); the key is skipped until it is replaced or passes a test. */
  rejectedAt?: Date | null;
  rejectedReason?: string | null;
  createdBy: { id: string; name: string };
  updatedBy?: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

const actor = { _id: false, id: { type: String, required: true }, name: { type: String, required: true } };

const providerKeySchema = new Schema<ProviderKeyDoc>(
  {
    _id: { type: String, required: true },
    provider: { type: String, required: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    encryptedKey: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    keyHint: { type: String, required: true },
    active: { type: Boolean, default: true },
    requestsPerMinute: { type: Number, default: null },
    dailyLimit: { type: Number, default: null },
    rejectedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: null },
    createdBy: actor,
    updatedBy: { _id: false, id: String, name: String },
  },
  { timestamps: true, versionKey: false },
);
providerKeySchema.index({ provider: 1, active: 1 });

export const ProviderKey = model<ProviderKeyDoc>('ProviderKey', providerKeySchema);

/** Additional authenticated data binding a key's ciphertext to its record. */
export const providerKeyContext = (id: string) => `provider-key:${id}`;
