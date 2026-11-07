import { incrementBelow } from '../lib/counter.js';
import { ProviderUsage } from '../models/ProviderUsage.js';
import { ProviderWindow } from '../models/Throttle.js';

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Usage and rate-window subject for one pooled API key (stored beside the per-provider counters). */
export function keySubject(keyId: string): string {
  return `key:${keyId}`;
}

/**
 * Atomically take one request slot in the subject's current one-minute window
 * (shared through the database, so every process and function instance agrees).
 */
export function reserveMinuteSlot(subject: string, perMinute: number): Promise<boolean> {
  const minute = Math.floor(Date.now() / 60_000);
  return incrementBelow(ProviderWindow, { provider: subject, minute }, perMinute, { expiresAt: new Date((minute + 2) * 60_000) });
}

/** Milliseconds until the next one-minute window opens. */
export function msUntilNextMinute(now = Date.now()): number {
  return 60_000 - (now % 60_000);
}

/**
 * Count one request against today's quota. With a limit, the increment only
 * happens while under it (atomic): returns false once the quota is used up.
 */
export async function reserveRequest(provider: string, dailyLimit: number | null): Promise<boolean> {
  const day = utcDay();
  if (dailyLimit === null) {
    await ProviderUsage.updateOne({ provider, day }, { $inc: { count: 1 } }, { upsert: true });
    return true;
  }
  return incrementBelow(ProviderUsage, { provider, day }, dailyLimit);
}

export async function usageToday(): Promise<Map<string, number>> {
  const docs = await ProviderUsage.find({ day: utcDay() }).lean();
  return new Map(docs.map((d) => [d.provider, d.count]));
}
