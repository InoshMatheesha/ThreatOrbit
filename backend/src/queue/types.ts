import type { ProviderId } from '../config/env.js';
import type { ProviderLimits } from '../providers/types.js';

export interface LookupJob {
  resultId: string;
  batchId: string;
  provider: ProviderId;
  /** Attempt number this job represents; part of the job id so retries never collide. */
  attempt: number;
}

export type ProcessOutcome =
  | { kind: 'done' }
  /** Try again later. `pauseProviderMs` also holds back every other job for this provider (HTTP 429). */
  | { kind: 'retry'; delayMs: number; pauseProviderMs?: number };

export type LookupProcessor = (job: LookupJob) => Promise<ProcessOutcome>;

export interface LookupQueue {
  readonly mode: 'bullmq' | 'memory';
  start(processor: LookupProcessor, limits: Map<ProviderId, ProviderLimits>): Promise<void>;
  enqueue(jobs: LookupJob[], delayMs?: number): Promise<void>;
  /** Drop waiting/delayed jobs for a batch. The processor also re-checks batch state. */
  cancelBatch(batchId: string): Promise<void>;
  close(): Promise<void>;
}
