import type { Logger } from 'pino';
import { AuditEvent, type AuditAction } from '../models/AuditEvent.js';

export async function audit(
  logger: Logger,
  action: AuditAction,
  sessionId: string,
  batchId?: string,
  details?: Record<string, string | number | boolean>,
) {
  try {
    await AuditEvent.create({ at: new Date(), action, sessionId, ...(batchId ? { batchId } : {}), ...(details ? { details } : {}) });
  } catch (err) {
    // Auditing must never break the action itself, but a gap should be visible.
    logger.error({ action, err: (err as Error).message }, 'Failed to write audit event');
  }
}
