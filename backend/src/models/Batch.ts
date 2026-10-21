import { model, Schema } from 'mongoose';
import type { ProviderId } from '../config/env.js';
import type { IndicatorType, ParseMode } from '../parser/types.js';
import type { ProviderState } from '../providers/registry.js';

export const BATCH_STATUSES = ['queued', 'running', 'cancelling', 'completed', 'completed_with_errors', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const TERMINAL_BATCH_STATUSES: ReadonlySet<BatchStatus> = new Set(['completed', 'completed_with_errors', 'cancelled']);

export interface BatchItem {
  index: number;
  value: string;
  type: IndicatorType;
  display?: string;
  lines: number[];
  originals: string[];
  lookupEligible: boolean;
  notes: string[];
}

export interface ProviderSnapshot {
  id: ProviderId;
  name: string;
  state: ProviderState;
  supports: IndicatorType[];
  requestsPerMinute: number;
}

/** Who created a batch. Name and email are copied so history survives user changes. */
export interface Actor {
  id: string;
  email: string;
  name: string;
}

export interface LookupCounters {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  cached: number;
}

export interface BatchDoc {
  _id: string;
  label?: string;
  status: BatchStatus;
  mode: ParseMode;
  source: { kind: 'text' | 'file'; name?: string; bytes?: number };
  createdBy: Actor;
  totals: { indicators: number; eligible: number; ineligible: number; invalid: number; duplicates: number };
  counters: LookupCounters;
  /** Configuration snapshot at creation time: which providers ran and why others did not. */
  providers: ProviderSnapshot[];
  items: BatchItem[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

const countersSchema = {
  total: { type: Number, default: 0 },
  queued: { type: Number, default: 0 },
  running: { type: Number, default: 0 },
  completed: { type: Number, default: 0 },
  failed: { type: Number, default: 0 },
  cancelled: { type: Number, default: 0 },
  cached: { type: Number, default: 0 },
};

const batchSchema = new Schema<BatchDoc>(
  {
    _id: { type: String, required: true },
    label: { type: String, maxlength: 120 },
    status: { type: String, enum: BATCH_STATUSES, required: true },
    mode: { type: String, enum: ['lines', 'extract'], required: true },
    source: { kind: { type: String, required: true }, name: String, bytes: Number },
    createdBy: { _id: false, id: { type: String, required: true }, email: String, name: String },
    totals: { indicators: Number, eligible: Number, ineligible: Number, invalid: Number, duplicates: Number },
    counters: countersSchema,
    providers: [
      {
        _id: false,
        id: String,
        name: String,
        state: String,
        supports: [String],
        requestsPerMinute: Number,
      },
    ],
    items: [
      {
        _id: false,
        index: Number,
        value: String,
        type: { type: String },
        display: String,
        lines: [Number],
        originals: [String],
        lookupEligible: Boolean,
        notes: [String],
      },
    ],
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true, versionKey: false },
);
batchSchema.index({ createdAt: -1 });
batchSchema.index({ status: 1 });
batchSchema.index({ 'createdBy.id': 1, createdAt: -1 });

export const Batch = model<BatchDoc>('Batch', batchSchema);
