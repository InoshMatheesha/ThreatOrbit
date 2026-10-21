import { classifyIndicator } from './classify.js';
import { refang } from './refang.js';
import type { Candidate, ClassifyOutcome } from './types.js';

export interface ExtractedCandidate extends Candidate {
  outcome: Extract<ClassifyOutcome, { ok: true }>;
}

// Outer split keeps defang brackets like "evil[.]com" intact until refanged.
const OUTER_SPLIT_RE = /[\s"'`,;|<>]+/;
const INNER_SPLIT_RE = /[()[\]{}=]+/;
const URL_RE = /https?:\/\/[^\s"'`<>]+/gi;
const TRAILING_URL_PUNCT_RE = /[.,;:!?)\]}]+$/;
const EDGE_JUNK_START_RE = /^[^0-9a-z\u0080-\uffff]+/i;
const EDGE_JUNK_END_RE = /[^0-9a-z\u0080-\uffff]+$/i;
const HASH_PREFIX_RE = /^(?:md5|sha-?1|sha-?256)[:=]/i;

function cleanToken(token: string): string {
  let t = token.replace(HASH_PREFIX_RE, '');
  // IPv6 may start with "::", so only strip leading junk that isn't a colon pair.
  if (!t.startsWith('::')) t = t.replace(EDGE_JUNK_START_RE, '');
  return t.replace(EDGE_JUNK_END_RE, '');
}

/**
 * Pull recognisable indicators out of free text (emails, reports, chat logs).
 * Unlike strict line mode, anything unrecognised is silently ignored, and domains
 * must end in a public suffix so filenames like "invoice.exe" are not picked up.
 */
export function extractCandidates(lineText: string, line: number): ExtractedCandidate[] {
  const found: ExtractedCandidate[] = [];

  const consider = (original: string, value: string, refanged: boolean, extraNote?: string) => {
    if (!value) return;
    const outcome = classifyIndicator(value, { requirePublicSuffix: true });
    if (!outcome.ok) return;
    if (outcome.type === 'ipv6' && (value.match(/:/g)?.length ?? 0) < 2) return;
    if (extraNote) outcome.notes.unshift(extraNote);
    found.push({ line, original, value, refanged, outcome });
  };

  for (const original of lineText.split(OUTER_SPLIT_RE)) {
    if (!original) continue;
    const { value: token, changed: refanged } = refang(original);

    let rest = token;
    for (const match of token.matchAll(URL_RE)) {
      const url = match[0].replace(TRAILING_URL_PUNCT_RE, '');
      consider(original, url, refanged);
      rest = rest.replace(match[0], ' ');
    }

    for (const piece of rest.split(INNER_SPLIT_RE)) {
      const cleaned = cleanToken(piece);
      if (!cleaned) continue;
      if (cleaned.includes('@')) {
        const domain = cleanToken(cleaned.slice(cleaned.lastIndexOf('@') + 1));
        consider(original, domain, refanged, 'Extracted from an email address');
        continue;
      }
      consider(original, cleaned, refanged);
    }
  }

  return found;
}
