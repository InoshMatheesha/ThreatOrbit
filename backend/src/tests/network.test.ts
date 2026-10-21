import dns from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseIndicators } from '../parser/index.js';
import { guardNetwork } from './networkGuard.js';

const MIXED_INPUT = [
  '8.8.8.8',
  '2001:4860:4860::8888',
  'evil.com',
  'münchen.de',
  'hxxps://evil[.]com/path?q=1#x',
  'http://0x7f.1/',
  'http://[2606:4700::1111]/',
  'd41d8cd98f00b204e9800998ecf8427e',
  'not-an-indicator',
  'corp.local',
].join('\n');

describe('parser network isolation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the guard really does catch outbound attempts', async () => {
    const guard = guardNetwork();
    expect(() => dns.lookup('example.com', () => {})).toThrow(/Blocked/);
    await expect(fetch('https://example.com')).rejects.toThrow(/Blocked/);
    expect(guard.attempts.map((a) => a.api)).toEqual(['dns.lookup', 'fetch']);
  });

  it('makes zero network requests in line, extract and CSV modes', () => {
    const guard = guardNetwork();
    parseIndicators(MIXED_INPUT);
    parseIndicators(`Report: contact hxxp://bad[.]example.com and 45.33.32.156\n${MIXED_INPUT}`, { mode: 'extract' });
    parseIndicators(`ioc\n${MIXED_INPUT}`, { format: 'csv' });
    expect(guard.attempts).toEqual([]);
  });
});
