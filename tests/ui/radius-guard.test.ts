import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Tests run with the repository root as the working directory (see vitest.config.ts).
const componentsDir = join(process.cwd(), 'src/ui/components');

describe('radius regression guard', () => {
  it('no UI source uses the invalid calc(length * length) radius pattern', () => {
    const files = readdirSync(componentsDir).filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(componentsDir, f), 'utf8');
      expect(src, `${f} still contains a length*length radius expression`)
        .not.toMatch(/--t2v-radius\)\s*\*\s*[\d.]+px/);
    }
  });
});
