/**
 * Signing in from inside the packaged chat.
 *
 * The whole chat is rendered — provider, runtime, vendored <Thread />, header —
 * and only the transport and the auth layer are scripted, so what these tests
 * drive is what a visitor sees. The auth mock is stateful: `authState.signIn()`
 * notifies the same `onAuthStateChange` listeners the real one does, which is
 * how "signing in returns to the thread" is exercised rather than asserted.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => {
  const state = {
    user: null as { id: string; email: string } | null,
    anonymous: false,
    listeners: new Set<(user: unknown) => void>(),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    getPopupProviders: vi.fn(),
    startAnonymous: vi.fn(),
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
      state.login.mockReset().mockResolvedValue({ id: 'u1', email: 'a@b.c' });
      state.signup.mockReset().mockResolvedValue({ confirmationRequired: false });
      state.logout.mockReset().mockResolvedValue(undefined);
      state.signInWithGoogle.mockReset().mockResolvedValue({ id: 'u1', email: 'a@b.c' });
      state.signInWithApple.mockReset().mockResolvedValue({ id: 'u1', email: 'a@b.c' });
      state.getPopupProviders.mockReset().mockResolvedValue([]);
      state.startAnonymous.mockReset().mockResolvedValue(null);
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
    startAnonymous: (...args: unknown[]) => authState.startAnonymous(...args),
    login: (...args: unknown[]) => authState.login(...args),
    signup: (...args: unknown[]) => authState.signup(...args),
    logout: (...args: unknown[]) => authState.logout(...args),
    signInWithGoogle: () => authState.signInWithGoogle(),
    signInWithApple: () => authState.signInWithApple(),
    getPopupProviders: () => authState.getPopupProviders(),
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
import { T2VError } from '../../src/errors';
import { setIsAnonymous } from '../../src/storage';
import type { ChatEvent } from '../../src/types';

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  // jsdom has no scrolling; the thread viewport auto-scrolls on every message.
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

const client = () => new Talk2View({ partnerKey: 'pk_test_x' });

const accountView = () => document.querySelector<HTMLElement>('.t2v-chat-account');
/** Keeps form queries inside the view, away from anything the header offers. */
const form = () => within(accountView()!);
const thread = () => document.querySelector<HTMLElement>('.aui-modal-thread')!;

/** Open the Account view from the header, the way a visitor does. */
async function openAccount() {
  const button = await screen.findByRole('button', { name: 'Account' });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function fillIn(email: string, password: string) {
  fireEvent.change(form().getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(form().getByLabelText('Password'), { target: { value: password } });
}

describe('the Account view', () => {
  it('signs in with an email and a password, then goes back to the thread', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await openAccount();
    expect(accountView()).toBeTruthy();

    await fillIn(' a@b.c ', 'hunter2');
    authState.login.mockImplementation(async (email: string) => {
      authState.set({ id: 'u1', email });
      return { id: 'u1', email };
    });
    await act(async () => {
      fireEvent.click(form().getByRole('button', { name: 'Sign in' }));
    });

    expect(authState.login).toHaveBeenCalledWith('a@b.c', 'hunter2');
    await waitFor(() => expect(accountView()).toBeNull());
    expect(thread().inert).toBe(false);
  });

  it('shows the engine’s own message when the password is wrong', async () => {
    authState.login.mockRejectedValue(new Error('Invalid login credentials'));
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await openAccount();
    await fillIn('a@b.c', 'nope');
    await act(async () => {
      fireEvent.click(form().getByRole('button', { name: 'Sign in' }));
    });
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid login credentials');
    expect(accountView()).toBeTruthy();
  });

  it('shows who is signed in and signs them out, staying on the view', async () => {
    authState.user = { id: 'u1', email: 'someone@example.com' };
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await openAccount();
    expect(await screen.findByText('someone@example.com')).toBeTruthy();

    authState.logout.mockImplementation(async () => authState.set(null));
    await act(async () => {
      fireEvent.click(form().getByRole('button', { name: /sign out/i }));
    });
    expect(authState.logout).toHaveBeenCalled();
    // Signing out leaves the visitor where they were, not back in the thread.
    await waitFor(() => expect(form().getByRole('heading', { name: 'Sign in' })).toBeTruthy());
  });

  it('asks a new account to check its email', async () => {
    authState.signup.mockResolvedValue({ confirmationRequired: true });
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await openAccount();
    await act(async () => {
      fireEvent.click(form().getByRole('button', { name: /create an account/i }));
    });
    await fillIn('new@example.com', 'longenough');
    await act(async () => {
      fireEvent.click(form().getByRole('button', { name: 'Create account' }));
    });
    expect(authState.signup).toHaveBeenCalledWith('new@example.com', 'longenough');
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeTruthy();
    expect(screen.getByText('new@example.com')).toBeTruthy();
  });

  it('offers only the sign-in websites the engine allows, and none while it is still asking', async () => {
    let resolve!: (list: string[]) => void;
    authState.getPopupProviders.mockReturnValue(new Promise<string[]>((r) => (resolve = r)));
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await openAccount();
    expect(screen.queryByRole('button', { name: /continue with apple/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();

    await act(async () => {
      resolve(['apple']);
    });
    expect(await screen.findByRole('button', { name: /continue with apple/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /continue with google/i })).toBeNull();
  });

  it('shows "Forgot it?" only when the integrator gives a page for it', async () => {
    const plain = render(<Talk2ViewChat partnerKey="pk_test_x" />);
    await openAccount();
    expect(form().queryByRole('link', { name: /forgot/i })).toBeNull();
    plain.unmount();

    render(<Talk2ViewChat partnerKey="pk_test_x" resetPasswordUrl="https://example.com/reset" />);
    await openAccount();
    expect(
      form()
        .getByRole('link', { name: /forgot/i })
        .getAttribute('href'),
    ).toBe('https://example.com/reset');
  });

  it('marks the header button when someone is signed in', async () => {
    authState.user = { id: 'u1', email: 'a@b.c' };
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    const button = await screen.findByRole('button', { name: 'Account' });
    expect(button.querySelector('span[aria-hidden]')).toBeTruthy();
  });

  it('calls the header button "Account" signed out too, so "Sign in" names one thing', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    expect(await screen.findByRole('button', { name: 'Account' })).toBeTruthy();
    await openAccount();
    // The only "Sign in" button on screen is the form's own submit.
    const signIn = screen.getAllByRole('button', { name: 'Sign in' });
    expect(signIn).toHaveLength(1);
    expect(accountView()!.contains(signIn[0]!)).toBe(true);
  });

  it('hides the account button when the feature is off', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" features={{ account: false }} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
  });
});

describe('the sign-in gate', () => {
  it('replaces the thread when guests are not allowed', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" allowAnonymous={false} />);
    await waitFor(() => expect(accountView()).toBeTruthy());
    expect(thread().inert).toBe(true);
    // Nothing opened it by itself, so there is nothing to explain.
    expect(screen.queryByRole('status')).toBeNull();
    // Settings is still reachable from behind the gate.
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('starts no guest session behind the gate, so the gate holds', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" allowAnonymous={false} />);
    await waitFor(() => expect(accountView()).toBeTruthy());

    // Settings lists the models, and listing needs a session — which is where a
    // guest account would otherwise be created, opening the gate from behind.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    });
    await waitFor(() => expect(document.querySelector('.t2v-chat-settings')).toBeTruthy());
    expect(authState.startAnonymous).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    });
    expect(accountView()).toBeTruthy();
  });

  it('lets the visitor back into the thread once they sign in', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" allowAnonymous={false} />);
    await waitFor(() => expect(accountView()).toBeTruthy());
    await act(async () => {
      authState.set({ id: 'u1', email: 'a@b.c' });
    });
    await waitFor(() => expect(accountView()).toBeNull());
    expect(thread().inert).toBe(false);
  });

  it('explains itself when the partner refuses guests mid-visit', async () => {
    const t2v = client();
    authState.startAnonymous.mockRejectedValue(
      new T2VError('no guests', 'anonymous_access_disabled', 403),
    );
    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await act(async () => {
      await t2v.ensureSession();
    });
    await waitFor(() => expect(accountView()).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/guest chat isn’t available/i);
  });

  it('opens with a banner when a guest runs out of allowance', async () => {
    const t2v = client();
    setIsAnonymous(true);
    authState.set({ id: 'anon', email: '' }, true);

    // The guest's budget runs out; signing in and resending gets an answer.
    const streams: ChatEvent[][] = [
      [{ type: 'error', errorType: 'budget_exceeded', message: 'out of credit' }],
      [
        { type: 'text', content: 'Here you go.' },
        { type: 'done', threadId: 'th' },
      ],
    ];
    let next = 0;
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() => {
      const events = streams[next++] ?? [];
      return (async function* () {
        for (const event of events) yield event;
      })();
    }) as never);

    render(<Talk2ViewChat client={t2v} />);
    await screen.findByRole('heading', { name: /how can i help/i });
    await act(async () => {
      await t2v.sendMessage('hi');
    });

    await waitFor(() => expect(accountView()).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/guest limit/i);
    // Someone who needs an account is offered one, not a password field.
    expect(form().getByRole('heading', { name: /create your account/i })).toBeTruthy();
    // The gate holds until there is a real account behind it.
    expect(thread().inert).toBe(true);

    await act(async () => {
      setIsAnonymous(false);
      authState.set({ id: 'u1', email: 'a@b.c' });
    });
    await waitFor(() => expect(accountView()).toBeNull());
    // The message the limit interrupted is sent again under the new account.
    expect(await screen.findByText('Here you go.')).toBeTruthy();
  });
});
