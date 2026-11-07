import { model, Schema } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { ProviderId } from '../config/env.js';

export interface ProviderKeyDoc {
  _id: string;
  provider: ProviderId;
  label: string;
  encryptedKey: string;
  iv: string;
  tag: string;
  keyHint: string;
  active: boolean;
  requestsPerMinute?: number | null;
  dailyLimit?: number | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

const providerKeySchema = new Schema<ProviderKeyDoc>(
  {
    _id: { type: String, default: () => randomUUID() },
    provider: { type: String, required: true, index: true },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    encryptedKey: { type: String, required: true },
    iv: { type: String, required: true },
    tag: { type: String, required: true },
    keyHint: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    requestsPerMinute: { type: Number, default: null },
    dailyLimit: { type: Number, default: null },
    createdBy: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
  },
  { timestamps: true },
);

export const ProviderKey = model<ProviderKeyDoc>('ProviderKey', providerKeySchema);

