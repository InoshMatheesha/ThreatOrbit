import type { Logger } from 'pino';
import { AuditEvent, type AuditAction } from '../models/AuditEvent.js';
import type { Actor } from '../models/Batch.js';

/** Record who did what. `actor` is null for system actions. Never pass indicator values or secrets. */
export async function audit(
  logger: Logger,
  action: AuditAction,
  actor: Actor | null,
  batchId?: string,
  details?: Record<string, string | number | boolean>,
) {
  try {
    const who = actor ? { id: actor.id, email: actor.email, name: actor.name } : null;
    await AuditEvent.create({ at: new Date(), action, actor: who, ...(batchId ? { batchId } : {}), ...(details ? { details } : {}) });
  } catch (err) {
    // Auditing must never break the action itself, but a gap should be visible.
    logger.error({ action, err: (err as Error).message }, 'Failed to write audit event');
  }
}
