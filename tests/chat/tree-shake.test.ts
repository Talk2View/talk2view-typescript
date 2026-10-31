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
 * The size assertions are REGRESSION FENCES, not budgets. Each was set at the
 * measured size plus roughly ten per cent, and what is left of that headroom is
 * what the code has not grown into (core's is 0.15 KB: see its test). They exist
 * so that a change which doubles the bundle fails here instead of in a partner's
 * app. When a fence trips, measure first and decide whether the growth is
 * wanted — do not widen it reflexively.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';

// Measured on 2026-10-09 for 0.21.4, with code splitting, up-front chunks only;
// `core` again on 2026-10-22 for 0.23.0, at 38.0 / 11.85 KB, and `chat` on
// 2026-10-25 for 0.24.0, with call captions, at 1201.1 / 374.53 KB (0.21.4:
// 37.1 / 11.51 and 1197.8 / 373.32; 0.22.0: core 11.73 gzip; 0.23.0: chat
// 1199.5 / 373.91).
// These are the numbers the README and docs/chat.md quote; change them together.
// Previously 11.14 / 40.25 / 372.38 KB gzip (2026-09-24, after the voice agent
// landed behind a lazy facade), and before that 9.35 / 39.93 / 361.77
// (2026-09-18, no splitting).
const MEASURED = {
  core: { raw: 38.0, gzip: 11.85 },
  ui: { raw: 124.4, gzip: 40.94 },
  chat: { raw: 1201.1, gzip: 374.53 },
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
  /** What the page loads up front: the entry chunk plus the chunks it statically imports. */
  code: string;
  rawKB: number;
  gzipKB: number;
  /** npm package names in the up-front chunks, e.g. `@assistant-ui/react`. */
  packages: Set<string>;
  /** npm package names that only arrive through a dynamic `import()` (lazy chunks). */
  lazyPackages: Set<string>;
  /** Input files (repo-relative, e.g. `dist/voice.js`) in the up-front chunks. */
  modules: Set<string>;
  /** Input files that only arrive in lazy chunks. */
  lazyModules: Set<string>;
}

function packagesOf(inputs: Record<string, unknown>): Set<string> {
  const packages = new Set<string>();
  for (const file of Object.keys(inputs)) {
    const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(file);
    if (match) packages.add(match[1]!);
  }
  return packages;
}

async function bundle(entry: string): Promise<Bundled> {
  const result = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    // Code splitting, as Vite and webpack do: a dynamic `import()` becomes its
    // own chunk that loads on demand (the voice agent's Pipecat libraries).
    splitting: true,
    outdir: 'tree-shake-out', // never written (write: false); esbuild needs it to split
    write: false,
    metafile: true,
    alias,
    // React is a peer dependency: every consumer already has it, and counting
    // it here would measure React, not us.
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    logLevel: 'silent',
  });

  const outputs = result.metafile.outputs;
  const entryChunk = Object.keys(outputs).find((name) => outputs[name]!.entryPoint === '<stdin>')!;
  // The up-front set: the entry chunk and whatever it statically imports.
  const upFront = new Set<string>();
  const visit = (name: string): void => {
    if (upFront.has(name)) return;
    upFront.add(name);
    for (const imp of outputs[name]!.imports) {
      if (imp.kind === 'import-statement' && !imp.external) visit(imp.path);
    }
  };
  visit(entryChunk);

  const text = new Map(
    result.outputFiles.map((f) => [path.relative(process.cwd(), f.path), f.text] as const),
  );
  const code = [...upFront].map((name) => text.get(name)!).join('\n');
  const packages = new Set<string>();
  const lazyPackages = new Set<string>();
  const modules = new Set<string>();
  const lazyModules = new Set<string>();
  for (const [name, output] of Object.entries(outputs)) {
    for (const pkg of packagesOf(output.inputs)) {
      (upFront.has(name) ? packages : lazyPackages).add(pkg);
    }
    for (const file of Object.keys(output.inputs)) {
      (upFront.has(name) ? modules : lazyModules).add(file);
    }
  }

  return {
    code,
    rawKB: Buffer.byteLength(code) / 1024,
    gzipKB: gzipSync(code).length / 1024,
    packages,
    lazyPackages,
    modules,
    lazyModules,
  };
}

/**
 * The voice agent's WebRTC stacks, Gemini Live's (Pipecat and Daily) and
 * ElevenLabs' (its client and LiveKit): allowed only in lazy chunks.
 */
const isVoiceStack = (p: string): boolean =>
  p.startsWith('@pipecat-ai/') ||
  p.startsWith('@daily-co/') ||
  p.startsWith('@elevenlabs/') ||
  p === 'livekit-client';

const sizes: string[] = [];
function record(name: string, b: Bundled) {
  sizes.push(
    `${name.padEnd(14)} raw ${b.rawKB.toFixed(1).padStart(7)} KB   gzip ${b.gzipKB.toFixed(2).padStart(7)} KB`,
  );
}

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

      // The voice agent's WebRTC stack loads on `t2v.voice.start()`, never up front.
      expect([...core.packages].filter(isVoiceStack)).toEqual([]);
      expect(core.code).not.toContain('@pipecat-ai');
      expect([...core.lazyPackages].some((p) => p.startsWith('@pipecat-ai'))).toBe(true);
      // So does the voice controller: core carries only the thin `t2v.voice`
      // facade (dist/voice-facade.js), which import()s dist/voice.js on start().
      expect(core.modules.has('dist/voice.js')).toBe(false);
      expect(core.lazyModules.has('dist/voice.js')).toBe(true);
      // An ElevenLabs call's module and its library load on the first ElevenLabs
      // call: a Gemini Live call, and a page that never starts one, load neither.
      expect([...core.lazyPackages].some((p) => p === '@elevenlabs/client')).toBe(true);
      expect(core.code).not.toContain('@elevenlabs');
      expect(core.modules.has('dist/voice-elevenlabs.js')).toBe(false);
      expect(core.lazyModules.has('dist/voice-elevenlabs.js')).toBe(true);

      expect(core.rawKB).toBeLessThan(40);
      // Fence, not a budget: 12 KB gzip against the 11.85 KB measured on
      // 2026-10-22, which leaves 0.15 KB. The headroom is spent, so the next
      // change to core trips this: re-base the fence then, with a date, rather
      // than widening it by reflex. The `t2v.voice` facade (~1.6 KB gzip) is in
      // core; the voice controller and the voice libraries stay lazy chunks
      // (asserted above).
      expect(core.gzipKB).toBeLessThan(12);
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
      // Neither voice stack is up front here either.
      expect([...ui.packages].filter(isVoiceStack)).toEqual([]);

      // `/ui` is the older panel and is not growing; the fence is loose enough
      // that a bug fix does not trip it and tight enough to catch a new
      // dependency. Measured 40.25 KB gzip.
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
      // The voice agent's WebRTC stack stays lazy here too.
      expect([...chat.packages].filter(isVoiceStack)).toEqual([]);

      // 374.53 KB gzip measured on 2026-10-25, with call captions (373.91 on
      // 2026-10-22, 372.18 earlier, 369.18 before <VoiceButton>), excluding
      // React (a peer) and the host app.
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
