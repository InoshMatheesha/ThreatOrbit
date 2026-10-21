import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { AuditEvent, Batch, EnrichmentResult, Indicator, ProviderUsage } from '../models/index.js';

/** Connect this test file to its own database and wipe it between tests. */
export function useTestDatabase() {
  beforeAll(async () => {
    const base = inject('mongoUri').replace(/\/?$/, '/');
    await mongoose.connect(`${base}tih_test_${randomUUID().slice(0, 8)}`);
    await Promise.all([Batch, EnrichmentResult, Indicator, AuditEvent, ProviderUsage].map((m) => m.syncIndexes()));
  });
  beforeEach(async () => {
    await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}
