/**
 * Build `dist/` once, before any test file loads.
 *
 * Several suites read the build output: the bundle-size fence, the public
 * `.d.ts` surface, the CSS build and its inject fallback. They used to build it
 * themselves when it was missing, and test files run in parallel, so on a clean
 * checkout (CI runs the tests before the build step) two of them could run
 * `npm run build` at once, and one's `clean` would delete the other's output.
 * A module mock keyed on a built file also has to find that file when it is
 * registered, which is before any `beforeAll` runs.
 *
 * Building every time also means those suites check the source as it is now,
 * not whatever an earlier build left behind.
 */
import { execFileSync } from 'node:child_process';

export default function setup(): void {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
}
