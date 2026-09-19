// Refresh src/chat/vendor from assistant-ui's shadcn registry (Base UI flavour).
// The registry is unversioned and mutable — there is no version pinning in it at
// all and versioned URLs 404 — so every file's sha256 is recorded in
// MANIFEST.json and `check.mjs` refuses a tree that drifted.
//
//   node scripts/chat/sync-registry.mjs            # fetch + rewrite + codemod + patch
//   node scripts/chat/sync-registry.mjs --offline  # rewrite + codemod + patch only
//
// Vendored files are never hand-edited. Every difference from upstream is either
// a path rewrite below, the codemod, or scripts/chat/patches/*.patch.
//
// WHAT THE HASH PIN DOES NOT DO. MANIFEST.json's sha256 is recomputed from
// whatever this script just fetched, so it catches a hand-edited tree and
// nothing else. It is not a supply-chain control: the registry is an
// unversioned, mutable, third-party HTTP endpoint with no integrity metadata,
// and running `npm run chat:sync` accepts whatever it serves today. The only
// thing between the registry and the published package is a human reading the
// diff — so read it, every time, and never sync as part of a wider change where
// it will scroll past.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Item name -> the file it delivers. `reasoning` and `elements-reasoning` are two
// different items delivering reasoning.aui.tsx and reasoning.tsx; `file` and
// `image` are separate items that thread.aui.tsx imports.
// `assistant-modal` is deliberately absent: the launcher is re-authored as
// src/chat/launcher.tsx (a popover that survives an outside click, a phone
// sheet, a draggable panel, three colourways), so vendoring upstream's modal
// only added 404 lines to reconcile on every bump and a second localStorage
// key for the panel size. Put it back only if something imports it.
const ITEMS = [
  'thread',
  'thread-list',
  'attachment',
  'tool-fallback',
  'tool-group',
  'reasoning',
  'elements-reasoning',
  'markdown-text',
  'follow-up-suggestions',
  'tooltip-icon-button',
  'file',
  'image',
];
const OUT = 'src/chat/vendor';
const PATCHES = ['thread.aui.patch', 'thread-list.aui.patch', 'thread-list-chat.aui.patch'];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const sources = (dir) => readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));

mkdirSync(OUT, { recursive: true });
const OFFLINE = process.argv.includes('--offline');

// `upstreamSha256` means "what the registry served, after the path rewrites and
// before the codemod and patches". An offline run never talks to the registry,
// so it has no way to know that and must carry the recorded values forward —
// computing them from the already-codemodded files would quietly overwrite the
// one record of what upstream actually sent, which is the only provenance this
// vendoring has. Same for `fetchedAt`: nothing was fetched.
const previous = existsSync(`${OUT}/MANIFEST.json`)
  ? JSON.parse(readFileSync(`${OUT}/MANIFEST.json`, 'utf8'))
  : { fetchedAt: null, files: {} };
const manifest = OFFLINE
  ? { fetchedAt: previous.fetchedAt, files: {} }
  : { fetchedAt: new Date().toISOString(), files: {} };

if (!OFFLINE) {
  for (const item of ITEMS) {
    const res = await fetch(`https://r.assistant-ui.com/base/${item}.json`);
    if (!res.ok) throw new Error(`${item}: ${res.status}`);
    const json = await res.json();
    for (const f of json.files ?? []) {
      const name = f.path.split('/').pop();
      writeFileSync(`${OUT}/${name}`, f.content);
      console.log(`fetched ${name}`);
    }
  }
} else {
  console.log('offline: rewriting the files already in ' + OUT);
}

// App aliases -> our paths; CSS imports -> gone (folded into chat.src.css,
// because tsc emits `import "./x.css"` verbatim and Word's webpack cannot parse
// it); relative specifiers get the .js extension NodeNext requires.
for (const name of sources(OUT)) {
  let src = readFileSync(`${OUT}/${name}`, 'utf8');
  src = src
    .replaceAll('@/components/assistant-ui/elements/', './')
    .replaceAll('@/components/ui/', '../ui/')
    .replaceAll('@/hooks/', '../hooks/')
    .replaceAll('@/lib/utils', '../lib/cn')
    .replace(/^import ["'][^"']+\.css["'];?\n/gm, '')
    .replace(/(\bfrom\s*["'])(\.\.?\/[^"']+)(["'])/g, (m, a, spec, b) =>
      /\.(js|json|css)$/.test(spec) ? m : `${a}${spec}.js${b}`,
    );
  writeFileSync(`${OUT}/${name}`, src);
  manifest.files[name] = {
    upstreamSha256: OFFLINE ? previous.files?.[name]?.upstreamSha256 : sha256(src),
  };
}

execFileSync('node', ['scripts/chat/codemod-render.mjs', OUT], { stdio: 'inherit' });

// Point the two call sites at our MarkdownText wrapper (src/chat/markdown.tsx),
// which renders the vendored one with an `a` that opens in a new tab. Upstream
// renders `<MarkdownText />` with no components map and offers no other seam, so
// the import is the only place to reach it.
//
// A path rewrite rather than a patch, for the same reason as the rewrites above:
// there is no hunk to reconcile when upstream edits the file around it. Taken
// AFTER the upstream hash above, so `upstreamSha256` still records what the
// registry served.
//
// Like the patch step below, it has to tell "nothing to do because it is already
// done" apart from "nothing to do because the target is gone". The second is the
// failure worth shouting about — a silent no-op here puts every model-authored
// link back in the host's own tab — and the first is simply what `--offline`
// does, every time, over an already-rewritten tree.
const MARKDOWN_IMPORT = /(\bfrom\s*["'])\.\/markdown-text\.js(["'])/g;
const REDIRECTED = /\bfrom\s*["']\.\.\/markdown\.js["']/;
for (const name of ['thread.aui.tsx', 'reasoning.aui.tsx']) {
  const src = readFileSync(`${OUT}/${name}`, 'utf8');
  const next = src.replace(MARKDOWN_IMPORT, '$1../markdown.js$2');
  if (next === src && !REDIRECTED.test(src)) {
    throw new Error(
      `${name} no longer imports ./markdown-text.js — the target/rel override in ` +
        'src/chat/markdown.tsx has lost its call site. Find where markdown is rendered now.',
    );
  }
  writeFileSync(`${OUT}/${name}`, next);
}

// …and nothing else may reach the vendored renderer directly. The two names
// above are today's call sites; an upstream bump that adds a third would
// otherwise put that surface's links back in the host's own tab, silently.
for (const name of sources(OUT)) {
  if (name === 'markdown-text.tsx') continue;
  const src = readFileSync(`${OUT}/${name}`, 'utf8');
  if (MARKDOWN_IMPORT.test(src)) {
    MARKDOWN_IMPORT.lastIndex = 0;
    throw new Error(
      `${name} imports ./markdown-text.js directly. Upstream has added a markdown ` +
        'surface: add it to the redirect list above, or its links will navigate the ' +
        "partner's app away.",
    );
  }
  MARKDOWN_IMPORT.lastIndex = 0;
}

for (const patch of PATCHES) {
  const file = `scripts/chat/patches/${patch}`;
  const applied = (args) => {
    try {
      execFileSync('git', ['apply', '--check', ...args, '--directory', OUT, file], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
  if (applied([])) {
    execFileSync('git', ['apply', '--directory', OUT, file], { stdio: 'inherit' });
    console.log(`applied ${patch}`);
  } else if (applied(['--reverse'])) {
    console.log(`${patch} already applied`);
  } else {
    throw new Error(`${patch} does not apply — upstream moved under it; reconcile the hunk by hand`);
  }
}

for (const name of sources(OUT)) manifest.files[name].sha256 = sha256(readFileSync(`${OUT}/${name}`, 'utf8'));
writeFileSync(`${OUT}/MANIFEST.json`, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${OUT}/MANIFEST.json  ${Object.keys(manifest.files).length} files`);
