// dist/chat.css: Tailwind v4 → isolate (scope + namespace) → audit (fail on any leak) → minify.
// dist/chat-css.js: the same bytes as a JS string, for injectTalk2ViewChatStyles().
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

mkdirSync('dist', { recursive: true });
execFileSync('npx', ['@tailwindcss/cli', '-i', 'src/chat/styles/chat.src.css', '-o', 'dist/chat.raw.css'], { stdio: 'inherit' });
execFileSync('node', ['scripts/chat/isolate.mjs', 'dist/chat.raw.css', 'dist/chat.isolated.css', '--flatten-layers', '--armour'], { stdio: 'inherit' });
execFileSync('node', ['scripts/chat/audit.mjs', 'dist/chat.isolated.css'], { stdio: 'inherit' });
execFileSync('node', ['scripts/chat/minify.mjs', 'dist/chat.isolated.css', 'dist/chat.css'], { stdio: 'inherit' });
// Again on the SHIPPED bytes. Minification is not a no-op on what the audit
// checks — it merges and drops rules — so the file a partner actually loads has
// to be the one that passes.
execFileSync('node', ['scripts/chat/audit.mjs', 'dist/chat.css'], { stdio: 'inherit' });
const css = readFileSync('dist/chat.css', 'utf8');
writeFileSync('dist/chat-css.js', `export const css = ${JSON.stringify(css)};\n`);
writeFileSync('dist/chat-css.d.ts', 'export declare const css: string;\n');
console.log(`dist/chat.css ${css.length} bytes (${zlib.gzipSync(css, { level: 9 }).length} gzip)`);
