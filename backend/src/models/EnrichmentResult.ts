import { model, Schema, type Types } from 'mongoose';
import type { ProviderId } from '../config/env.js';
import type { IndicatorType } from '../parser/types.js';
import type { Detections, ErrorKind, LookupOutcome, Reference, Verdict } from '../providers/types.js';

export const LOOKUP_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type LookupStatus = (typeof LOOKUP_STATUSES)[number];

export interface LookupError {
  kind: ErrorKind;
  message: string;
  httpStatus?: number;
  at: Date;
}

/**
 * One provider lookup for one indicator in one batch. Completed rows double as
 * the cache: a fresh row (expiresAt in the future) is copied instead of calling
 * the provider again.
 */
export interface EnrichmentResultDoc {
  _id: Types.ObjectId;
  batchId: string;
  itemIndex: number;
  type: IndicatorType;
  value: string;
  provider: ProviderId;
  status: LookupStatus;
  attempts: number;
  outcome?: LookupOutcome;
  verdict?: Verdict;
  summary?: string;
  detections?: Detections;
  abuseConfidence?: number;
  metrics?: Record<string, string | number | boolean>;
  tags?: string[];
  references?: Reference[];
  permalink?: string;
  lookedUpAt?: Date;
  expiresAt?: Date;
  cacheStatus?: 'hit' | 'miss';
  cachedFromId?: Types.ObjectId;
  error?: LookupError;
  /** Earliest time a queued lookup may run again (retry backoff). */
  nextAttemptAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const resultSchema = new Schema<EnrichmentResultDoc>(
  {
    batchId: { type: String, required: true },
    itemIndex: { type: Number, required: true },
    type: { type: String, required: true },
    value: { type: String, required: true },
    provider: { type: String, required: true },
    status: { type: String, enum: LOOKUP_STATUSES, required: true },
    attempts: { type: Number, default: 0 },
    outcome: { type: String, enum: ['found', 'not_found'] },
    verdict: { type: String, enum: ['malicious', 'suspicious', 'no_detections', 'benign', 'unknown'] },
    summary: String,
    detections: { _id: false, malicious: Number, suspicious: Number, harmless: Number, undetected: Number, total: Number },
    abuseConfidence: Number,
    metrics: { type: Schema.Types.Mixed },
    tags: [String],
    references: [{ _id: false, title: String, url: String }],
    permalink: String,
    lookedUpAt: Date,
    expiresAt: Date,
    cacheStatus: { type: String, enum: ['hit', 'miss'] },
    cachedFromId: { type: Schema.Types.ObjectId },
    error: { _id: false, kind: String, message: String, httpStatus: Number, at: Date },
    nextAttemptAt: Date,
  },
  { timestamps: true, versionKey: false },
);
resultSchema.index({ batchId: 1, itemIndex: 1 });
resultSchema.index({ batchId: 1, status: 1 });
// Database queue: oldest due lookup per provider.
resultSchema.index({ provider: 1, status: 1, nextAttemptAt: 1, createdAt: 1 });
// Cache lookups: newest completed result for this indicator from this provider.
resultSchema.index({ provider: 1, type: 1, value: 1, status: 1, expiresAt: -1 });

export const EnrichmentResult = model<EnrichmentResultDoc>('EnrichmentResult', resultSchema);
