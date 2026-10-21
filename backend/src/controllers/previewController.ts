import path from 'node:path';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { decodeTextFile } from '../middleware/upload.js';
import { InputTooLargeError, InvalidCsvError, PARSE_MODES, parseIndicators, type ParseOptions } from '../parser/index.js';

const modeSchema = z.enum(PARSE_MODES).default('lines');
const jsonBodySchema = z.strictObject({ text: z.string(), mode: modeSchema });
const multipartFieldsSchema = z.strictObject({ mode: modeSchema });

/**
 * POST /api/batches/preview
 *
 * Local parsing only: validates, classifies and deduplicates the input and
 * reports what *would* be submitted. Never contacts a threat intel provider.
 */
export function createPreviewHandler(config: AppConfig): RequestHandler {
  return (req, res) => {
    let text: string;
    let options: ParseOptions;
    let source: { kind: 'text' } | { kind: 'file'; name: string; bytes: number };

    if (req.file) {
      const { mode } = multipartFieldsSchema.parse(req.body ?? {});
      const ext = path.extname(req.file.originalname).toLowerCase();
      text = decodeTextFile(req.file.buffer);
      options = { mode, format: ext === '.csv' ? 'csv' : 'text' };
      source = { kind: 'file', name: path.basename(req.file.originalname).slice(0, 255), bytes: req.file.size };
    } else if (req.is('multipart/form-data')) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Multipart request must include a "file" field');
    } else {
      const body = jsonBodySchema.parse(req.body ?? {});
      text = body.text;
      options = { mode: body.mode, format: 'text' };
      source = { kind: 'text' };
    }

    let result;
    try {
      result = parseIndicators(text, { ...options, maxLines: config.limits.maxInputLines });
    } catch (err) {
      if (err instanceof InputTooLargeError) {
        throw new ApiError(413, 'TOO_MANY_LINES', err.message, { lines: err.lines, maxLines: err.maxLines });
      }
      if (err instanceof InvalidCsvError) {
        throw new ApiError(400, 'INVALID_FILE_CONTENT', err.message);
      }
      throw err;
    }

    const { maxBatchSize } = config.limits;
    res.json({
      data: {
        ...result,
        source,
        limits: {
          maxBatchSize,
          withinBatchLimit: result.stats.eligible <= maxBatchSize,
          overBy: Math.max(0, result.stats.eligible - maxBatchSize),
        },
      },
    });
  };
}
