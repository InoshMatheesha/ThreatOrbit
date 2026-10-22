import { model, Schema } from 'mongoose';
import type { Actor } from './Batch.js';

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
  'ai.explain',
  'settings.ai_update',
  'settings.ai_remove',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_change',
  'user.create',
  'user.update',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Who did what, when. Details hold counts and ids, never indicator values or secrets. */
export interface AuditEventDoc {
  at: Date;
  action: AuditAction;
  /** null for system actions (retention purge). */
  actor: Actor | null;
  batchId?: string;
  details?: Record<string, string | number | boolean>;
}

const auditSchema = new Schema<AuditEventDoc>(
  {
    at: { type: Date, required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    actor: { _id: false, id: String, email: String, name: String },
    batchId: String,
    details: { type: Schema.Types.Mixed },
  },
  { versionKey: false },
);
auditSchema.index({ at: -1 });
auditSchema.index({ 'actor.id': 1, at: -1 });

export const AuditEvent = model<AuditEventDoc>('AuditEvent', auditSchema);
