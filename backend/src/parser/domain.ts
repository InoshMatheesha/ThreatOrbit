import { domainToASCII, domainToUnicode } from 'node:url';
import { parse as parseTld } from 'tldts';
import type { ClassifyOutcome } from './types.js';

const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
// Underscores are not valid in hostnames but do appear in real DNS names used by malware.
const LABEL_RE = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;
const TLD_RE = /^(?:[a-z][a-z0-9-]*|xn--[a-z0-9-]+)$/;
const INVISIBLE_RE = /\p{Cf}/u;
const CONTROL_OR_SPACE_RE = /[\u0000-\u0020\u007f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;
const LATIN_RE = /\p{Script=Latin}/u;
const LOOKALIKE_SCRIPT_RE = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
// Real TLDs that collide with common file extensions (readme.md, setup.py, update.zip).
const FILE_EXTENSION_TLDS = new Set(['zip', 'mov', 'md', 'py', 'sh', 'rs', 'pl', 'ps', 'cs', 'ws', 'so']);

export interface DomainOptions {
  /**
   * Reject names whose suffix is not on the public suffix list. Used in free-text
   * extraction so tokens like `e.g` or `file.exe` are not picked up as domains.
   */
  requirePublicSuffix?: boolean;
}

export function classifyDomain(input: string, options: DomainOptions = {}): ClassifyOutcome {
  let raw = input;
  if (raw.endsWith('.')) raw = raw.slice(0, -1); // fully-qualified form, e.g. "example.com."
  if (!raw) return { ok: false, error: 'Empty domain name' };
  if (CONTROL_OR_SPACE_RE.test(raw)) {
    return { ok: false, error: 'Domain contains whitespace or control characters' };
  }

  // WHATWG treats an all-numeric final label as a failed IPv4 parse; give a clearer error.
  const lastLabel = raw.split(/[.\u3002\uff0e\uff61]/).pop() ?? '';
  if (/^\d+$/.test(lastLabel)) {
    return { ok: false, error: `Invalid top-level domain '${lastLabel}': top-level domains cannot be numeric` };
  }

  const notes: string[] = [];
  const isAscii = /^[\x00-\x7f]*$/.test(raw);

  // UTS #46 processing (the same mapping browsers use). Local only, no DNS.
  const ascii = domainToASCII(raw);
  if (!ascii) {
    return { ok: false, error: 'Invalid internationalized domain name (IDNA conversion failed)' };
  }
  if (INVISIBLE_RE.test(raw)) {
    notes.push('Invisible formatting characters (e.g. zero-width space) were removed during IDNA normalization');
  }

  if (ascii.length > MAX_DOMAIN_LENGTH) {
    return { ok: false, error: `Domain exceeds ${MAX_DOMAIN_LENGTH} characters` };
  }
  const labels = ascii.split('.');
  if (labels.length < 2) {
    return { ok: false, error: 'Domain must contain at least two labels (e.g. example.com)' };
  }
  for (const label of labels) {
    if (!label) return { ok: false, error: 'Domain contains an empty label (consecutive dots)' };
    if (label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: `Domain label exceeds ${MAX_LABEL_LENGTH} characters` };
    }
    if (!LABEL_RE.test(label)) {
      return { ok: false, error: `Invalid domain label '${label}'` };
    }
  }
  const tld = labels[labels.length - 1]!;
  if (!TLD_RE.test(tld)) {
    return { ok: false, error: `Invalid top-level domain '${tld}'` };
  }

  let display: string | undefined;
  if (!isAscii || labels.some((l) => l.startsWith('xn--'))) {
    display = domainToUnicode(ascii);
    if (display !== ascii) {
      notes.push(`Internationalized domain, displayed as "${display}"`);
      if (display.split('.').some((l) => LATIN_RE.test(l) && LOOKALIKE_SCRIPT_RE.test(l))) {
        notes.push('Mixes Latin with Cyrillic or Greek letters: possible homograph of a well-known domain');
      }
    } else {
      display = undefined;
    }
  } else if (raw !== ascii && raw.toLowerCase() !== ascii) {
    notes.push('Unicode characters were normalized to ASCII');
  }

  if (labels.length === 2 && FILE_EXTENSION_TLDS.has(tld)) {
    notes.push(`'.${tld}' is also a common file extension: confirm this is a domain and not a filename`);
  }

  const tldInfo = parseTld(ascii);
  let lookupEligible = true;
  if (!tldInfo.isIcann) {
    if (options.requirePublicSuffix) {
      return { ok: false, error: `'.${tld}' is not a public top-level domain` };
    }
    lookupEligible = false;
    notes.push(`'.${tld}' is not a public top-level domain (internal or special-use): kept local, not sent to providers`);
  } else if (!tldInfo.domain) {
    lookupEligible = false;
    notes.push('This is a public suffix (like co.uk), not a registrable domain: not sent to providers');
  }

  return { ok: true, type: 'domain', normalized: ascii, lookupEligible, notes, ...(display ? { display } : {}) };
}
