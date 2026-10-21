import { parse } from 'csv-parse/sync';

export interface CsvCell {
  line: number;
  value: string;
}

const HEADER_RE = /^(?:iocs?|indicators?|observables?|values?|ioc[ _-]?values?|ips?|ip[ _-]?address(?:es)?|domains?|urls?|hashes|hash|sha256|sha1|md5)$/i;

/**
 * Turn CSV text into candidate cells. If the first row has a recognised header
 * (e.g. "ioc", "indicator", "value"), only that column is used and the header is
 * skipped; otherwise every non-empty cell is a candidate.
 */
export class InvalidCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCsvError';
  }
}

export function csvToCells(text: string): CsvCell[] {
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(text, {
      bom: true,
      info: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    }) as unknown as typeof records;
  } catch (err) {
    throw new InvalidCsvError(`Malformed CSV: ${(err as Error).message}`);
  }

  if (records.length === 0) return [];

  let column: number | undefined;
  const header = records[0]!.record;
  const headerIndex = header.findIndex((cell) => HEADER_RE.test(cell));
  if (headerIndex !== -1) column = headerIndex;

  const cells: CsvCell[] = [];
  for (const [i, { record, info }] of records.entries()) {
    if (i === 0 && column !== undefined) continue;
    const values = column !== undefined ? [record[column] ?? ''] : record;
    for (const value of values) {
      if (value) cells.push({ line: info.lines, value });
    }
  }
  return cells;
}
