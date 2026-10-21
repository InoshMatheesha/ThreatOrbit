export type IndicatorType = 'ipv4' | 'ipv6' | 'md5' | 'sha1' | 'sha256' | 'domain' | 'url';
export type ParseMode = 'lines' | 'extract';

export const TYPE_LABELS: Record<IndicatorType, string> = {
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  md5: 'MD5',
  sha1: 'SHA-1',
  sha256: 'SHA-256',
  domain: 'Domain',
  url: 'URL',
};

export interface ParsedEntry {
  line: number;
  original: string;
  normalized: string | null;
  type: IndicatorType | null;
  status: 'valid' | 'invalid';
  error: string | null;
  duplicate: boolean;
  duplicateOfLine: number | null;
  refanged: boolean;
  lookupEligible: boolean;
  notes: string[];
  display?: string;
}

export interface UniqueIndicator {
  value: string;
  type: IndicatorType;
  lines: number[];
  originals: string[];
  lookupEligible: boolean;
  notes: string[];
  display?: string;
}

export interface PreviewResult {
  mode: ParseMode;
  source: { kind: 'text' } | { kind: 'file'; name: string; bytes: number };
  stats: {
    total: number;
    valid: number;
    invalid: number;
    duplicates: number;
    unique: number;
    eligible: number;
    ineligible: number;
    byType: Record<IndicatorType, number>;
    linesRead: number;
    emptyLines: number;
    commentLines: number;
  };
  limits: { maxBatchSize: number; withinBatchLimit: boolean; overBy: number };
  entries: ParsedEntry[];
  indicators: UniqueIndicator[];
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}

export async function previewText(text: string, mode: ParseMode, signal?: AbortSignal): Promise<PreviewResult> {
  const res = await fetch('/api/batches/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mode }),
    signal,
  });
  return handle(res);
}

export async function previewFile(file: File, mode: ParseMode, signal?: AbortSignal): Promise<PreviewResult> {
  const form = new FormData();
  form.append('mode', mode);
  form.append('file', file);
  const res = await fetch('/api/batches/preview', { method: 'POST', body: form, signal });
  return handle(res);
}

export async function getHealth(signal?: AbortSignal): Promise<{ status: string }> {
  return handle(await fetch('/api/health', { signal }));
}
