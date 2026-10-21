import { classifyDomain, type DomainOptions } from './domain.js';
import { classifyHash, HEX_RE } from './hash.js';
import { classifyIPv4, classifyIPv6 } from './ip.js';
import type { ClassifyOutcome } from './types.js';
import { classifyUrl, SCHEME_RE } from './url.js';

export const MAX_TOKEN_LENGTH = 4096;
// Zone IDs (%eth0) are matched here so they get a specific error from classifyIPv6.
const IPV6_CHARS_RE = /^[0-9a-f:.]+(?:%.*)?$/i;
const HOST_PORT_RE = /^[^:]+:\d{1,5}$/;
const CIDR_RE = /^[0-9a-f:.]+\/\d{1,3}$/i;

function unwrap(input: string): string {
  let s = input;
  // Strip matching quotes or angle brackets left over from copy/paste: "evil.com", <1.2.3.4>
  for (;;) {
    const m = /^(["'`])(.*)\1$/s.exec(s) ?? /^<(.*)>$/s.exec(s);
    if (!m) return s;
    s = (m[2] ?? m[1] ?? '').trim();
  }
}

/**
 * Classify a single (already refanged) token into one supported indicator type.
 * Purely local and deterministic: no DNS, no HTTP, no sockets.
 */
export function classifyIndicator(input: string, domainOptions: DomainOptions = {}): ClassifyOutcome {
  const s = unwrap(input.trim());
  if (!s) return { ok: false, error: 'Empty value' };
  if (s.length > MAX_TOKEN_LENGTH) {
    return { ok: false, error: `Value exceeds ${MAX_TOKEN_LENGTH} characters` };
  }

  if (SCHEME_RE.test(s)) return classifyUrl(s);
  if (/^https?:/i.test(s)) return classifyUrl(s);
  if (/\s/.test(s)) {
    return {
      ok: false,
      error: 'Contains whitespace: submit one indicator per line, or use free-text extraction mode',
    };
  }

  // Long hex runs are hash attempts; shorter ones fall through to "unrecognized".
  if (HEX_RE.test(s) && s.length >= 16) {
    return classifyHash(s);
  }

  if (CIDR_RE.test(s)) {
    return { ok: false, error: 'CIDR ranges are not supported: submit individual IP addresses' };
  }

  const bracketed = /^\[([0-9a-f:.%]+)\]$/i.exec(s);
  if (bracketed) return classifyIPv6(bracketed[1]!);

  if (s.includes(':')) {
    if (HOST_PORT_RE.test(s)) {
      return { ok: false, error: 'host:port is not supported: submit the bare host or a full http(s) URL' };
    }
    if (IPV6_CHARS_RE.test(s)) return classifyIPv6(s);
  }

  if (/^[\d.]+$/.test(s)) return classifyIPv4(s);

  if (s.includes('@')) {
    const domain = s.slice(s.lastIndexOf('@') + 1);
    return {
      ok: false,
      error: `Email addresses are not supported${domain ? `: submit the domain '${domain}' instead` : ''}`,
    };
  }

  if (/[/?#\\]/.test(s)) {
    return { ok: false, error: 'Looks like a URL without a scheme: add http:// or https://' };
  }

  if (s.includes('.') || s.includes('\u3002') || s.includes('\uff0e')) {
    return classifyDomain(s, domainOptions);
  }

  return {
    ok: false,
    error: 'Unrecognized indicator: expected an IP address, MD5/SHA-1/SHA-256 hash, domain, or http(s) URL',
  };
}
