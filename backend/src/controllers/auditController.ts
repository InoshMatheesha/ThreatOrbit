import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AuditEvent } from '../models/AuditEvent.js';

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });

export const listAudit: RequestHandler = async (req, res) => {
  const { limit } = querySchema.parse(req.query);
  const events = await AuditEvent.find({}, { _id: 0, sessionId: 0 }).sort({ at: -1 }).limit(limit).lean();
  res.json({ data: events });
};
