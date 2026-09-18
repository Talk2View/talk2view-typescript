/**
 * The stylesheet a partner imports must be unable to touch their page and hard
 * for their page to break. These are the properties the audit script enforces;
 * this test pins that the BUILD output has them, so a change to the pipeline
 * cannot quietly ship an unscoped sheet.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, beforeAll } from 'vitest';
// @ts-expect-error -- plain .mjs build script, shared so the test splits selector
// lists exactly the way the audit does: on top-level commas only.
import { splitTopLevel } from '../../scripts/chat/split.mjs';

const css = () => readFileSync('dist/chat.css', 'utf8');

/**
 * Keyframe steps ("0%", "from", "to") are selectors too, but they name a moment
 * in an animation rather than an element, so they are never scoped. Drop the
 * whole block before looking for rules that could select the host page.
 */
const withoutKeyframes = (source: string): string => {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    if (!source.startsWith('@keyframes', i) && !/^@-\w+-keyframes/.test(source.slice(i, i + 20))) {
      out += source[i];
      continue;
    }
    const open = source.indexOf('{', i);
    if (open === -1) break;
    let depth = 0;
    let j = open;
    for (; j < source.length; j++) {
      if (source[j] === '{') depth++;
      else if (source[j] === '}' && --depth === 0) break;
    }
    i = j;
  }
  return out;
};

beforeAll(() => {
  execFileSync('node', ['scripts/chat/build-css.mjs'], { stdio: 'inherit' });
}, 120_000);

describe('dist/chat.css', () => {
  it('exists, is minified, and ships a string twin for the inject fallback', () => {
    expect(existsSync('dist/chat.css')).toBe(true);
    expect(css().split('\n').length).toBeLessThan(20);
    const twin = readFileSync('dist/chat-css.js', 'utf8');
    expect(twin.startsWith('export const css = "')).toBe(true);
    expect(JSON.parse(twin.slice('export const css = '.length, -2 + (twin.endsWith(';\n') ? 0 : 1)))).toBe(css());
  });

  it('never selects the host page: no bare html/body/:root/* rules', () => {
    // Every rule starts with the scope class (or is an at-rule we namespace).
    const source = withoutKeyframes(css()).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = source.match(/(^|})([^{}@]+){/g) ?? [];
    const bare = rules
      .map((r) => r.replace(/^}?/, '').replace(/{$/, '').trim())
      .filter(
        (sel) =>
          !(splitTopLevel(sel) as string[]).every((s) => {
            const part = s.trim();
            // A nested rule resolves against its enclosing rule, and every
            // enclosing rule is itself one of the rules checked here.
            return part.startsWith('&') || part.startsWith('.t2v-chat');
          }),
      );
    expect(bare).toEqual([]);
  });

  it('scopes the root class once, never as a descendant of itself', () => {
    // isolate.mjs prefixes every selector that is not `:root`/`:host`/`html`/
    // `body` with the scope class, so a rule WRITTEN as `.t2v-chat { … }` ships
    // as `.t2v-chat .t2v-chat { … }` and silently matches nothing. That is how
    // the chat once lost `height: 100%` and collapsed to its content height.
    expect(css()).not.toContain('.t2v-chat .t2v-chat');
    // …and the rules that give the root its box are really on the root.
    expect(css()).toMatch(/\.t2v-chat\{[^}]*height:100%/);
  });

  it('namespaces every global name it registers', () => {
    const c = css();
    expect(c.match(/@property\s+--(?!t2v-)/g)).toBeNull();
    expect(c.match(/@keyframes\s+(?!t2v-)/g)).toBeNull();
    expect(c.includes('--tw-')).toBe(false); // renamed to --t2v-tw-
  });

  it('keeps theme tokens overridable (no !important on custom properties)', () => {
    expect(css().match(/--[\w-]+:[^;{}]*!important/g)).toBeNull();
  });

  it('puts the launcher anchor’s rules on the anchor, not on a descendant of itself', () => {
    // The anchor is a chat root in the partner's own page: it carries
    // `.t2v-chat` AND `.aui-modal-anchor`. A rule written in chat.src.css as
    // `.aui-modal-anchor` ships as `.t2v-chat .aui-modal-anchor` and matches
    // nothing, leaving the launcher unpositioned in the page flow.
    expect(css()).toMatch(/\.t2v-chat\.aui-modal-anchor\{[^}]*position:fixed/);
    expect(css()).not.toContain('.t2v-chat .aui-modal-anchor{');
  });

  it('paints every launcher colourway, in every state', () => {
    for (const colourway of ['smoke-teal', 'teal-smoke', 'teal-white']) {
      expect(css()).toContain(`[data-launcher-variant=${colourway}]`);
    }
    // A ghost button repaints on hover and while the popup is open; each of
    // those has to be pinned, or the chevron goes invisible on a dark tile.
    for (const state of [':hover', '[data-popup-open]', '[aria-expanded=true]']) {
      expect(css()).toContain(`[data-launcher-variant=smoke-teal]${state}`);
    }
  });

  it('runs the launcher beam with no state qualifier on it', () => {
    expect(css()).toMatch(/\.t2v-chat \.aui-modal-button(:before|::before)\s*\{/);
  });

  it('drives the phone sheet from the launcher’s attribute, not a fixed breakpoint', () => {
    expect(css()).toContain('.aui-modal-content[data-sheet]');
    expect(css()).toContain('.aui-modal-positioner[data-sheet]');
    // `sheetBelow` is the integrator's to choose, so no rule may hard-code it.
    expect(css()).not.toMatch(/max-width:\s*640px\)\{[^@]*?\.aui-modal-content/);
  });

  it('has the brand tokens on the root class', () => {
    for (const token of [
      '--t2v-teal:',
      '--t2v-smoke:',
      '--t2v-ivory:',
      '--t2v-mist:',
      '--t2v-stone:',
      '--t2v-slate:',
      '--t2v-ash:',
      '--t2v-highlight:',
    ]) {
      expect(css()).toContain(token);
    }
  });
});
