import type { RequestHandler } from 'express';
import { errorBody } from '../lib/errors.js';

/** Used when the app runs without a database (preview-only mode). */
export const unavailable: RequestHandler = (_req, res) => {
  res.status(503).json(errorBody('DATABASE_UNAVAILABLE', 'Enrichment is unavailable: the database is not connected'));
};
