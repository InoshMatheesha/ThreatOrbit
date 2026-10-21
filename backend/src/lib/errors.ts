export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'INVALID_FILE_CONTENT'
  | 'TOO_MANY_LINES'
  | 'RATE_LIMITED'
  | 'NO_PROVIDERS_CONFIGURED'
  | 'NOTHING_TO_ENRICH'
  | 'BATCH_TOO_LARGE'
  | 'BATCH_NOT_ACTIVE'
  | 'NOTHING_TO_RETRY'
  | 'NOT_RETRYABLE'
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'DATABASE_UNAVAILABLE'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

/** Error with a stable machine-readable code, rendered as `{ error: { code, message, details? } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}
