/**
 * Whose conversation is on screen when the person signed in changes.
 *
 * The client holds the transcript in memory, and `/ui`, `/react`,
 * `/assistant-ui` and the packaged chat with its thread list off all render it
 * straight from there. It used to survive every identity change, so after one
 * end-user signed out, the next one to sign in on the same page saw their
 * conversation — and carried it on: the transcript is replayed with every
 * message, so it went to the engine under the new account.
 *
 * The rule is the packaged chat's: a conversation follows the end-user out of a
 * guest session, or out of no session at all, into the account they sign in to.
 * It never leaves an account, and signing out ends it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => {
  const state = {
    user: null as { id: string; email: string } | null,
    anonymous: false,
    signingOut: false,
    listeners: new Set<(user: unknown) => void>(),
    /** Change who is signed in and tell everyone, as the real auth layer does. */
    set(user: { id: string; email: string } | null, opts: { anonymous?: boolean; signingOut?: boolean } = {}) {
      state.user = user;
      state.anonymous = opts.anonymous ?? false;
      state.signingOut = opts.signingOut ?? false;
      for (const listener of [...state.listeners]) listener(user);
      state.signingOut = false;
    },
    reset() {
      state.user = null;
      state.anonymous = false;
      state.signingOut = false;
      state.listeners.clear();
    },
  };
  return state;
});

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(function () { return {
    request: vi.fn().mockResolvedValue({}),
    streamRequest: vi.fn(),
  }; }),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(function () { return {
    onAuthStateChange: (cb: (user: unknown) => void) => {
      authState.listeners.add(cb);
      return () => authState.listeners.delete(cb);
    },
    getUser: () => authState.user,
    isAnonymous: () => authState.anonymous,
    get signingOut() {
      return authState.signingOut;
    },
  }; }),
}));

import { Talk2View } from '../../src/index';
import type { ChatEvent, ChatMessage } from '../../src/types';

/**
 * A client whose `chat()` answers "Reply N" and records the history it was
 * asked to replay — which is what would carry a conversation to the engine.
 */
function scriptedClient(): { t2v: Talk2View; replayed: ChatMessage[][] } {
  const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
  const replayed: ChatMessage[][] = [];
  let n = 0;
  vi.spyOn(t2v, 'chat' as never).mockImplementation(((
    _message: string,
    options?: { history?: ChatMessage[] },
  ) => {
    replayed.push(options?.history ?? []);
    const reply = `Reply ${++n}`;
    return (async function* (): AsyncGenerator<ChatEvent> {
      yield { type: 'text', content: reply };
      yield { type: 'done', threadId: `th_${n}` };
    })();
  }) as never);
  return { t2v, replayed };
}

const A = { id: 'account-a', email: 'a@example.com' };
const B = { id: 'account-b', email: 'b@example.com' };
const GUEST = { id: 'guest-1', email: '' };

beforeEach(() => {
  authState.reset();
});

describe('signing out', () => {
  it('takes the conversation off the screen, with everything that carries it on', async () => {
    authState.user = A;
    const { t2v } = scriptedClient();
    await t2v.sendMessage('Something private to A');
    expect(t2v.messages.map((m) => m.content)).toEqual(['Something private to A', 'Reply 1']);
    expect(t2v.threadId).toBe('th_1');

    authState.set(null, { signingOut: true });

    expect(t2v.messages).toEqual([]);
    expect(t2v.exportConversation()).toEqual({ messages: [], history: [], threadId: null });
    expect(t2v.pendingApproval).toBeNull();
    expect(t2v.isLoading).toBe(false);
  });

  it('tells the UI, so whoever is next sees an empty chat', async () => {
    authState.user = A;
    const { t2v } = scriptedClient();
    await t2v.sendMessage('Something private to A');
    const seen: unknown[][] = [];
    t2v.on('messagesChange', (messages) => seen.push(messages));

    authState.set(null, { signingOut: true });

    expect(seen.at(-1)).toEqual([]);
  });

  it('sends none of it for the next person who signs in', async () => {
    authState.user = A;
    const { t2v, replayed } = scriptedClient();
    await t2v.sendMessage('Something private to A');

    authState.set(null, { signingOut: true });
    authState.set(B);
    await t2v.sendMessage('Hello');

    expect(t2v.messages.map((m) => m.content)).toEqual(['Hello', 'Reply 2']);
    expect(replayed.at(-1)).toEqual([]);
  });

  it('stops a reply that is still arriving from writing into the empty chat', async () => {
    authState.user = A;
    const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* (): AsyncGenerator<ChatEvent> {
        yield { type: 'text', content: 'The first half' };
        await gate;
        yield { type: 'text', content: ' and the rest.' };
        yield { type: 'done', threadId: 'th_1' };
      })()) as never);

    const turn = t2v.sendMessage('Something private to A');
    await vi.waitFor(() => expect(t2v.messages[1]?.content).toBe('The first half'));

    authState.set(null, { signingOut: true });
    release();
    await turn;

    expect(t2v.messages).toEqual([]);
    expect(t2v.exportConversation().history).toEqual([]);
  });

  it('ends a guest’s conversation too, when a guest is signed out', async () => {
    authState.user = GUEST;
    authState.anonymous = true;
    const { t2v } = scriptedClient();
    await t2v.sendMessage('A guest’s question');

    authState.set(null, { signingOut: true });

    expect(t2v.messages).toEqual([]);
  });
});

describe('an account that stops being the one signed in', () => {
  it('takes its conversation off the screen when its session ends on its own, and says why', async () => {
    authState.user = A;
    const { t2v } = scriptedClient();
    await t2v.sendMessage('Something private to A');

    // A revoked refresh token, or a sign-out in another tab: nobody called logout() here.
    authState.set(null);

    expect(t2v.messages).toEqual([]);
    expect(t2v.exportConversation().history).toEqual([]);
    // The end-user did nothing and their conversation went: tell them.
    expect(t2v.error).toBe('Session expired. Please log in again.');
  });

  it('says so in the middle of a reply too, which stops writing into the empty chat', async () => {
    authState.user = A;
    const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* (): AsyncGenerator<ChatEvent> {
        yield { type: 'text', content: 'The first half' };
        await gate;
        yield { type: 'text', content: ' and the rest.' };
        yield { type: 'done', threadId: 'th_1' };
      })()) as never);

    const turn = t2v.sendMessage('Something private to A');
    await vi.waitFor(() => expect(t2v.messages[1]?.content).toBe('The first half'));

    authState.set(null);
    release();
    await turn;

    expect(t2v.messages).toEqual([]);
    expect(t2v.isLoading).toBe(false);
    expect(t2v.error).toBe('Session expired. Please log in again.');
  });

  it('says nothing when there was nothing on screen to lose', () => {
    authState.user = A;
    const { t2v } = scriptedClient();

    authState.set(null);

    expect(t2v.error).toBeNull();
  });

  it('says nothing on a deliberate sign-out: the end-user knows', async () => {
    authState.user = A;
    const { t2v } = scriptedClient();
    await t2v.sendMessage('Something private to A');

    authState.set(null, { signingOut: true });

    expect(t2v.error).toBeNull();
  });

  it('takes it off the screen on a switch straight to another account, with no error for them', async () => {
    authState.user = A;
    const { t2v, replayed } = scriptedClient();
    await t2v.sendMessage('Something private to A');

    authState.set(B);
    expect(t2v.messages).toEqual([]);
    expect(t2v.error).toBeNull();

    await t2v.sendMessage('Hello');
    expect(replayed.at(-1)).toEqual([]);
  });
});

describe('what still follows the end-user', () => {
  it('a guest’s conversation, into the account they sign in to, so the turn can be resent', async () => {
    authState.user = GUEST;
    authState.anonymous = true;
    const { t2v, replayed } = scriptedClient();
    await t2v.sendMessage('First question');
    await t2v.sendMessage('Second question');

    authState.set(A);
    expect(t2v.messages.map((m) => m.content)).toEqual([
      'First question',
      'Reply 1',
      'Second question',
      'Reply 2',
    ]);

    // The demo-limit path: signing in resends the turn the limit interrupted.
    await t2v.retryLastMessage();
    expect(replayed.at(-1)).toEqual([
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Reply 1' },
    ]);
  });

  it('what a visitor typed before anything authenticated', async () => {
    const { t2v } = scriptedClient();
    await t2v.sendMessage('Typed before signing in');

    authState.set(A);

    expect(t2v.messages.map((m) => m.content)).toEqual(['Typed before signing in', 'Reply 1']);
  });

  it('the same end-user, re-announced with the same id', async () => {
    authState.user = GUEST;
    authState.anonymous = true;
    const { t2v } = scriptedClient();
    await t2v.sendMessage('Before the email was confirmed');

    // Converting a guest keeps the id.
    authState.set({ id: GUEST.id, email: 'g@example.com' });

    expect(t2v.messages.map((m) => m.content)).toEqual(['Before the email was confirmed', 'Reply 1']);
  });
});
