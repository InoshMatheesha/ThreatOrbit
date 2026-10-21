import type { Model } from 'mongoose';

/**
 * Atomically add 1 to a counter document only while its `count` is below `limit`,
 * creating the document if it does not exist yet. Returns false when the limit is reached.
 *
 * A duplicate-key error means one of two things: the document exists but is full (the
 * filter did not match, so the upsert tried to insert a second copy), or a concurrent
 * caller created it a moment earlier. Retrying once tells them apart.
 */
export async function incrementBelow<T>(
  model: Model<T>,
  key: Record<string, unknown>,
  limit: number,
  setOnInsert: Record<string, unknown> = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const doc = await model.findOneAndUpdate(
        { ...key, count: { $lt: limit } } as never,
        { $inc: { count: 1 }, ...(Object.keys(setOnInsert).length ? { $setOnInsert: setOnInsert } : {}) } as never,
        { upsert: true, returnDocument: 'after' },
      );
      return Boolean(doc);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  return false;
}
