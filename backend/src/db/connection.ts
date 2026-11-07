import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import {
  AuditEvent,
  Batch,
  EnrichmentResult,
  Indicator,
  ProviderPause,
  ProviderUsage,
  ProviderWindow,
  Session,
  SystemLock,
  User,
} from '../models/index.js';

export interface DatabaseHandle {
  mode: 'external' | 'embedded';
  close(): Promise<void>;
}

const DB_NAME = 'threat_intel_hub';

const MODELS = [Batch, EnrichmentResult, Indicator, AuditEvent, ProviderUsage, User, Session, ProviderWindow, ProviderPause, SystemLock];

async function syncIndexes() {
  await Promise.all(MODELS.map((m) => m.syncIndexes()));
}

let indexesEnsured: Promise<unknown> | null = null;

/**
 * Serverless variant: connect once per function instance and reuse it across invocations.
 *
 * Index creation is started but not awaited. Every index already exists after the first
 * deployment, so blocking each cold start on ten round trips to Atlas only adds latency to
 * the first request an instance serves; a missing index still gets built, just in the
 * background. Nothing is ever dropped.
 */
export async function connectServerless(config: AppConfig): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', false);
  await mongoose.connect(config.database.uri, { serverSelectionTimeoutMS: 8_000, maxPoolSize: 5 });
  indexesEnsured ??= Promise.all(MODELS.map((m) => m.createIndexes())).catch((err: Error) => {
    console.error('Index creation failed (queries still work, just slower):', err.message);
  });
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
