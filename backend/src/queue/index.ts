import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { BullMqLookupQueue, redisAvailable } from './bullmqQueue.js';
import { DatabaseLookupQueue } from './databaseQueue.js';
import { MemoryLookupQueue } from './memoryQueue.js';
import type { LookupQueue } from './types.js';

export * from './types.js';
export { DatabaseLookupQueue } from './databaseQueue.js';
export { MemoryLookupQueue } from './memoryQueue.js';

export async function createLookupQueue(config: AppConfig, logger: Logger): Promise<LookupQueue> {
  const { mode, redisUrl } = config.queue;
  if (mode === 'memory') return new MemoryLookupQueue();
  if (mode === 'database') return new DatabaseLookupQueue(logger);
  if (await redisAvailable(redisUrl)) {
    logger.info('Using BullMQ queue on Redis');
    return new BullMqLookupQueue(redisUrl, logger);
  }
  if (mode === 'bullmq') throw new Error(`QUEUE_MODE=bullmq but Redis is not reachable at ${redisUrl}`);
  logger.warn(
    'Redis not reachable: using the in-process DEVELOPMENT queue (jobs live in memory; unfinished lookups are resumed from MongoDB on restart)',
  );
  return new MemoryLookupQueue();
}
