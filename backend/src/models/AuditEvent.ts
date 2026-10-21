import { model, Schema } from 'mongoose';

export const AUDIT_ACTIONS = [
  'batch.create',
  'batch.cancel',
  'batch.delete',
  'batch.retry_failed',
  'result.retry',
  'export.download',
  'history.delete_all',
  'retention.purge',
  'provider.test',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Who did what, when. Details hold counts and ids, never indicator values or secrets. */
export interface AuditEventDoc {
  at: Date;
  action: AuditAction;
  sessionId: string;
  batchId?: string;
  details?: Record<string, string | number | boolean>;
}

const auditSchema = new Schema<AuditEventDoc>(
  {
    at: { type: Date, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    sessionId: { type: String, required: true },
    batchId: String,
    details: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);
auditSchema.index({ at: -1 });

export const AuditEvent = model<AuditEventDoc>('AuditEvent', auditSchema);
