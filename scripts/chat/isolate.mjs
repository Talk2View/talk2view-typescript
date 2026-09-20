// Post-process a Tailwind v4 build into a stylesheet that cannot touch the host
// page and that the host page has trouble breaking.
//
//   node scripts/isolate.mjs <in.css> <out.css> [--root .t2v-chat] [--flatten-layers]
//                            [--no-scope-utilities] [--keep-keyframe-names]
//
// Transforms applied, in order:
//   1. rename internal --tw-*      -> --t2v-tw-*      (host Tailwind v3/v4 collision)
//   2. rename our @keyframes NAMES -> t2v-<name>      (global keyframe namespace)
//   3. :root/:host                 -> ROOT
//   4. preflight (@layer base)     -> scoped to ROOT and ROOT *
//   5. every other selector        -> "ROOT " + selector   (descendant scoping)
//   6. optionally strip @layer wrappers so our rules sit in the unlayered origin
import postcss from "postcss";
import fs from "node:fs";
import { splitTopLevel } from "./split.mjs";

const [, , inFile, outFile, ...rest] = process.argv;
const opt = (n, d) => {
  const i = rest.indexOf(n);
  return i === -1 ? d : rest[i + 1];
};
const ROOT = opt("--root", ".t2v-chat");
const FLATTEN = rest.includes("--flatten-layers");
const SCOPE_UTILS = !rest.includes("--no-scope-utilities");
const RENAME_KF = !rest.includes("--keep-keyframe-names");
const ARMOUR = rest.includes("--armour");

let css = fs.readFileSync(inFile, "utf8");

// 1. internal variable namespace -------------------------------------------
css = css.replaceAll("--tw-", "--t2v-tw-");

const root = postcss.parse(css, { from: inFile });

// 2. keyframe namespace ------------------------------------------------------
const kfNames = new Set();
root.walkAtRules(/^(-\w+-)?keyframes$/, (r) => kfNames.add(r.params.trim().replace(/^["']|["']$/g, "")));
if (RENAME_KF) {
  for (const name of kfNames) {
    if (name.startsWith("t2v-")) continue;
    const re = new RegExp(`(^|[\\s,"'(])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s,"')])`, "g");
    root.walkAtRules(/^(-\w+-)?keyframes$/, (r) => {
      if (r.params.trim() === name) r.params = `t2v-${name}`;
    });
    root.walkDecls((d) => {
      if (/^(animation|animation-name|--animate-[\w-]+|--t2v-tw-animation[\w-]*)$/.test(d.prop) || d.prop.startsWith("--animate")) {
        d.value = d.value.replace(re, (m, a, b) => `${a}t2v-${name}${b}`);
      }
    });
  }
}

// 2b. namespace every @property registration -------------------------------
//     A global @property is a document-wide registration: if the host page
//     registers the same name with a different syntax, the last one wins and
//     one of the two breaks. Rename anything not already ours.
const propRenames = new Map();
root.walkAtRules("property", (r) => {
  const name = r.params.trim();
  if (name.startsWith("--t2v-")) return;
  propRenames.set(name, `--t2v-${name.replace(/^--/, "")}`);
});
if (propRenames.size) {
  const out = root.toString();
  let next = out;
  for (const [from, to] of propRenames) {
    next = next.replaceAll(from, to);
  }
  root.removeAll();
  root.append(postcss.parse(next, { from: inFile }).nodes);
}

// selector rewriting ---------------------------------------------------------
const GLOBAL_ROOTS = /^(:root|:host|html|body|:where\(:root\)|:where\(html\))$/;

function scopeSelector(sel, { preflight }) {
  return splitTopLevel(sel)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => {
      // Nested rule: `&` already resolves against an ancestor we scoped.
      if (p.startsWith("&")) return [p];
      if (GLOBAL_ROOTS.test(p)) return [ROOT];
      // `:root.dark` / `html[data-theme=x]`: a compound ON the root, not a
      // descendant of it. The source sheet uses this to let an integrator put
      // `dark` on the chat element itself as well as on a container.
      const compound = /^(?::root|:host|html|body)((?:[.#:[][^\s>+~]*)+)$/.exec(p);
      if (compound) return [`${ROOT}${compound[1]}`];
      if (p === "*" || p === ":where(*)") return preflight ? [ROOT, `${ROOT} *`] : [`${ROOT} *`];
      if (/^::(after|before|backdrop|file-selector-button|placeholder|selection|-webkit-[\w-]+)$/.test(p))
        return [`${ROOT} ${p}`];
      // `html X` / `body X` -> ROOT X  (preflight has a couple of these)
      const stripped = p.replace(/^(html|body)\s+/, "");
      return [`${ROOT} ${stripped}`];
    })
    .join(", ");
}

function walkRules(container, { preflight }) {
  container.each((node) => {
    if (node.type === "rule") {
      node.selector = scopeSelector(node.selector, { preflight });
    } else if (node.type === "atrule") {
      if (/^(-\w+-)?keyframes$/.test(node.name)) return; // keyframe selectors are 0%/to
      if (node.name === "property") return; // global by spec, already namespaced
      if (node.name === "font-face") return;
      walkRules(node, { preflight });
    }
  });
}

root.each((node) => {
  if (node.type === "atrule" && node.name === "layer" && node.nodes) {
    const layer = node.params.trim();
    if (layer === "base") walkRules(node, { preflight: true });
    else if (layer === "theme") walkRules(node, { preflight: false });
    else if (SCOPE_UTILS) walkRules(node, { preflight: false });
  } else if (node.type === "rule") {
    node.selector = scopeSelector(node.selector, { preflight: false });
  } else if (node.type === "atrule" && node.nodes && !/^(-\w+-)?keyframes$|^property$|^font-face$/.test(node.name)) {
    walkRules(node, { preflight: false });
  }
});

// 5a. Custom properties are never !important, whoever wrote them.
//     A partner rethemes the chat by declaring a token on `.t2v-chat`, and an
//     !important declaration inside our own sheet would make that impossible.
//     Upstream does write them: attachment.aui.tsx carries `[&>button]:ring-0!`,
//     which makes Tailwind emit `--tw-ring-shadow: … !important`. The paint in
//     that rule is `box-shadow`, which armour keeps important, so dropping the
//     flag from the variable costs nothing and keeps the invariant absolute.
let unimportant = 0;
root.walkDecls((d) => {
  if (d.prop.startsWith("--") && d.important) {
    d.important = false;
    unimportant++;
  }
});

// 5b. armour: mark utility declarations !important so a host's own !important
//     utility classes (Bootstrap ships 1716 of them) cannot win.
if (ARMOUR) {
  const armourContainer = (c) => {
    c.walkDecls((d) => {
      if (d.prop.startsWith("--")) return;   // custom properties: leave alone
      d.important = true;
    });
  };
  root.each((node) => {
    if (node.type === "atrule" && node.name === "layer" && node.nodes) {
      const l = node.params.trim();
      if (l === "utilities" || l === "components") armourContainer(node);
    }
  });
}

// 6. flatten layers ----------------------------------------------------------
if (FLATTEN) {
  root.walkAtRules("layer", (r) => {
    if (!r.nodes) r.remove();
    else r.replaceWith(r.nodes);
  });
}

fs.writeFileSync(outFile, root.toString());
console.log(
  `${outFile}  root=${ROOT} flatten=${FLATTEN} scopeUtils=${SCOPE_UTILS} keyframes=${kfNames.size} unimportant-vars=${unimportant}`,
);
