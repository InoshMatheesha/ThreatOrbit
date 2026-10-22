import { model, Schema } from 'mongoose';

/** The scope of an explanation: a whole batch, or one indicator inside it. */
export type ExplanationScope = 'batch' | 'item';

/**
 * A generated plain-English explanation, kept so the same findings are never paid for twice.
 * `inputHash` fingerprints the evidence it was written from; when lookups change, it no longer matches.
 */
export interface AiExplanationDoc {
  batchId: string;
  scope: ExplanationScope;
  /** Indicator index for scope "item"; -1 for the batch summary. */
  itemIndex: number;
  inputHash: string;
  data: Record<string, unknown>;
  model: string;
  createdAt: Date;
}

const explanationSchema = new Schema<AiExplanationDoc>(
  {
    batchId: { type: String, required: true },
    scope: { type: String, enum: ['batch', 'item'], required: true },
    itemIndex: { type: Number, required: true },
    inputHash: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    model: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);
explanationSchema.index({ batchId: 1, scope: 1, itemIndex: 1 }, { unique: true });
explanationSchema.index({ createdAt: 1 });

export const AiExplanation = model<AiExplanationDoc>('AiExplanation', explanationSchema);
