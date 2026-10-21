export const INDICATOR_TYPES = ['ipv4', 'ipv6', 'md5', 'sha1', 'sha256', 'domain', 'url'] as const;
export type IndicatorType = (typeof INDICATOR_TYPES)[number];

export const PARSE_MODES = ['lines', 'extract'] as const;
/**
 * - `lines`: strict, one indicator per line. Every non-empty line is reported, valid or not.
 * - `extract`: free text (emails, reports). Only recognised indicators are reported.
 */
export type ParseMode = (typeof PARSE_MODES)[number];

export type ClassifyOutcome =
  | {
      ok: true;
      type: IndicatorType;
      normalized: string;
      /** False for private/reserved IPs, non-public TLDs, etc. Never sent to providers. */
      lookupEligible: boolean;
      notes: string[];
      /** Human-readable Unicode form for internationalized domains. */
      display?: string;
    }
  | { ok: false; error: string };

/** A raw piece of input tied to its source line, before classification. */
export interface Candidate {
  line: number;
  original: string;
  /** The value after refanging, which is what gets classified. */
  value: string;
  refanged: boolean;
}

export interface ParsedEntry {
  /** 1-based line (or CSV record) number in the submitted input. */
  line: number;
  /** Exactly what the analyst submitted, kept for auditability. */
  original: string;
  normalized: string | null;
  type: IndicatorType | null;
  status: 'valid' | 'invalid';
  error: string | null;
  duplicate: boolean;
  /** Line of the first occurrence when `duplicate` is true. */
  duplicateOfLine: number | null;
  refanged: boolean;
  lookupEligible: boolean;
  notes: string[];
  display?: string;
}

/** One deduplicated indicator, keeping every line it appeared on. */
export interface UniqueIndicator {
  value: string;
  type: IndicatorType;
  lines: number[];
  originals: string[];
  lookupEligible: boolean;
  notes: string[];
  display?: string;
}

export interface ParseStats {
  /** Candidates considered (valid + invalid). Empty and comment lines are excluded. */
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  unique: number;
  /** Unique indicators that may be sent to providers. */
  eligible: number;
  /** Unique indicators kept local (private IPs, internal TLDs, ...). */
  ineligible: number;
  byType: Record<IndicatorType, number>;
  linesRead: number;
  emptyLines: number;
  commentLines: number;
}

export interface ParseResult {
  mode: ParseMode;
  stats: ParseStats;
  entries: ParsedEntry[];
  indicators: UniqueIndicator[];
}
