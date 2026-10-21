import type { ClassifyOutcome, IndicatorType } from './types.js';

const HASH_TYPES_BY_LENGTH: Record<number, IndicatorType> = {
  32: 'md5',
  40: 'sha1',
  64: 'sha256',
};

export const HEX_RE = /^[0-9a-f]+$/i;

export function hashTypeForLength(length: number): IndicatorType | undefined {
  return HASH_TYPES_BY_LENGTH[length];
}

/** Caller must have checked that `input` is all hex. */
export function classifyHash(input: string): ClassifyOutcome {
  const type = hashTypeForLength(input.length);
  if (!type) {
    const extra = input.length === 128 ? ' SHA-512 is not supported.' : '';
    return {
      ok: false,
      error: `Hex string of length ${input.length} is not a supported hash (MD5=32, SHA-1=40, SHA-256=64).${extra}`,
    };
  }
  return { ok: true, type, normalized: input.toLowerCase(), lookupEligible: true, notes: [] };
}
