import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/**
 * `.env.example` is committed, so a key pasted into it ends up in git history for good
 * (and in GitHub secret-scanning alerts). Real values belong in `backend/.env`, which is ignored.
 */
describe('committed files hold no secrets', () => {
  it('backend/.env.example leaves every secret blank', () => {
    const filled = read('backend/.env.example')
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith('#'))
      .map((line) => /^\s*([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|AUTH)[A-Z0-9_]*)\s*=\s*(\S+)/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]);
    expect(filled, `Fill these in backend/.env (ignored by git), not in .env.example: ${filled.join(', ')}`).toEqual([]);
  });

  it('the example file, README and API docs contain no long key-like strings', () => {
    for (const file of ['backend/.env.example', 'README.md', 'docs/API.md']) {
      const text = read(file);
      expect(text.match(/(?<![0-9a-zA-Z])[0-9a-f]{40,}(?![0-9a-zA-Z])/gi) ?? [], `${file} contains a long hex string`).toEqual([]);
      expect(text.match(/\b(?:sk-ant-|AIza|ghp_|AKIA)[A-Za-z0-9_-]{16,}/g) ?? [], `${file} contains an API key`).toEqual([]);
    }
  });
});
