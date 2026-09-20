// @vitest-environment node
//
// esbuild refuses to run under jsdom: jsdom's `TextEncoder` does not produce a
// real `Uint8Array`, and esbuild checks for that on import.
/**
 * What a partner pays for `@talk2view/sdk` when they never import the chat.
 *
 * `/chat` pulls in `@assistant-ui/react`, `@base-ui/react` and their markdown
 * stack — a few hundred kilobytes. Those are real `dependencies` of the
 * package, so the only thing standing between a partner who imports
 * `Talk2View` and all of that weight is the entry-point split plus
 * `sideEffects`. Nothing in `tsc` or the build checks that, and the failure is
 * silent: the SDK still works, it is just suddenly an order of magnitude
 * bigger.
 *
 * So bundle the published `dist/` the way a partner's bundler would and look
 * at what comes out. The module graph (esbuild's metafile) is the real
 * evidence; the string scan is a second opinion that does not depend on the
 * graph being read correctly.
 *
 * The size assertions are REGRESSION FENCES, not budgets. Each is the measured
 * size plus roughly ten per cent. They exist so that a change which doubles the
 * bundle fails here instead of in a partner's app. When a fence trips, measure
 * first and decide whether the growth is wanted — do not widen it reflexively.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Measured on 2026-09-18 at commit b0c74b0 + Task 7, Node 20, esbuild 0.27.3.
const MEASURED = {
  core: { raw: 30.1, gzip: 9.35 },
  ui: { raw: 122.6, gzip: 39.93 },
  chat: { raw: 1160.0, gzip: 361.77 },
};

/**
 * The published entry points, resolved to `dist/`. A partner writes
 * `@talk2view/sdk`; esbuild has no workspace link to follow, so the alias does
 * what their node_modules would.
 */
const alias = {
  '@talk2view/sdk': path.resolve('dist/index.js'),
  '@talk2view/sdk/react': path.resolve('dist/react/index.js'),
  '@talk2view/sdk/ui': path.resolve('dist/ui/index.js'),
  '@talk2view/sdk/assistant-ui': path.resolve('dist/assistant-ui/index.js'),
  '@talk2view/sdk/chat': path.resolve('dist/chat/index.js'),
  '@talk2view/sdk/chat-css': path.resolve('dist/chat-css.js'),
};

interface Bundled {
  code: string;
  rawKB: number;
  gzipKB: number;
  /** npm package names reachable in the module graph, e.g. `@assistant-ui/react`. */
  packages: Set<string>;
}

async function bundle(entry: string): Promise<Bundled> {
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
    metafile: true,
    alias,
    // React is a peer dependency: every consumer already has it, and counting
    // it here would measure React, not us.
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    logLevel: 'silent',
  });

  const code = result.outputFiles[0]!.text;
  const output = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]!]!;
  const packages = new Set<string>();
  for (const file of Object.keys(output.inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(file);
    if (match) packages.add(match[1]!);
  }

  return {
    code,
    rawKB: Buffer.byteLength(code) / 1024,
    gzipKB: gzipSync(code).length / 1024,
    packages,
  };
}

const sizes: string[] = [];
function record(name: string, b: Bundled) {
  sizes.push(
    `${name.padEnd(14)} raw ${b.rawKB.toFixed(1).padStart(7)} KB   gzip ${b.gzipKB.toFixed(2).padStart(7)} KB`,
  );
}

beforeAll(() => {
  // These bundle the build output, not the source. A clean checkout has none.
  if (!existsSync('dist/index.js') || !existsSync('dist/chat/index.js')) {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
  }
}, 600_000);

describe('what a consumer pays for the entry points they use', () => {
  it(
    'leaves the chat out of the core entry, and stays around ' +
      `${MEASURED.core.gzip} KB gzip (measured)`,
    async () => {
      const core = await bundle("import { Talk2View } from '@talk2view/sdk'; console.log(Talk2View);");
      record('core', core);

      // The module graph: nothing from the chat's dependency tree is reachable.
      expect([...core.packages].filter((p) => p.startsWith('@assistant-ui'))).toEqual([]);
      expect([...core.packages].filter((p) => p.startsWith('@base-ui'))).toEqual([]);
      // The bytes: a second opinion that does not depend on reading the graph.
      expect(core.code).not.toContain('@assistant-ui');
      expect(core.code).not.toContain('base-ui');

      expect(core.rawKB).toBeLessThan(40);
      // Fence, not a budget. Measured 9.35 KB gzip.
      expect(core.gzipKB).toBeLessThan(11);
    },
    120_000,
  );

  it(
    'leaves assistant-ui out of the previous chat panel at `/ui`, and stays around ' +
      `${MEASURED.ui.gzip} KB gzip (measured)`,
    async () => {
      const ui = await bundle("import { ChatPanel } from '@talk2view/sdk/ui'; console.log(ChatPanel);");
      record('/ui', ui);

      expect([...ui.packages].filter((p) => p.startsWith('@assistant-ui'))).toEqual([]);
      expect([...ui.packages].filter((p) => p.startsWith('@base-ui'))).toEqual([]);
      expect(ui.code).not.toContain('@assistant-ui');

      // `/ui` is the older panel and is not growing; the fence is loose enough
      // that a bug fix does not trip it and tight enough to catch a new
      // dependency. Measured 39.93 KB gzip.
      expect(ui.gzipKB).toBeLessThan(45);
    },
    120_000,
  );

  it(
    `costs ${MEASURED.chat.gzip} KB gzip at \`/chat\` (measured) — the fence is 400 KB`,
    async () => {
      const chat = await bundle(
        "import { Talk2ViewChat, Talk2ViewChatLauncher } from '@talk2view/sdk/chat';" +
          ' console.log(Talk2ViewChat, Talk2ViewChatLauncher);',
      );
      record('/chat', chat);

      // The chat is supposed to carry assistant-ui: this is the positive half,
      // so a refactor that quietly stops bundling it fails here too.
      expect([...chat.packages].some((p) => p.startsWith('@assistant-ui'))).toBe(true);
      expect([...chat.packages].some((p) => p.startsWith('@base-ui'))).toBe(true);

      // 361.77 KB gzip measured, excluding React (a peer) and the host app.
      // A page containing only the chat and React measures about 429 KB gzip.
      // Fence at 400 KB: loud on a regression, not a budget to shave against.
      expect(chat.gzipKB).toBeLessThan(400);
    },
    120_000,
  );

  // Informational: the numbers the fences above are set from, printed in one
  // place, so a reviewer reading a failure never has to guess what changed.
  afterAll(() => {
    if (sizes.length === 0) return;
    console.log(
      '\n  @talk2view/sdk entry points, bundled from dist/, React external:\n  ' +
        sizes.join('\n  ') +
        '\n',
    );
  });
});
