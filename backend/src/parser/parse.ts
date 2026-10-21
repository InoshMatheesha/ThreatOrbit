import { classifyIndicator } from './classify.js';
import { csvToCells } from './csv.js';
import { extractCandidates } from './extract.js';
import { refang } from './refang.js';
import {
  INDICATOR_TYPES,
  type Candidate,
  type ClassifyOutcome,
  type IndicatorType,
  type ParsedEntry,
  type ParseMode,
  type ParseResult,
  type ParseStats,
  type UniqueIndicator,
} from './types.js';

export const DEFAULT_MAX_LINES = 20_000;
const MAX_LINE_LENGTH = 8192;
const COMMENT_RE = /^(?:#|\/\/)/;

export class InputTooLargeError extends Error {
  constructor(readonly lines: number, readonly maxLines: number) {
    super(`Input has ${lines} lines; the maximum is ${maxLines}`);
    this.name = 'InputTooLargeError';
  }
}

export interface ParseOptions {
  mode?: ParseMode;
  /** Treat the input as CSV (uploaded .csv file). Ignored in extract mode. */
  format?: 'text' | 'csv';
  maxLines?: number;
}

interface Classified extends Candidate {
  outcome: ClassifyOutcome;
}

function splitLines(text: string, maxLines: number): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  // A trailing newline produces one empty final element; it is not a real line.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > maxLines) throw new InputTooLargeError(lines.length, maxLines);
  return lines;
}

function classifyCandidate(line: number, original: string): Classified {
  const { value, changed } = refang(original);
  const outcome: ClassifyOutcome =
    original.length > MAX_LINE_LENGTH
      ? { ok: false, error: `Line exceeds ${MAX_LINE_LENGTH} characters` }
      : classifyIndicator(value);
  return { line, original, value, refanged: changed, outcome };
}

/**
 * Validate, classify, normalize and deduplicate bulk IOC input.
 *
 * Entirely offline: the parser does no DNS resolution, HTTP requests or socket
 * connections. A syntactically valid indicator says nothing about whether it is
 * malicious or safe.
 */
export function parseIndicators(text: string, options: ParseOptions = {}): ParseResult {
  const mode = options.mode ?? 'lines';
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const lines = splitLines(text, maxLines);

  let emptyLines = 0;
  let commentLines = 0;
  const classified: Classified[] = [];

  if (mode === 'extract') {
    lines.forEach((lineText, i) => {
      if (!lineText.trim()) {
        emptyLines++;
        return;
      }
      classified.push(...extractCandidates(lineText.slice(0, MAX_LINE_LENGTH), i + 1));
    });
  } else if (options.format === 'csv') {
    for (const cell of csvToCells(lines.join('\n'))) {
      if (COMMENT_RE.test(cell.value)) {
        commentLines++;
        continue;
      }
      classified.push(classifyCandidate(cell.line, cell.value));
    }
  } else {
    lines.forEach((lineText, i) => {
      const trimmed = lineText.trim();
      if (!trimmed) {
        emptyLines++;
      } else if (COMMENT_RE.test(trimmed)) {
        commentLines++;
      } else {
        classified.push(classifyCandidate(i + 1, trimmed));
      }
    });
  }

  return aggregate(mode, classified, { linesRead: lines.length, emptyLines, commentLines });
}

function aggregate(
  mode: ParseMode,
  classified: Classified[],
  counts: Pick<ParseStats, 'linesRead' | 'emptyLines' | 'commentLines'>,
): ParseResult {
  const entries: ParsedEntry[] = [];
  const unique = new Map<string, UniqueIndicator>();
  const byType = Object.fromEntries(INDICATOR_TYPES.map((t) => [t, 0])) as Record<IndicatorType, number>;
  let invalid = 0;
  let duplicates = 0;

  for (const c of classified) {
    if (!c.outcome.ok) {
      invalid++;
      entries.push({
        line: c.line,
        original: c.original,
        normalized: null,
        type: null,
        status: 'invalid',
        error: c.outcome.error,
        duplicate: false,
        duplicateOfLine: null,
        refanged: c.refanged,
        lookupEligible: false,
        notes: [],
      });
      continue;
    }

    const { type, normalized, lookupEligible, notes, display } = c.outcome;
    // Keyed by type as well as value so distinct indicator kinds never merge.
    const key = `${type}:${normalized}`;
    const existing = unique.get(key);
    if (existing) {
      duplicates++;
      existing.lines.push(c.line);
      if (!existing.originals.includes(c.original)) existing.originals.push(c.original);
    } else {
      byType[type]++;
      unique.set(key, {
        value: normalized,
        type,
        lines: [c.line],
        originals: [c.original],
        lookupEligible,
        notes,
        ...(display ? { display } : {}),
      });
    }

    entries.push({
      line: c.line,
      original: c.original,
      normalized,
      type,
      status: 'valid',
      error: null,
      duplicate: Boolean(existing),
      duplicateOfLine: existing ? existing.lines[0]! : null,
      refanged: c.refanged,
      lookupEligible,
      notes,
      ...(display ? { display } : {}),
    });
  }

  const indicators = [...unique.values()];
  const eligible = indicators.filter((i) => i.lookupEligible).length;

  return {
    mode,
    entries,
    indicators,
    stats: {
      total: classified.length,
      valid: classified.length - invalid,
      invalid,
      duplicates,
      unique: indicators.length,
      eligible,
      ineligible: indicators.length - eligible,
      byType,
      ...counts,
    },
  };
}
