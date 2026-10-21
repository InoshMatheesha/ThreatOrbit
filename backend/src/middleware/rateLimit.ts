import { rateLimit } from 'express-rate-limit';
import { errorBody } from '../lib/errors.js';

export function apiRateLimit(perMinute: number) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json(errorBody('RATE_LIMITED', 'Too many requests, slow down and retry shortly'));
    },
  });
}
