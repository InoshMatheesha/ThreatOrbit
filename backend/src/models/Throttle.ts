import { model, Schema } from 'mongoose';

/**
 * Shared coordination state for serverless deployments, where many short-lived
 * function instances must agree on rate limits without shared memory.
 */

/** Requests started per provider per minute (fixed window). Expires automatically. */
export interface ProviderWindowDoc {
  provider: string;
  minute: number;
  count: number;
  expiresAt: Date;
}

const windowSchema = new Schema<ProviderWindowDoc>(
  {
    provider: { type: String, required: true },
    minute: { type: Number, required: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
windowSchema.index({ provider: 1, minute: 1 }, { unique: true });
windowSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ProviderWindow = model<ProviderWindowDoc>('ProviderWindow', windowSchema);

/** A provider asked us to back off (HTTP 429): no new requests until `pausedUntil`. */
export interface ProviderPauseDoc {
  provider: string;
  pausedUntil: Date;
}

const pauseSchema = new Schema<ProviderPauseDoc>(
  {
    provider: { type: String, required: true },
    pausedUntil: { type: Date, required: true },
  },
  { versionKey: false },
);
pauseSchema.index({ provider: 1 }, { unique: true });

export const ProviderPause = model<ProviderPauseDoc>('ProviderPause', pauseSchema);

/** Run-at-most-every-N lock for periodic jobs (e.g. retention purge). */
export interface SystemLockDoc {
  key: string;
  at: Date;
}

const lockSchema = new Schema<SystemLockDoc>(
  {
    key: { type: String, required: true },
    at: { type: Date, required: true },
  },
  { versionKey: false },
);
lockSchema.index({ key: 1 }, { unique: true });

export const SystemLock = model<SystemLockDoc>('SystemLock', lockSchema);

/** Atomically take the lock if it was last taken more than `intervalMs` ago. */
export async function acquireLock(key: string, intervalMs: number): Promise<boolean> {
  const now = new Date();
  try {
    const doc = await SystemLock.findOneAndUpdate(
      { key, at: { $lt: new Date(now.getTime() - intervalMs) } },
      { $set: { at: now } },
      { upsert: true, returnDocument: 'after' },
    );
    return Boolean(doc);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}
