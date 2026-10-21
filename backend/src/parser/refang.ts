/**
 * Reverses common IOC "defanging" conventions used in threat reports so the
 * indicator can be classified, e.g. `hxxps://evil[.]com` -> `https://evil.com`.
 * Pure string manipulation; it never touches the network.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // hxxp / hXXp / h**p schemes, followed by ://, [:]// or [://]
  [/\bh(?:xx|\*\*)p(s?)(?=\[?:)/gi, 'http$1'],
  [/\[:\/\/\]/g, '://'],
  [/\[:\]/g, ':'],
  // [.] (.) {.} [dot] (dot) {dot}, with optional inner spaces
  [/\[\s*(?:\.|dot)\s*\]|\(\s*(?:\.|dot)\s*\)|\{\s*(?:\.|dot)\s*\}/gi, '.'],
  // [@] [at] (at)
  [/\[\s*(?:@|at)\s*\]|\(\s*(?:@|at)\s*\)/gi, '@'],
  // evil\.com
  [/\\\./g, '.'],
];

export function refang(input: string): { value: string; changed: boolean } {
  let value = input;
  for (const [pattern, replacement] of RULES) {
    value = value.replace(pattern, replacement);
  }
  return { value, changed: value !== input };
}
