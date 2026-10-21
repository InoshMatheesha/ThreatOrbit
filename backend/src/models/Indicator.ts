import { model, Schema } from 'mongoose';
import type { IndicatorType } from '../parser/types.js';

/** Every distinct indicator ever submitted, with first/last-seen timestamps. */
export interface IndicatorDoc {
  type: IndicatorType;
  value: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  submissions: number;
}

const indicatorSchema = new Schema<IndicatorDoc>(
  {
    type: { type: String, required: true },
    value: { type: String, required: true },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    submissions: { type: Number, default: 0 },
  },
  { versionKey: false },
);
indicatorSchema.index({ type: 1, value: 1 }, { unique: true });
indicatorSchema.index({ lastSeenAt: 1 });

export const Indicator = model<IndicatorDoc>('Indicator', indicatorSchema);
