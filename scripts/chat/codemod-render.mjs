// asChild -> render, the Base UI flavour of the same idea.
//
// This is NOT a Talk2View customisation: upstream is mid-migration and most of
// its registry already ships `render` (attachment.aui, tooltip-icon-button).
// Only thread.aui and thread-list.aui still ship `asChild`,
// and our ui/button is @base-ui/react/button, which has no asChild prop at all.
// So this is a flavour fix that must become a no-op the day upstream finishes.
//
//   <Trigger asChild><Button x>kids</Button></Trigger>
//     becomes
//   <Trigger render={<Button x />}>kids</Trigger>
//
//   node scripts/chat/codemod-render.mjs src/chat/vendor
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const dir = process.argv[2] ?? 'src/chat/vendor';
const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

/** The one JSX element among a node's children, if there is exactly one and no other content. */
function soleElementChild(children) {
  const meaningful = children.filter((c) => {
    if (ts.isJsxText(c)) return c.text.trim().length > 0;
    return true;
  });
  if (meaningful.length !== 1) return null;
  const only = meaningful[0];
  return ts.isJsxElement(only) || ts.isJsxSelfClosingElement(only) ? only : null;
}

let converted = 0;
for (const name of files) {
  const source = readFileSync(`${dir}/${name}`, 'utf8');
  const sf = ts.createSourceFile(`${dir}/${name}`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // Collect edits innermost-last so nested conversions stay consistent, then
  // apply them back to front against the original text.
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxElement(node)) {
      const open = node.openingElement;
      const asChild = open.attributes.properties.find(
        (p) => ts.isJsxAttribute(p) && ts.isIdentifier(p.name) && p.name.text === 'asChild',
      );
      const child = asChild ? soleElementChild(node.children) : null;
      if (asChild && child) {
        const childOpen = ts.isJsxElement(child) ? child.openingElement : child;
        const tag = childOpen.tagName.getText(sf);
        const attrs = childOpen.attributes.getText(sf);
        const renderEl = `<${tag}${attrs ? ' ' + attrs : ''} />`;
        const kids = ts.isJsxElement(child)
          ? source.slice(child.openingElement.end, child.closingElement.getStart(sf))
          : '';
        // The attribute itself: asChild -> render={<Child … />}
        edits.push({ start: asChild.getStart(sf), end: asChild.end, text: `render={${renderEl}}` });
        // The body: the wrapper's children become the child's children.
        edits.push({
          start: node.openingElement.end,
          end: node.closingElement.getStart(sf),
          text: kids,
        });
        converted++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) continue;
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  writeFileSync(`${dir}/${name}`, out);
  console.log(`codemod ${name}`);
}

// Idempotence is the whole point: assert nothing is left, so a re-run or an
// upstream that has finished migrating both end at zero rather than double-wrapping.
const remaining = files
  .map((f) => [f, (readFileSync(`${dir}/${f}`, 'utf8').match(/\basChild\b/g) ?? []).length])
  .filter(([, n]) => n > 0);
console.log(`codemod: converted ${converted} site(s), ${remaining.length} file(s) still using asChild`);
if (remaining.length) {
  for (const [f, n] of remaining) console.error(`  ${f}: ${n} remaining`);
  process.exit(1);
}
