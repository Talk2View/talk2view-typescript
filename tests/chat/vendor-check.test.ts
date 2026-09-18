/**
 * assistant-ui's registry is unversioned and mutable — HEAD moved the same day
 * the research fetched it — so the vendored copies are pinned by content hash
 * and refreshed by a script. These are the properties that make the vendored
 * tree publishable: it resolves without the app's aliases, it never drags a CSS
 * import into dist (Word's webpack has no CSS rule), and it never reaches the
 * network for a font.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('vendored assistant-ui components', () => {
  it('match the manifest (hash of upstream bytes + our patches)', () => {
    expect(() => execFileSync('node', ['scripts/chat/check.mjs'], { stdio: 'pipe' })).not.toThrow();
  });

  it('import nothing through app aliases or CSS', () => {
    for (const f of readdirSync('src/chat/vendor').filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))) {
      const src = readFileSync(`src/chat/vendor/${f}`, 'utf8');
      expect(src, f).not.toMatch(/from ["']@\//);
      expect(src, f).not.toMatch(/import ["'][^"']+\.css["']/);
      expect(src, f).not.toMatch(/asChild/);
    }
  });

  it('never fetch fonts or anything else from the network', () => {
    for (const f of readdirSync('src/chat/vendor')) {
      expect(readFileSync(`src/chat/vendor/${f}`, 'utf8'), f).not.toMatch(/fonts\.googleapis|https?:\/\/cdn/);
    }
  });
});
