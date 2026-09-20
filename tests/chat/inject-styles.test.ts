/**
 * Some hosts cannot `import '@talk2view/sdk/chat.css'` at all: the Word add-in's
 * webpack has no CSS rule, and a strict `style-src` CSP blocks a <style> tag.
 * The fallback has to install the sheet once, and only once, however often a
 * component calls it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@talk2view/sdk/chat-css', () => ({ css: '.t2v-chat{color:red}' }));

beforeAll(() => {
  // The module imports its bytes from the build output; make sure it is there.
  if (!existsSync('dist/chat-css.js')) {
    execFileSync('node', ['scripts/chat/build-css.mjs'], { stdio: 'inherit' });
  }
}, 120_000);

beforeEach(() => {
  vi.resetModules();
  document.head.innerHTML = '';
});

afterEach(() => {
  // Undo the `document` stub before touching `document` again.
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).adoptedStyleSheets;
});

describe('injectTalk2ViewChatStyles', () => {
  it('adopts the stylesheet once, however many times it is called', async () => {
    const replaceSync = vi.fn();
    vi.stubGlobal(
      'CSSStyleSheet',
      class {
        replaceSync = replaceSync;
      },
    );
    let adopted: unknown[] = [];
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      get: () => adopted,
      set: (v: unknown[]) => {
        adopted = v;
      },
    });

    const { injectTalk2ViewChatStyles } = await import('../../src/chat/inject-styles.js');
    injectTalk2ViewChatStyles();
    injectTalk2ViewChatStyles();
    injectTalk2ViewChatStyles();

    expect(adopted).toHaveLength(1);
    expect(replaceSync).toHaveBeenCalledTimes(1);
    expect(replaceSync).toHaveBeenCalledWith('.t2v-chat{color:red}');
    expect(document.querySelectorAll('style[data-talk2view-chat]')).toHaveLength(0);
  });

  it('falls back to one <style> tag where constructable stylesheets are missing', async () => {
    delete (document as unknown as Record<string, unknown>).adoptedStyleSheets;
    expect('adoptedStyleSheets' in document).toBe(false);

    const { injectTalk2ViewChatStyles } = await import('../../src/chat/inject-styles.js');
    injectTalk2ViewChatStyles();
    injectTalk2ViewChatStyles();

    const tags = document.querySelectorAll('style[data-talk2view-chat]');
    expect(tags).toHaveLength(1);
    expect(tags[0]?.textContent).toBe('.t2v-chat{color:red}');
  });

  it('does nothing at all when there is no document (server rendering)', async () => {
    vi.stubGlobal('document', undefined);
    const { injectTalk2ViewChatStyles } = await import('../../src/chat/inject-styles.js');
    expect(() => injectTalk2ViewChatStyles()).not.toThrow();
  });
});
