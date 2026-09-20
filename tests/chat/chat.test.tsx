/**
 * <Talk2ViewChat> — the packaged full-pane chat.
 *
 * Everything below the component is real: the provider, the Talk2View runtime
 * adapter, assistant-ui's own store and the vendored <Thread />. Only the
 * transport is scripted (the same mocks tests/assistant-ui/runtime.test.tsx
 * uses), so a partner's first render is what these tests exercise.
 */
import React from 'react';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
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
import { ChatProvider } from '../../src/chat/provider';
import { ASSISTANT_UI_KEY } from '../../src/chat/lib/guard';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../src/chat/ui/tooltip';

// ── jsdom lacks the layout APIs the primitives observe ──────────────────────
beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  // The thread scrolls itself to the newest message; jsdom has no scrollTo, and
  // the throw lands in a requestAnimationFrame where no test can catch it.
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

const client = () => new Talk2View({ partnerKey: 'pk_test_x' });

beforeEach(() => {
  // Conversations are kept in localStorage, so a chat mounted in the next test
  // would otherwise open the one the last test left behind.
  localStorage.clear();
});

afterEach(() => {
  // The portal host is ref-counted per document; unmount drops it, but a test
  // that threw mid-render could leave one behind.
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
});

describe('<Talk2ViewChat>', () => {
  it('renders inside a .t2v-chat root and portals into a .t2v-chat host on <body>', async () => {
    const { container } = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(container.querySelector('.t2v-chat')).toBeTruthy();
    await waitFor(() => {
      expect(document.body.querySelector('body > .t2v-chat.t2v-portal-host')).toBeTruthy();
    });
  });

  it('removes the portal host when the last chat unmounts', async () => {
    const first = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    const second = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await waitFor(() => expect(document.querySelectorAll('.t2v-portal-host')).toHaveLength(1));
    first.unmount();
    expect(document.querySelectorAll('.t2v-portal-host')).toHaveLength(1);
    second.unmount();
    expect(document.querySelectorAll('.t2v-portal-host')).toHaveLength(0);
  });

  it('takes dark mode out to the portal host, and puts it back on the way out', async () => {
    // Tooltips, dialogs and the launcher's panel render in the portal host, a
    // sibling of the chat in <body>. `dark` on the chat's own container cannot
    // reach them, so a dark chat used to show light-themed popups.
    const { unmount } = render(<Talk2ViewChat partnerKey="pk_test_x" className="dark" />);
    const host = () => document.querySelector('.t2v-portal-host')!;
    await waitFor(() => expect(host().classList.contains('dark')).toBe(true));
    unmount();
    // The host is ref-counted and shared: a light chat mounted next must not
    // inherit the theme of one that has gone.
    const light = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await waitFor(() => expect(host().classList.contains('dark')).toBe(false));
    light.unmount();
  });

  it('does not read `dark` out of a class that merely contains it', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" className="darkroom-panel" />);
    await waitFor(() => expect(document.querySelector('.t2v-portal-host')).toBeTruthy());
    expect(document.querySelector('.t2v-portal-host')!.classList.contains('dark')).toBe(false);
  });

  it('shows the welcome heading and one button per suggestion', async () => {
    render(
      <Talk2ViewChat partnerKey="pk_test_x" welcome={{ heading: 'Hi there', suggestions: ['A', 'B'] }} />,
    );
    expect(await screen.findByRole('heading', { name: 'Hi there' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^A$/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /^B$/ })).toBeTruthy();
    });
  });

  it('falls back to the default welcome heading', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(await screen.findByRole('heading', { name: /how can i help you today/i })).toBeTruthy();
  });

  it('clicking a suggestion sends it', async () => {
    const t2v = client();
    const sendMessage = vi.spyOn(t2v, 'sendMessage').mockResolvedValue(undefined);
    render(<Talk2ViewChat client={t2v} welcome={{ suggestions: ['A', 'B'] }} />);
    const suggestion = await screen.findByRole('button', { name: /^A$/ });
    await act(async () => {
      fireEvent.click(suggestion);
    });
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(sendMessage.mock.calls[0]?.[0]).toBe('A');
  });

  it('starts a new conversation from the header, without ending the one it leaves', async () => {
    // The external store has to declare `onSwitchToNewThread`, and on
    // `adapters.threadList` — at the adapter root it type-checks and does
    // nothing. Without it assistant-ui throws "External store adapter does not
    // support switching to new thread", catches it, logs it, and the button
    // does nothing at all, which is how it shipped and how a visitor found it.
    //
    // `clearMessages()` is what it did next, and that is wrong too: it deletes
    // the engine session, and the conversation it wipes is one the end-user can
    // now go back to. tests/chat/conversations.test.tsx has the whole flow.
    const t2v = client();
    const cleared = vi.spyOn(t2v, 'clearMessages');
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* () {
        yield { type: 'text', content: 'An answer.' };
        yield { type: 'done', threadId: 'th' };
      })()) as never);

    render(<Talk2ViewChat client={t2v} welcome={{ suggestions: ['A'] }} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^A$/ }));
    });
    expect(await screen.findByText('An answer.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /new chat/i }));
    });

    // An empty chat, and the answer gone from it…
    expect(await screen.findByRole('heading', { name: /how can i help you today/i })).toBeTruthy();
    expect(screen.queryByText('An answer.')).toBeNull();
    // …but not thrown away, and the engine session not deleted behind it.
    expect(cleared).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Chats' })).not.toHaveProperty('disabled', true);
  });

  it('sends `systemPrompt` with the message, and nothing when there is none', async () => {
    // A runtime option, not a connection one: it rides on each message, which is
    // why changing it does not rebuild the client or drop the conversation.
    const withPrompt = client();
    const sent = vi.spyOn(withPrompt, 'sendMessage').mockResolvedValue(undefined);
    const first = render(
      <Talk2ViewChat
        client={withPrompt}
        systemPrompt="You are a radiology assistant."
        welcome={{ suggestions: ['A'] }}
      />,
    );
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^A$/ }));
    });
    await waitFor(() => expect(sent).toHaveBeenCalled());
    expect(sent.mock.calls[0]?.[1]).toMatchObject({
      systemPrompt: 'You are a radiology assistant.',
    });
    first.unmount();

    const plain = client();
    const plainSent = vi.spyOn(plain, 'sendMessage').mockResolvedValue(undefined);
    render(<Talk2ViewChat client={plain} welcome={{ suggestions: ['A'] }} />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /^A$/ }));
    });
    await waitFor(() => expect(plainSent).toHaveBeenCalled());
    expect(plainSent.mock.calls[0]?.[1]).not.toHaveProperty('systemPrompt');
  });

  it('keeps `systemPrompt` out of the client it builds', async () => {
    // `Talk2ViewChatProps` spreads `T2VConfig`, so anything the provider does
    // not destructure is handed to `new Talk2View()`. This one must not be, or
    // editing it would rebuild the client and throw the conversation away.
    const { useTalk2ViewChatClient } = await import('../../src/chat/provider');
    let seen: Record<string, unknown> | null = null;
    const Probe = () => {
      seen = useTalk2ViewChatClient().config as unknown as Record<string, unknown>;
      return null;
    };
    render(
      <ChatProvider partnerKey="pk_test_x" systemPrompt="Be brief.">
        <Probe />
      </ChatProvider>,
    );
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).not.toHaveProperty('systemPrompt');
    expect(seen).toMatchObject({ partnerKey: 'pk_test_x' });
  });

  it('throws in development if two copies of @assistant-ui/react are loaded', () => {
    const globals = globalThis as unknown as Record<symbol, unknown>;
    const real = globals[ASSISTANT_UI_KEY];
    globals[ASSISTANT_UI_KEY] = { notTheSameModule: true };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Talk2ViewChat partnerKey="pk_test_x" />)).toThrow(/two copies/i);
    } finally {
      quiet.mockRestore();
      globals[ASSISTANT_UI_KEY] = real;
    }
  });

  it('does not fetch fonts', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await screen.findByRole('heading', { name: /how can i help/i });
    expect(document.querySelector('link[href*="fonts.googleapis"]')).toBeNull();
    expect(document.querySelector('link[href*="fonts.gstatic"]')).toBeNull();
  });

  it('offers file attachments unless they are turned off', async () => {
    const withFiles = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(await screen.findByRole('button', { name: /add attachment/i })).toBeTruthy();
    withFiles.unmount();
    render(<Talk2ViewChat partnerKey="pk_test_x" features={{ attachments: false }} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    expect(screen.queryByRole('button', { name: /add attachment/i })).toBeNull();
  });

  it('sets the host font only when one is given', async () => {
    const plain = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(plain.container.querySelector<HTMLElement>('.t2v-chat')!.style.getPropertyValue('--t2v-font')).toBe('');
    plain.unmount();
    const styled = render(<Talk2ViewChat partnerKey="pk_test_x" fontFamily='"Space Grotesk", sans-serif' />);
    expect(styled.container.querySelector<HTMLElement>('.t2v-chat')!.style.getPropertyValue('--t2v-font')).toBe(
      '"Space Grotesk", sans-serif',
    );
  });

  it('shows Settings and the thread list by default', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(await screen.findByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chats' })).toBeTruthy();
  });

  it('hides Settings / thread list when features say so', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" features={{ settings: false, threadList: false }} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chats' })).toBeNull();
  });

  it('opens Settings over the thread and makes the thread inert', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    const settings = await screen.findByRole('button', { name: 'Settings' });
    const thread = document.querySelector<HTMLElement>('.aui-modal-thread')!;
    expect(thread.inert).toBe(false);
    await act(async () => {
      fireEvent.click(settings);
    });
    expect(document.querySelector('.t2v-chat-settings')).toBeTruthy();
    expect(thread.inert).toBe(true);
  });

  it('offers the voice button only when dictation is on', async () => {
    const withVoice = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(await screen.findByRole('button', { name: /start voice input/i })).toBeTruthy();
    withVoice.unmount();
    render(<Talk2ViewChat partnerKey="pk_test_x" features={{ dictation: false }} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    expect(screen.queryByRole('button', { name: /start voice input/i })).toBeNull();
  });
});

describe('portals', () => {
  it('render a tooltip under the portal host, not loose in <body>', async () => {
    render(
      <ChatProvider partnerKey="pk_test_x">
        <Tooltip open>
          <TooltipTrigger render={<button type="button">Trigger</button>} />
          <TooltipContent>Tip text</TooltipContent>
        </Tooltip>
      </ChatProvider>,
    );
    const tip = await screen.findByText('Tip text');
    const host = document.querySelector('.t2v-portal-host');
    expect(host).toBeTruthy();
    expect(host!.contains(tip)).toBe(true);
  });
});

describe('the /chat entry point', () => {
  beforeAll(() => {
    // injectTalk2ViewChatStyles() imports the built stylesheet by its published
    // path, so the entry point cannot be loaded before a CSS build.
    if (!existsSync('dist/chat-css.js')) {
      execFileSync('node', ['scripts/chat/build-css.mjs'], { stdio: 'inherit' });
    }
  }, 120_000);

  it('exports the documented surface', async () => {
    const chat = await import('../../src/chat/index');
    expect(typeof chat.Talk2ViewChat).toBe('function');
    expect(typeof chat.injectTalk2ViewChatStyles).toBe('function');
    expect(typeof chat.useTalk2ViewChatClient).toBe('function');
  });
});

describe('useTalk2ViewChatClient', () => {
  it('hands back the client the chat is using', async () => {
    const t2v = client();
    let seen: Talk2View | null = null;
    const { useTalk2ViewChatClient } = await import('../../src/chat/provider');
    function Probe() {
      seen = useTalk2ViewChatClient();
      return null;
    }
    render(
      <ChatProvider client={t2v}>
        <Probe />
      </ChatProvider>,
    );
    expect(seen).toBe(t2v);
  });

  it('explains itself when used outside the chat', async () => {
    const { useTalk2ViewChatClient } = await import('../../src/chat/provider');
    function Probe() {
      useTalk2ViewChatClient();
      return null;
    }
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Probe />)).toThrow(/Talk2ViewChat/);
    } finally {
      quiet.mockRestore();
    }
  });
});
