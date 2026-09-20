// Assert a compiled stylesheet cannot touch the host page.
// node scripts/audit.mjs dist/chat.flat.css [.t2v-chat]
import postcss from "postcss";
import fs from "node:fs";
import { splitTopLevel } from "./split.mjs";

const file = process.argv[2];
const ROOT = process.argv[3] ?? ".t2v-chat";
const css = fs.readFileSync(file, "utf8");
const root = postcss.parse(css, { from: file });

const problems = [];
const seen = { selectors: 0, keyframes: [], properties: [], fontFaces: 0, layers: new Set() };

root.walkAtRules((r) => {
  if (r.name === "layer") seen.layers.add(r.params.trim());
  if (/^(-\w+-)?keyframes$/.test(r.name)) seen.keyframes.push(r.params.trim());
  if (r.name === "property") seen.properties.push(r.params.trim());
  if (r.name === "font-face") seen.fontFaces++;
});

const inKeyframes = (n) => {
  for (let p = n.parent; p; p = p.parent)
    if (p.type === "atrule" && /^(-\w+-)?keyframes$/.test(p.name)) return true;
  return false;
};
const hasScopedAncestor = (n) => {
  for (let p = n.parent; p; p = p.parent)
    if (p.type === "rule" && p.selector.includes(ROOT)) return true;
  return false;
};
root.walkRules((rule) => {
  if (inKeyframes(rule)) return;
  seen.selectors++;
  if (hasScopedAncestor(rule)) return;
  for (const part of splitTopLevel(rule.selector).map((s) => s.trim())) {
    if (!part.includes(ROOT)) problems.push(`UNSCOPED SELECTOR: ${part}`);
  }
});

// custom properties that escape the root
root.walkDecls((d) => {
  if (!d.prop.startsWith("--")) return;
  const owner = d.parent;
  if (owner?.type !== "rule" || inKeyframes(owner) || hasScopedAncestor(owner)) return;
  if (!owner.selector.includes(ROOT))
    problems.push(`VAR ON UNSCOPED SELECTOR: ${owner.selector} { ${d.prop} }`);
});

// Theming has to keep working: a partner overrides a token by declaring it on
// `.t2v-chat`, and `!important` here would make that impossible. `--armour`
// puts `!important` on utility declarations only; this asserts it stayed there.
let importantVars = 0;
root.walkDecls((d) => {
  if (d.prop.startsWith("--") && d.important) {
    importantVars++;
    if (importantVars <= 10) problems.push(`!important ON CUSTOM PROPERTY: ${d.prop}`);
  }
});

// Tailwind's own internals are a shared namespace with any host running
// Tailwind: a v3 host sets --tw-ring-color on `*`, which reaches into us.
const twLeaks = (css.match(/(^|[^-\w])--tw-/g) ?? []).length;
if (twLeaks) problems.push(`UNRENAMED --tw-* VARIABLES: ${twLeaks} occurrence(s)`);

const globalKf = seen.keyframes.filter((k) => !k.startsWith("t2v-"));
const globalProp = seen.properties.filter((p) => !p.startsWith("--t2v-"));

console.log(`file            ${file}`);
console.log(`rules           ${seen.selectors}`);
console.log(`layers          ${[...seen.layers].join(", ") || "(none — unlayered)"}`);
console.log(`@font-face      ${seen.fontFaces}`);
console.log(`@keyframes      ${seen.keyframes.length} (${globalKf.length} outside the t2v- namespace)`);
if (globalKf.length) console.log(`  -> ${globalKf.join(", ")}`);
console.log(`@property       ${seen.properties.length} (${globalProp.length} outside the --t2v- namespace)`);
if (globalProp.length) console.log(`  -> ${globalProp.slice(0, 12).join(", ")}${globalProp.length > 12 ? " …" : ""}`);
console.log(`!important vars ${importantVars}`);
console.log(`--tw-* leaks    ${twLeaks}`);
console.log(`problems        ${problems.length}`);
for (const p of problems.slice(0, 25)) console.log("  " + p);
if (problems.length > 25) console.log(`  … ${problems.length - 25} more`);
process.exit(problems.length || globalKf.length || globalProp.length ? 1 : 0);
