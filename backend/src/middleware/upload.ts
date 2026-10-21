import path from 'node:path';
import multer from 'multer';
import { ApiError } from '../lib/errors.js';

const ALLOWED_EXTENSIONS = new Set(['.txt', '.csv']);
// Browsers report CSV inconsistently (Windows often sends application/vnd.ms-excel).
// The content itself is verified as UTF-8 text afterwards, so the MIME check is a first gate only.
const ALLOWED_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/x-csv',
  'application/csv',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

/** Accepts a single .txt/.csv file in the `file` field, held in memory and size-limited. */
export function uploadSingleFile(maxBytes: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 4, fieldSize: 1024, parts: 5 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        cb(new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Only .txt and .csv files are accepted'));
        return;
      }
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(new ApiError(415, 'UNSUPPORTED_FILE_TYPE', `Unsupported content type '${file.mimetype}'`));
        return;
      }
      cb(null, true);
    },
  }).single('file');
}

/** Decode an uploaded buffer as strict UTF-8 text, rejecting binary content. */
export function decodeTextFile(buffer: Buffer): string {
  if (buffer.length === 0) {
    throw new ApiError(400, 'INVALID_FILE_CONTENT', 'Uploaded file is empty');
  }
  if ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff)) {
    throw new ApiError(400, 'INVALID_FILE_CONTENT', 'UTF-16 files are not supported: save the file as UTF-8');
  }
  if (buffer.includes(0)) {
    throw new ApiError(400, 'INVALID_FILE_CONTENT', 'Uploaded file appears to be binary, not text');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new ApiError(400, 'INVALID_FILE_CONTENT', 'Uploaded file is not valid UTF-8 text');
  }
}
