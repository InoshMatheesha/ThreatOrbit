import { describe, expect, it } from 'vitest';
import { InvalidCsvError, parseIndicators } from '../parser/index.js';

describe('CSV input', () => {
  it('uses the recognised header column and reports CSV line numbers', () => {
    const csv = 'type,ioc,comment\r\nip,8.8.8.8,dns\r\ndomain,"evil.com",phish\r\nbad,nope,x\r\n';
    const r = parseIndicators(csv, { format: 'csv' });
    expect(r.entries.map((e) => [e.line, e.status, e.normalized])).toEqual([
      [2, 'valid', '8.8.8.8'],
      [3, 'valid', 'evil.com'],
      [4, 'invalid', null],
    ]);
  });

  it('treats every cell as a candidate when there is no header', () => {
    const r = parseIndicators('8.8.8.8,evil.com\n1.1.1.1,\n', { format: 'csv' });
    expect(r.stats).toMatchObject({ valid: 3, invalid: 0 });
  });

  it('throws a typed error for malformed CSV', () => {
    expect(() => parseIndicators('"unterminated,1.1.1.1\n', { format: 'csv' })).toThrow(InvalidCsvError);
  });
});
