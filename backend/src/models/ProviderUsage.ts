import { model, Schema } from 'mongoose';

/** Requests sent per provider per UTC day, to respect daily quotas across restarts. */
export interface ProviderUsageDoc {
  provider: string;
  day: string;
  count: number;
}

const usageSchema = new Schema<ProviderUsageDoc>(
  {
    provider: { type: String, required: true },
    day: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { versionKey: false },
);
usageSchema.index({ provider: 1, day: 1 }, { unique: true });

export const ProviderUsage = model<ProviderUsageDoc>('ProviderUsage', usageSchema);
