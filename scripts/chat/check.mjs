// Verify the vendored tree is exactly what sync-registry.mjs produced.
//
// The registry serves mutable HEAD with no version pinning, so a content hash is
// the only way to know what we are shipping. This also enforces the properties
// that make the tree publishable at all.
//
//   node scripts/chat/check.mjs [dir]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2] ?? 'src/chat/vendor';
const manifestPath = `${dir}/MANIFEST.json`;
const problems = [];

if (!existsSync(manifestPath)) {
  console.error(`missing ${manifestPath} — run: npm run chat:sync`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const present = readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));

for (const name of present) {
  const entry = manifest.files[name];
  if (!entry) {
    problems.push(`UNTRACKED: ${name} is not in the manifest`);
    continue;
  }
  const actual = sha256(readFileSync(`${dir}/${name}`, 'utf8'));
  if (actual !== entry.sha256) {
    problems.push(`DRIFTED: ${name}\n    manifest ${entry.sha256}\n    on disk  ${actual}`);
  }
}
for (const name of Object.keys(manifest.files)) {
  if (!present.includes(name)) problems.push(`MISSING: ${name} is in the manifest but not on disk`);
}

// Properties a partner's build depends on, checked on the source rather than
// inferred from the hashes, so the message says what is wrong and not just that
// something changed.
for (const name of present) {
  const src = readFileSync(`${dir}/${name}`, 'utf8');
  if (/from ["']@\//.test(src)) problems.push(`APP ALIAS: ${name} imports through "@/", which only resolves inside an app`);
  if (/import ["'][^"']+\.css["']/.test(src)) problems.push(`CSS IMPORT: ${name} — tsc emits it verbatim and hosts without a CSS loader cannot parse it`);
  if (/\basChild\b/.test(src)) problems.push(`asChild: ${name} — the render codemod did not run, or upstream reintroduced it`);
  if (/fonts\.googleapis|https?:\/\/cdn/.test(src)) problems.push(`NETWORK: ${name} fetches from a third-party host`);
  for (const m of src.matchAll(/\bfrom\s*["'](\.\.?\/[^"']+)["']/g)) {
    if (!/\.(js|json)$/.test(m[1])) problems.push(`EXTENSIONLESS IMPORT: ${name} -> ${m[1]} (NodeNext needs the .js suffix)`);
  }
}

console.log(`dir             ${dir}`);
console.log(`files           ${present.length}`);
console.log(`fetched at      ${manifest.fetchedAt}`);
console.log(`problems        ${problems.length}`);
for (const p of problems) console.log('  ' + p);
if (problems.length) {
  console.log('\nvendored files are never hand-edited: re-run `npm run chat:sync`, or add a patch under scripts/chat/patches/.');
  process.exit(1);
}
