/**
 * Conversations in the packaged chat, driven through the chat itself.
 *
 * Everything under the assertions is real: the provider, the conversation
 * store, `localStorage`, the Talk2View runtime adapter, assistant-ui's own
 * thread-list runtime and the vendored list. Only the engine is scripted. What
 * these cannot see is anything that needs layout or a compiled stylesheet — the
 * browser run in the notes covers that.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => {
  const state = {
    user: null as { id: string; email: string } | null,
    anonymous: false,
    listeners: new Set<(user: unknown) => void>(),
    /** Change who is signed in and tell everyone, exactly as the real layer does. */
    set(user: { id: string; email: string } | null, anonymous = false) {
      state.user = user;
      state.anonymous = anonymous;
      for (const listener of [...state.listeners]) listener(user);
    },
    reset() {
      state.user = null;
      state.anonymous = false;
      state.listeners.clear();
    },
  };
  return state;
});

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: (cb: (user: unknown) => void) => {
      authState.listeners.add(cb);
      return () => authState.listeners.delete(cb);
    },
    getUser: () => authState.user,
    isAnonymous: () => authState.anonymous,
    startAnonymous: vi.fn().mockResolvedValue(null),
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
import type { ChatEvent, ChatMessage } from '../../src/types';

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
  localStorage.clear();
  authState.reset();
});

afterEach(() => {
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
});

/** The history the client replayed on each send, in order. */
type Sent = ChatMessage[][];

/**
 * A client whose `chat()` answers with "Reply N", and which records the history
 * it was asked to replay — the thing that proves a restored conversation can be
 * carried on without the engine remembering anything.
 */
function scriptedClient(): { t2v: Talk2View; sent: Sent } {
  const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
  const sent: Sent = [];
  let n = 0;
  vi.spyOn(t2v, 'chat' as never).mockImplementation(((
    _message: string,
    options?: { history?: ChatMessage[] },
  ) => {
    sent.push(options?.history ?? []);
    const reply = `Reply ${++n}`;
    return (async function* (): AsyncGenerator<ChatEvent> {
      yield { type: 'text', content: reply };
      yield { type: 'done', threadId: `th_${n}` };
    })();
  }) as never);
  return { t2v, sent };
}

async function send(text: string): Promise<void> {
  const input = screen.getByPlaceholderText('Send a message...');
  await act(async () => {
    fireEvent.change(input, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  });
}

const newChat = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
  });
};

/** The thread pane, so a title in the header is not mistaken for a message. */
const thread = () => document.querySelector<HTMLElement>('.aui-modal-thread')!;

const openList = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
  });
  return document.querySelector<HTMLElement>('.t2v-chat-thread-list')!;
};

/** The titles in the Chats view, in the order it shows them. */
function listed(list: HTMLElement): string[] {
  return [...list.querySelectorAll("[data-slot='aui_thread-list-item-title']")].map(
    (el) => el.textContent ?? '',
  );
}

async function pick(list: HTMLElement, title: string): Promise<void> {
  const item = [...list.querySelectorAll("[data-slot='aui_thread-list-item-trigger']")].find((el) =>
    el.textContent?.includes(title),
  )!;
  await act(async () => {
    fireEvent.click(item);
  });
}

/** Open the … menu on the list row whose title matches. */
async function menu(list: HTMLElement, title: string): Promise<HTMLElement> {
  const row = [...list.querySelectorAll("[data-slot='aui_thread-list-item']")].find((el) =>
    el.textContent?.includes(title),
  ) as HTMLElement;
  await act(async () => {
    // A Radix dropdown opens on pointerdown, which jsdom does not synthesise
    // from a click. Enter on the trigger is the same thing to a keyboard user.
    fireEvent.keyDown(within(row).getByRole('button', { name: /more options/i }), { key: 'Enter' });
  });
  return await waitFor(() => {
    const content = document.querySelector<HTMLElement>(
      "[data-slot='aui_thread-list-item-more-content']",
    );
    if (!content) throw new Error('menu did not open');
    return content;
  });
}

describe('starting a new conversation', () => {
  it('keeps the one it leaves, and lists it', async () => {
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });

    await send('What is in this report?');
    expect(await screen.findByText('Reply 1')).toBeTruthy();

    await newChat();
    expect(await screen.findByRole('heading', { name: /how can i help/i })).toBeTruthy();
    expect(screen.queryByText('Reply 1')).toBeNull();

    const list = await openList();
    expect(listed(list)).toEqual(['What is in this report?']);
  });

  it('does nothing when the chat is already empty, so blanks do not pile up', async () => {
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });

    await send('First');
    await screen.findByText('Reply 1');
    await newChat();
    await newChat();
    await newChat();

    const list = await openList();
    expect(listed(list)).toEqual(['First']);
  });

  it('titles a conversation from its first message', async () => {
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });

    await send('  Summarise   the findings  ');
    await screen.findByText('Reply 1');
    await newChat();

    expect(listed(await openList())).toContain('Summarise the findings');
  });
});

describe('switching between conversations', () => {
  it('brings the transcript back and carries on with what came before it', async () => {
    const { t2v, sent } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });

    await send('The first question');
    await screen.findByText('Reply 1');
    await newChat();
    await send('A different subject');
    await screen.findByText('Reply 2');

    const list = await openList();
    await pick(list, 'The first question');

    // The transcript is back…
    expect(await screen.findByText('Reply 1')).toBeTruthy();
    expect(within(thread()).getByText('The first question')).toBeTruthy();
    expect(screen.queryByText('Reply 2')).toBeNull();

    // …and continuing it replays it, which is what lets the engine forget.
    await send('And what else?');
    await screen.findByText('Reply 3');
    expect(sent[2]).toEqual([
      { role: 'user', content: 'The first question' },
      { role: 'assistant', content: 'Reply 1' },
    ]);
  });

  it('does not delete the engine session of the conversation it leaves', async () => {
    const { t2v } = scriptedClient();
    const cleared = vi.spyOn(t2v, 'clearMessages');
    const detached = vi.spyOn(t2v, 'detachSession');
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });

    await send('First');
    await screen.findByText('Reply 1');
    await newChat();

    expect(detached).toHaveBeenCalled();
    expect(cleared).not.toHaveBeenCalled();
  });
});

describe('renaming and deleting', () => {
  it('renames one, and the new name is what the list shows', async () => {
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Original title');
    await screen.findByText('Reply 1');
    await newChat();

    const list = await openList();
    const options = await menu(list, 'Original title');
    await act(async () => {
      fireEvent.click(within(options).getByText('Rename'));
    });

    const input = await screen.findByLabelText('Rename thread');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Chest CT follow-up' } });
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    await waitFor(() => expect(listed(list)).toContain('Chest CT follow-up'));
    expect(listed(list)).not.toContain('Original title');
  });

  it('deletes one and leaves the rest', async () => {
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Keep me');
    await screen.findByText('Reply 1');
    await newChat();
    await send('Delete me');
    await screen.findByText('Reply 2');
    await newChat();

    const list = await openList();
    expect(listed(list)).toEqual(['Delete me', 'Keep me']);

    const options = await menu(list, 'Delete me');
    await act(async () => {
      fireEvent.click(within(options).getByText('Delete'));
    });

    await waitFor(() => expect(listed(list)).toEqual(['Keep me']));
  });

  it('offers no Archive, because there is nowhere to see an archived one', async () => {
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Something');
    await screen.findByText('Reply 1');
    await newChat();

    const options = await menu(await openList(), 'Something');
    expect(within(options).queryByText('Archive')).toBeNull();
    expect(within(options).getByText('Delete')).toBeTruthy();
  });
});

describe('surviving a reload', () => {
  it('lists what was there before and opens the most recent one', async () => {
    const first = scriptedClient();
    const before = render(<Talk2ViewChat client={first.t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Before the reload');
    await screen.findByText('Reply 1');
    await newChat();
    await send('The most recent one');
    await screen.findByText('Reply 2');
    before.unmount();

    // A new page: a new client, the same browser storage.
    const after = scriptedClient();
    render(<Talk2ViewChat client={after.t2v} />);

    expect(await screen.findByText('Reply 2')).toBeTruthy();
    expect(listed(await openList())).toEqual(['The most recent one', 'Before the reload']);

    // And the reopened one carries on where it was, from the stored history.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Chats' }));
    });
    await send('Carry on');
    await screen.findByText('Reply 1');
    expect(after.sent[0]).toEqual([
      { role: 'user', content: 'The most recent one' },
      { role: 'assistant', content: 'Reply 2' },
    ]);
  });

  it('does not throw a conversation away when the chat unmounts mid-write', async () => {
    const { t2v } = scriptedClient();
    const mounted = render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Written on the way out');
    await screen.findByText('Reply 1');
    // No waiting: unmount inside the debounce window.
    mounted.unmount();

    const next = scriptedClient();
    render(<Talk2ViewChat client={next.t2v} />);
    expect(await screen.findByText('Reply 1')).toBeTruthy();
  });
});

describe('who the conversations belong to', () => {
  it('follows a guest into the account they sign in to', async () => {
    authState.set({ id: 'guest-1', email: '' }, true);
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Started as a guest');
    await screen.findByText('Reply 1');

    await act(async () => {
      authState.set({ id: 'account-1', email: 'a@b.c' });
    });

    // Still on screen, and now theirs.
    expect(screen.getByText('Reply 1')).toBeTruthy();
    expect(listed(await openList())).toEqual(['Started as a guest']);
  });

  it('shows one account nothing of another', async () => {
    authState.set({ id: 'account-1', email: 'a@b.c' });
    const one = scriptedClient();
    const first = render(<Talk2ViewChat client={one.t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send("The first account's chat");
    await screen.findByText('Reply 1');
    first.unmount();

    authState.set({ id: 'account-2', email: 'c@d.e' });
    const two = scriptedClient();
    render(<Talk2ViewChat client={two.t2v} />);

    expect(await screen.findByRole('heading', { name: /how can i help/i })).toBeTruthy();
    expect(screen.queryByText('Reply 1')).toBeNull();
    const chats = screen.getByRole('button', { name: 'Chats' }) as HTMLButtonElement;
    expect(chats.disabled).toBe(true);
  });

  it('takes the last person’s conversation off the screen when someone else signs in', async () => {
    authState.set({ id: 'account-1', email: 'a@b.c' });
    const one = scriptedClient();
    const first = render(<Talk2ViewChat client={one.t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Private to the first account');
    await screen.findByText('Reply 1');
    first.unmount();

    // A second page load as the same person: the chat reopens what they left…
    const two = scriptedClient();
    render(<Talk2ViewChat client={two.t2v} />);
    expect(await screen.findByText('Reply 1')).toBeTruthy();

    // …and somebody else signing in on this device must not be looking at it.
    await act(async () => {
      authState.set({ id: 'account-2', email: 'c@d.e' });
    });
    await waitFor(() => expect(screen.queryByText('Reply 1')).toBeNull());
    expect((screen.getByRole('button', { name: 'Chats' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives it back when the first account signs in again', async () => {
    authState.set({ id: 'account-1', email: 'a@b.c' });
    const { t2v } = scriptedClient();
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await send('Mine');
    await screen.findByText('Reply 1');

    await act(async () => {
      authState.set({ id: 'account-2', email: 'c@d.e' });
    });
    await waitFor(() => expect(screen.queryByText('Reply 1')).toBeNull());

    await act(async () => {
      authState.set({ id: 'account-1', email: 'a@b.c' });
    });
    expect(listed(await openList())).toContain('Mine');
  });
});

describe('with the thread list turned off', () => {
  it('still starts a new conversation, and ends the session it leaves', async () => {
    const { t2v } = scriptedClient();
    const cleared = vi.spyOn(t2v, 'clearMessages');
    render(<Talk2ViewChat client={t2v} features={{ threadList: false }} />);
    await screen.findByRole('heading', { name: /how can i help/i });

    await send('Something');
    await screen.findByText('Reply 1');
    await newChat();

    expect(await screen.findByRole('heading', { name: /how can i help/i })).toBeTruthy();
    expect(cleared).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Chats' })).toBeNull();
    // Nothing is kept either: the list is the only thing that would show it.
    expect(localStorage.length).toBe(0);
  });
});
