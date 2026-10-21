import ipaddr from 'ipaddr.js';
import type { ClassifyOutcome } from './types.js';

const RANGE_LABELS: Record<string, string> = {
  private: 'Private (RFC 1918)',
  loopback: 'Loopback',
  linkLocal: 'Link-local',
  carrierGradeNat: 'Carrier-grade NAT (RFC 6598)',
  multicast: 'Multicast',
  broadcast: 'Broadcast',
  unspecified: 'Unspecified',
  reserved: 'Reserved or documentation',
  uniqueLocal: 'Unique local (fc00::/7)',
  ipv4Mapped: 'IPv4-mapped IPv6',
  benchmarking: 'Benchmarking (RFC 2544)',
};

function rangeNote(range: string): string {
  const label = RANGE_LABELS[range] ?? `Special-purpose (${range})`;
  return `${label} address: kept local, not sent to threat intel providers`;
}

export function classifyIPv4(input: string): ClassifyOutcome {
  const parts = input.split('.');
  if (parts.length !== 4) {
    return { ok: false, error: 'Invalid IPv4 address: expected four dot-separated octets' };
  }
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return { ok: false, error: `Invalid IPv4 address: octet '${part}' is not a decimal number` };
    }
    // Leading zeros are read as octal by some tools (010 == 8), so the meaning is ambiguous.
    if (part.length > 1 && part.startsWith('0')) {
      return {
        ok: false,
        error: `Invalid IPv4 address: octet '${part}' has a leading zero, which is ambiguous (may be read as octal)`,
      };
    }
    if (Number(part) > 255) {
      return { ok: false, error: `Invalid IPv4 address: octet '${part}' is out of range (0-255)` };
    }
  }

  const addr = ipaddr.IPv4.parse(input);
  const range = addr.range();
  const lookupEligible = range === 'unicast';
  return {
    ok: true,
    type: 'ipv4',
    normalized: addr.toString(),
    lookupEligible,
    notes: lookupEligible ? [] : [rangeNote(range)],
  };
}

export function classifyIPv6(input: string): ClassifyOutcome {
  if (input.includes('%')) {
    return { ok: false, error: 'IPv6 zone identifiers (e.g. %eth0) are not supported' };
  }
  if (!ipaddr.IPv6.isValid(input)) {
    return { ok: false, error: 'Invalid IPv6 address' };
  }

  const addr = ipaddr.IPv6.parse(input);
  const range = addr.range();
  const lookupEligible = range === 'unicast';
  const notes = lookupEligible ? [] : [rangeNote(range)];

  // RFC 5952 canonical text form. IPv4-mapped addresses keep their dotted tail
  // (RFC 5952 section 5) and stay IPv6: they are not merged with the plain IPv4 address.
  let normalized: string;
  if (addr.isIPv4MappedAddress()) {
    const v4 = addr.toIPv4Address().toString();
    normalized = `::ffff:${v4}`;
    notes.push(`Embeds the IPv4 address ${v4}; submit it separately to look it up`);
  } else {
    normalized = addr.toRFC5952String();
  }

  return { ok: true, type: 'ipv6', normalized, lookupEligible, notes };
}
