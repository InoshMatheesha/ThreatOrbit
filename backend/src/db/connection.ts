import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { AuditEvent, Batch, EnrichmentResult, Indicator, ProviderUsage, Session, User } from '../models/index.js';

export interface DatabaseHandle {
  mode: 'external' | 'embedded';
  close(): Promise<void>;
}

const DB_NAME = 'threat_intel_hub';

async function syncIndexes() {
  await Promise.all([Batch, EnrichmentResult, Indicator, AuditEvent, ProviderUsage, User, Session].map((m) => m.syncIndexes()));
}

/**
 * Connect to MONGODB_URI. If it is unreachable and the embedded fallback is on,
 * start a local mongod (downloaded on first use) whose data persists in
 * EMBEDDED_MONGODB_DIR. Same driver and models either way.
 */
export async function connectDatabase(config: AppConfig, logger: Logger): Promise<DatabaseHandle> {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(config.database.uri, { serverSelectionTimeoutMS: 2500 });
    await syncIndexes();
    logger.info('Connected to MongoDB');
    return { mode: 'external', close: () => mongoose.disconnect() };
  } catch (err) {
    await mongoose.disconnect().catch(() => {});
    if (!config.database.embeddedFallback) throw err;
    logger.warn('MongoDB not reachable at MONGODB_URI; starting the embedded development database');
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server-core');
  const dbPath = path.resolve(config.database.embeddedDir);
  fs.mkdirSync(dbPath, { recursive: true });
  logger.info({ dbPath }, 'Starting embedded MongoDB (the first start downloads the server, ~100 MB)');
  const server = await MongoMemoryServer.create({ instance: { dbPath, storageEngine: 'wiredTiger', dbName: DB_NAME } });
  await mongoose.connect(server.getUri(DB_NAME), { serverSelectionTimeoutMS: 10_000 });
  await syncIndexes();
  logger.info('Embedded MongoDB ready');
  return {
    mode: 'embedded',
    async close() {
      await mongoose.disconnect();
      await server.stop({ doCleanup: false });
    },
  };
}
