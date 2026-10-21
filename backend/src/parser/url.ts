import { classifyDomain } from './domain.js';
import { classifyIPv4, classifyIPv6 } from './ip.js';
import type { ClassifyOutcome } from './types.js';

export const MAX_URL_LENGTH = 2048;
export const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

/** Host part exactly as written, so silent numeric reinterpretation can be reported. */
function rawHost(input: string): string {
  const afterScheme = input.replace(SCHEME_RE, '');
  const authority = afterScheme.split(/[/?#\\]/, 1)[0] ?? '';
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) return hostPort.slice(0, hostPort.indexOf(']') + 1);
  return hostPort.replace(/:\d*$/, '');
}

export function classifyUrl(input: string): ClassifyOutcome {
  const scheme = SCHEME_RE.exec(input)?.[1]?.toLowerCase();
  if (!scheme) {
    return { ok: false, error: 'Malformed URL: expected "http://" or "https://"' };
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return { ok: false, error: `Unsupported URL scheme '${scheme}:': only http and https are supported` };
  }
  if (input.length > MAX_URL_LENGTH) {
    return { ok: false, error: `URL exceeds ${MAX_URL_LENGTH} characters` };
  }
  if (/\s/.test(input)) {
    return { ok: false, error: 'URL contains whitespace' };
  }

  // WHATWG URL Standard parser: pure string processing, no network access.
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: 'Malformed URL' };
  }
  if (!url.hostname) {
    return { ok: false, error: 'URL has no host' };
  }

  const notes: string[] = [];
  const host = url.hostname;
  let hostResult: ClassifyOutcome;
  if (host.startsWith('[')) {
    hostResult = classifyIPv6(host.slice(1, -1));
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    hostResult = classifyIPv4(host);
    const written = rawHost(input).toLowerCase();
    if (written !== host) {
      notes.push(`Numeric host '${written}' is interpreted as ${host} by the URL standard`);
    }
  } else {
    hostResult = classifyDomain(host);
  }
  if (!hostResult.ok) {
    return { ok: false, error: `Invalid URL host: ${hostResult.error}` };
  }
  notes.push(...hostResult.notes.map((n) => `Host: ${n}`));

  if (url.username || url.password) {
    notes.push('URL contains embedded credentials: review before sharing with third-party providers');
  }
  if (url.hash) {
    // Fragments are never sent to servers and often carry victim identifiers.
    notes.push('Fragment (#...) removed: it is never sent to web servers');
    url.hash = '';
  }

  return {
    ok: true,
    type: 'url',
    normalized: url.href,
    lookupEligible: hostResult.lookupEligible,
    notes,
    ...(hostResult.display ? { display: url.href.replace(host, hostResult.display) } : {}),
  };
}
