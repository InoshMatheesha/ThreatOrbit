import { ProviderUsage } from '../models/ProviderUsage.js';

export function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
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
  try {
    const doc = await ProviderUsage.findOneAndUpdate(
      { provider, day, count: { $lt: dailyLimit } },
      { $inc: { count: 1 } },
      { upsert: true, new: true },
    );
    return Boolean(doc);
  } catch (err) {
    // Upsert collides with the existing (full) document: quota reached.
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

export async function usageToday(): Promise<Map<string, number>> {
  const docs = await ProviderUsage.find({ day: utcDay() }).lean();
  return new Map(docs.map((d) => [d.provider, d.count]));
}
