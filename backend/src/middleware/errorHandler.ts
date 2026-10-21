import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { ApiError, errorBody } from '../lib/errors.js';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody('NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(errorBody(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      res.status(400).json(errorBody('VALIDATION_ERROR', 'Request validation failed', details));
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json(errorBody('FILE_TOO_LARGE', 'Uploaded file exceeds the size limit'));
      } else {
        res.status(400).json(errorBody('VALIDATION_ERROR', `Invalid upload: ${err.message}`));
      }
      return;
    }
    // Errors raised by express.json() (body-parser) carry a `type`.
    const type = typeof err === 'object' && err !== null && 'type' in err ? String(err.type) : undefined;
    if (type === 'entity.too.large') {
      res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit'));
      return;
    }
    if (type === 'entity.parse.failed') {
      res.status(400).json(errorBody('INVALID_JSON', 'Request body is not valid JSON'));
      return;
    }
    if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
      res.status(415).json(errorBody('VALIDATION_ERROR', 'Unsupported request encoding'));
      return;
    }

    logger.error({ err: { name: err?.name, message: err?.message }, method: req.method, path: req.path }, 'Unhandled error');
    res.status(500).json(errorBody('INTERNAL_ERROR', 'An unexpected error occurred'));
  };
}
