import { describe, expect, it } from 'vitest';
import { classifyIndicator, parseIndicators, refang, type ClassifyOutcome } from '../parser/index.js';

function ok(input: string) {
  const r = classifyIndicator(input);
  if (!r.ok) throw new Error(`expected '${input}' to be valid, got: ${r.error}`);
  return r;
}
function bad(input: string): string {
  const r: ClassifyOutcome = classifyIndicator(input);
  if (r.ok) throw new Error(`expected '${input}' to be invalid, got ${r.type} ${r.normalized}`);
  return r.error;
}

describe('IPv4', () => {
  it.each(['8.8.8.8', '1.1.1.1', '45.33.32.156', '255.255.255.254'])('accepts %s', (ip) => {
    const r = ok(ip);
    expect(r.type).toBe('ipv4');
    expect(r.normalized).toBe(ip);
  });

  it.each([
    ['1.2.3', /four/],
    ['1.2.3.4.5', /four/],
    ['256.1.1.1', /out of range/],
    ['1.2.3.-1', /./],
    ['010.1.1.1', /leading zero/],
  ])('rejects %s', (ip, msg) => {
    expect(bad(ip)).toMatch(msg);
  });

  it('marks private, loopback, CGNAT and documentation ranges as not eligible for lookup', () => {
    for (const ip of ['10.0.0.1', '192.168.1.1', '172.16.5.4', '127.0.0.1', '100.64.0.1', '169.254.1.1', '0.0.0.0', '192.0.2.1']) {
      const r = ok(ip);
      expect(r.lookupEligible, ip).toBe(false);
      expect(r.notes.join(' '), ip).toMatch(/kept local/);
    }
    expect(ok('8.8.8.8').lookupEligible).toBe(true);
  });

  it('rejects CIDR ranges with a clear message', () => {
    expect(bad('10.0.0.0/8')).toMatch(/CIDR/);
    expect(bad('2001:db8::/32')).toMatch(/CIDR/);
  });
});

describe('IPv6', () => {
  it('normalizes to RFC 5952 form', () => {
    expect(ok('2001:0DB8:0000:0000:0000:0000:0000:0001').normalized).toBe('2001:db8::1');
    expect(ok('2606:4700:0:0:0:0:0:1111').normalized).toBe('2606:4700::1111');
    expect(ok('2001:db8:0:0:1:0:0:1').normalized).toBe('2001:db8::1:0:0:1');
    expect(ok('[2606:4700::1111]').normalized).toBe('2606:4700::1111');
  });

  it('keeps IPv4-mapped addresses as IPv6 instead of merging them into IPv4', () => {
    const r = ok('::FFFF:1.2.3.4');
    expect(r.type).toBe('ipv6');
    expect(r.normalized).toBe('::ffff:1.2.3.4');
    const result = parseIndicators('1.2.3.4\n::ffff:1.2.3.4');
    expect(result.stats.unique).toBe(2);
    expect(result.stats.duplicates).toBe(0);
  });

  it('treats different spellings of the same address as duplicates', () => {
    const result = parseIndicators('2606:4700::1111\n2606:4700:0:0:0:0:0:1111\n2606:4700:0000::1111');
    expect(result.stats.unique).toBe(1);
    expect(result.stats.duplicates).toBe(2);
  });

  it('rejects malformed addresses and zone identifiers', () => {
    expect(bad('2001:db8::1::1')).toMatch(/Invalid IPv6/);
    expect(bad('1:2:3:4:5:6:7:8:9')).toMatch(/Invalid IPv6/);
    expect(bad('fe80::1%eth0')).toMatch(/zone/);
    expect(bad('gggg::1')).toBeTruthy();
  });

  it('flags non-global ranges', () => {
    expect(ok('::1').lookupEligible).toBe(false);
    expect(ok('fe80::1').lookupEligible).toBe(false);
    expect(ok('fd00::1').lookupEligible).toBe(false);
    expect(ok('2001:db8::1').lookupEligible).toBe(false);
    expect(ok('2001:4860:4860::8888').lookupEligible).toBe(true);
  });
});

describe('hashes', () => {
  const md5 = 'd41d8cd98f00b204e9800998ecf8427e';
  const sha1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
  const sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('classifies by exact length and lowercases', () => {
    expect(ok(md5.toUpperCase())).toMatchObject({ type: 'md5', normalized: md5 });
    expect(ok(sha1)).toMatchObject({ type: 'sha1', normalized: sha1 });
    expect(ok(sha256)).toMatchObject({ type: 'sha256', normalized: sha256 });
  });

  it('rejects wrong lengths and non-hex characters', () => {
    expect(bad(md5.slice(1))).toMatch(/length 31/);
    expect(bad(sha1 + 'a')).toMatch(/length 41/);
    expect(bad(sha256.slice(0, 63))).toMatch(/length 63/);
    expect(bad(sha256 + sha256)).toMatch(/SHA-512/);
    expect(bad(md5.slice(0, 31) + 'g')).toBeTruthy();
    expect(bad('z'.repeat(64))).toBeTruthy();
  });
});

describe('domains', () => {
  it('lowercases and strips the trailing root dot', () => {
    expect(ok('EXAMPLE.COM')).toMatchObject({ type: 'domain', normalized: 'example.com' });
    expect(ok('Sub.Example.co.uk.')).toMatchObject({ normalized: 'sub.example.co.uk' });
  });

  it('converts internationalized domains to punycode and keeps a display form', () => {
    const r = ok('münchen.de');
    expect(r.normalized).toBe('xn--mnchen-3ya.de');
    expect(r.display).toBe('münchen.de');
    // Punycode and Unicode spellings are the same indicator.
    const result = parseIndicators('münchen.de\nxn--mnchen-3ya.de\nMÜNCHEN.DE');
    expect(result.stats.unique).toBe(1);
  });

  it('flags mixed-script homographs', () => {
    const r = ok('аpple.com'); // Cyrillic "а"
    expect(r.normalized).toBe('xn--pple-43d.com');
    expect(r.notes.join(' ')).toMatch(/homograph/);
  });

  it('reports invisible characters instead of silently removing them', () => {
    const r = ok('ex​ample.com');
    expect(r.normalized).toBe('example.com');
    expect(r.notes.join(' ')).toMatch(/Invisible/);
  });

  it('normalizes full-width Unicode', () => {
    expect(ok('ＥＸＡＭＰＬＥ．ｃｏｍ').normalized).toBe('example.com');
  });

  it('rejects malformed domains', () => {
    expect(bad('bad..com')).toMatch(/empty label/);
    expect(bad('-bad.com')).toMatch(/Invalid domain label/);
    expect(bad('bad-.com')).toMatch(/Invalid domain label/);
    expect(bad(`${'a'.repeat(64)}.com`)).toMatch(/63/);
    expect(bad(`${'a.'.repeat(130)}com`)).toMatch(/253/);
    expect(bad('xn--zz.com')).toMatch(/IDNA/);
    expect(bad('example.123')).toMatch(/top-level/);
    expect(bad('localhost')).toMatch(/Unrecognized/);
    expect(bad('exa mple.com')).toMatch(/whitespace/);
  });

  it('keeps internal TLDs and bare public suffixes local', () => {
    expect(ok('corp.local')).toMatchObject({ lookupEligible: false });
    expect(ok('host.internal')).toMatchObject({ lookupEligible: false });
    expect(ok('co.uk')).toMatchObject({ lookupEligible: false });
  });
});

describe('URLs', () => {
  it('normalizes scheme and host case, default ports and IDN hosts', () => {
    expect(ok('HTTP://EVIL.COM:80/Path?a=1')).toMatchObject({ type: 'url', normalized: 'http://evil.com/Path?a=1' });
    expect(ok('https://evil.com')).toMatchObject({ normalized: 'https://evil.com/' });
    expect(ok('http://münchen.de/x').normalized).toBe('http://xn--mnchen-3ya.de/x');
    expect(ok('http://[2001:4860:4860::8888]/').normalized).toBe('http://[2001:4860:4860::8888]/');
  });

  it('drops fragments and flags embedded credentials', () => {
    const r = ok('https://user:pw@evil.com/login#victim@corp.com');
    expect(r.normalized).toBe('https://user:pw@evil.com/login');
    expect(r.notes.join(' ')).toMatch(/credentials/);
    expect(r.notes.join(' ')).toMatch(/Fragment/);
  });

  it('reports numeric host reinterpretation explicitly', () => {
    const r = ok('http://0x7f.1/');
    expect(r.normalized).toBe('http://127.0.0.1/');
    expect(r.notes.join(' ')).toMatch(/interpreted as 127\.0\.0\.1/);
    expect(r.lookupEligible).toBe(false);
  });

  it('rejects unsupported schemes and malformed URLs', () => {
    expect(bad('ftp://evil.com/x')).toMatch(/Unsupported URL scheme/);
    expect(bad('javascript://alert(1)')).toMatch(/Unsupported URL scheme/);
    expect(bad('http:evil.com')).toMatch(/Malformed URL/);
    expect(bad('http://')).toMatch(/Malformed|host/);
    expect(bad('http://exa mple.com/')).toMatch(/whitespace/);
    expect(bad('http://bad..com/')).toMatch(/Invalid URL host/);
    expect(bad(`http://evil.com/${'a'.repeat(2100)}`)).toMatch(/2048/);
  });

  it('gives targeted hints for near-misses', () => {
    expect(bad('evil.com/payload.exe')).toMatch(/without a scheme/);
    expect(bad('evil.com:8080')).toMatch(/host:port/);
    expect(bad('user@evil.com')).toMatch(/domain 'evil.com'/);
  });
});

describe('refang', () => {
  it.each([
    ['hxxp://evil[.]com/a', 'http://evil.com/a'],
    ['hXXps[://]evil(.)com', 'https://evil.com'],
    ['hxxps[:]//evil{.}com', 'https://evil.com'],
    ['1.2.3[.]4', '1.2.3.4'],
    ['evil[dot]com', 'evil.com'],
    ['evil\\.com', 'evil.com'],
    ['bad[@]evil[.]com', 'bad@evil.com'],
  ])('%s -> %s', (input, expected) => {
    expect(refang(input)).toEqual({ value: expected, changed: true });
  });

  it('leaves clean input untouched', () => {
    expect(refang('https://example.com/a(b)')).toEqual({ value: 'https://example.com/a(b)', changed: false });
  });

  it('keeps the original input on the parsed entry', () => {
    const [entry] = parseIndicators('hxxps://evil[.]com/x').entries;
    expect(entry).toMatchObject({ original: 'hxxps://evil[.]com/x', normalized: 'https://evil.com/x', refanged: true });
  });
});

describe('parseIndicators (line mode)', () => {
  it('trims whitespace, skips empty and comment lines, and handles CRLF/LF/CR', () => {
    const r = parseIndicators('﻿  8.8.8.8  \r\n\r\n\t\n# comment\n// note\r1.1.1.1\nevil.com\n');
    expect(r.stats).toMatchObject({ total: 3, valid: 3, invalid: 0, emptyLines: 2, commentLines: 2, linesRead: 7 });
    expect(r.entries.map((e) => e.line)).toEqual([1, 6, 7]);
  });

  it('deduplicates by normalized value and keeps every source line', () => {
    const r = parseIndicators('Evil.com\n8.8.8.8\nevil.com.\nhxxp://x[.]com\nEVIL[.]COM');
    expect(r.stats).toMatchObject({ total: 5, valid: 5, duplicates: 2, unique: 3 });
    const evil = r.indicators.find((i) => i.value === 'evil.com')!;
    expect(evil.lines).toEqual([1, 3, 5]);
    expect(evil.originals).toEqual(['Evil.com', 'evil.com.', 'EVIL[.]COM']);
    const dupes = r.entries.filter((e) => e.duplicate);
    expect(dupes.map((d) => [d.line, d.duplicateOfLine])).toEqual([
      [3, 1],
      [5, 1],
    ]);
  });

  it('never merges different indicator types', () => {
    // A URL and its host are different indicators.
    const r = parseIndicators('evil.com\nhttp://evil.com/');
    expect(r.stats.unique).toBe(2);
  });

  it('counts valid, invalid, duplicate and per-type totals', () => {
    const r = parseIndicators(
      [
        '8.8.8.8',
        '8.8.8.8',
        'not an ioc',
        '2606:4700::1111',
        'd41d8cd98f00b204e9800998ecf8427e',
        'evil.com',
        'http://evil.com/',
        '999.1.1.1',
      ].join('\n'),
    );
    expect(r.stats).toMatchObject({ total: 8, valid: 6, invalid: 2, duplicates: 1, unique: 5, eligible: 5 });
    expect(r.stats.byType).toEqual({ ipv4: 1, ipv6: 1, md5: 1, sha1: 0, sha256: 0, domain: 1, url: 1 });
    const invalid = r.entries.filter((e) => e.status === 'invalid');
    expect(invalid.every((e) => e.error && e.normalized === null && e.type === null)).toBe(true);
  });

  it('strips wrapping quotes and angle brackets', () => {
    expect(parseIndicators('"evil.com"\n<8.8.8.8>\n\'1.1.1.1\'').stats.valid).toBe(3);
  });

  it('rejects extremely long lines without crashing', () => {
    const r = parseIndicators('a'.repeat(10_000));
    expect(r.entries[0]!.error).toMatch(/exceeds/);
  });

  it('enforces the line limit', () => {
    expect(() => parseIndicators('1.1.1.1\n'.repeat(11), { maxLines: 10 })).toThrow(/maximum is 10/);
    expect(() => parseIndicators('1.1.1.1\n'.repeat(10), { maxLines: 10 })).not.toThrow();
  });

  it('handles 500+ mixed indicators quickly', () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) {
      lines.push(`45.${i % 256}.${Math.floor(i / 256)}.1`, `host${i}.example.com`, `https://evil${i}.example.net/p?id=${i}`);
    }
    const start = performance.now();
    const r = parseIndicators(lines.join('\n'));
    expect(performance.now() - start).toBeLessThan(2000);
    expect(r.stats.unique).toBe(1800);
  });
});

describe('parseIndicators (extract mode)', () => {
  const report = [
    'Phishing sent from billing@paypa1-secure[.]com with payload hxxp://45.33.32[.]156/a.exe',
    '(see https://example.org/report). Hash sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Internal relay 10.0.0.5, e.g. invoice.exe was dropped at 10:30. Also 2001:4860:4860::8888.',
    '',
  ].join('\n');

  it('extracts indicators from prose and ignores noise', () => {
    const r = parseIndicators(report, { mode: 'extract' });
    const found = r.entries.map((e) => `${e.type}:${e.normalized}`);
    expect(found).toEqual([
      'domain:paypa1-secure.com',
      'url:http://45.33.32.156/a.exe',
      'url:https://example.org/report',
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'ipv4:10.0.0.5',
      'ipv6:2001:4860:4860::8888',
    ]);
    expect(r.stats.invalid).toBe(0);
    expect(r.entries.find((e) => e.type === 'ipv4')).toMatchObject({ line: 3, lookupEligible: false });
    expect(r.entries[0]!.notes).toContain('Extracted from an email address');
  });

  it('flags TLDs that look like file extensions', () => {
    const r = parseIndicators('see readme.md', { mode: 'extract' });
    expect(r.entries[0]!.notes.join(' ')).toMatch(/file extension/);
  });
});
