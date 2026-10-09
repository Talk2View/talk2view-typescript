import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import { ACCESS_TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from '../../src/storage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeAuth(): T2VAuth {
  const request = vi.fn().mockResolvedValue(undefined);
  return new T2VAuth({ request } as unknown as T2VClient);
}

/** The user key's value as the SDK writes it. */
const user = (id: string, email = `${id}@example.com`) => JSON.stringify({ id, email });

describe('T2VAuth — a sign-in in another tab', () => {
  function listening() {
    const auth = makeAuth();
    const listener = vi.fn();
    auth.onAuthStateChange(listener);
    return { auth, listener };
  }

  const userWritten = (oldValue: string | null, newValue: string | null) =>
    window.dispatchEvent(new StorageEvent('storage', { key: USER_STORAGE_KEY, oldValue, newValue }));

  it('announces a different end-user, so this tab stops acting for the last one', () => {
    const { auth, listener } = listening();

    userWritten(user('a'), user('b'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ id: 'b', email: 'b@example.com' });
    auth.destroy();
  });

  it('announces somebody signed in while this tab had nobody', () => {
    const { auth, listener } = listening();

    userWritten(null, user('b'));

    expect(listener).toHaveBeenCalledWith({ id: 'b', email: 'b@example.com' });
    auth.destroy();
  });

  // Most often a guest who has signed in to the account they converted to,
  // which keeps the user id. This tab must stop treating them as a guest.
  it('announces the same end-user signing in again', () => {
    const { auth, listener } = listening();

    userWritten(user('a'), user('a', 'new-address@example.com'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ id: 'a', email: 'new-address@example.com' });
    auth.destroy();
  });

  it('ignores the user key going: the access token going is what announces a sign-out', () => {
    const { auth, listener } = listening();

    userWritten(user('a'), null);

    expect(listener).not.toHaveBeenCalled();
    auth.destroy();
  });

  it('ignores a value it cannot read', () => {
    const { auth, listener } = listening();

    userWritten(user('a'), '{not json');

    expect(listener).not.toHaveBeenCalled();
    auth.destroy();
  });

  // The tab that hears the user key change reads the rest of the session there
  // and then — whether it is a guest decides whether its conversation may
  // follow — so the tab that signs in writes the user last.
  it.each([
    ['a guest session', true, (auth: T2VAuth) => auth.startAnonymous()],
    ['an account', false, (auth: T2VAuth) => auth.login('b@example.com', 'password')],
  ])('writes the user last when %s signs in', async (_who, guest, signIn) => {
    const request = vi.fn().mockResolvedValue({
      access_token: 'a',
      refresh_token: 'r',
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: 'b', email: 'b@example.com' },
      user_api_key: 'k',
      is_anonymous: guest,
    });
    const auth = new T2VAuth({ request } as unknown as T2VClient);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await signIn(auth);

    const keys = setItem.mock.calls.map(([key]) => key).filter((key) => key.startsWith('talk2view_'));
    expect(keys.at(-1)).toBe(USER_STORAGE_KEY);
    expect(keys).toContain('talk2view_is_anonymous');
    expect(localStorage.getItem('talk2view_is_anonymous')).toBe(String(guest));
    auth.destroy();
    localStorage.clear();
  });
});

describe('T2VAuth — cross-tab logout via the native storage event', () => {
  it('flips to logged-out (notifies listeners with null) when a sibling tab clears the access token', () => {
    const auth = makeAuth();

    let notified: unknown = 'unset';
    auth.onAuthStateChange((u) => { notified = u; });

    // Sibling tab logged out → access-token key removed → newValue is null.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ACCESS_TOKEN_STORAGE_KEY,
        oldValue: 'tok',
        newValue: null,
      }),
    );

    expect(notified).toBeNull();
  });

  it('ignores storage events for unrelated keys', () => {
    const auth = makeAuth();

    const listener = vi.fn();
    auth.onAuthStateChange(listener);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'talk2view_preferences',
        oldValue: 'a',
        newValue: 'b',
      }),
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores access-token writes: a refresh rewrites it, and a sign-in is heard through the user key', () => {
    const auth = makeAuth();

    const listener = vi.fn();
    auth.onAuthStateChange(listener);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ACCESS_TOKEN_STORAGE_KEY,
        oldValue: null,
        newValue: 'new-tok',
      }),
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not leak listeners: destroy() removes the storage listener (sign-ins included)', () => {
    const auth = makeAuth();
    const listener = vi.fn();
    auth.onAuthStateChange(listener);
    auth.destroy();

    window.dispatchEvent(
      new StorageEvent('storage', { key: USER_STORAGE_KEY, oldValue: null, newValue: user('b') }),
    );

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not leak listeners: destroy() removes the storage listener', () => {
    const auth = makeAuth();

    const listener = vi.fn();
    auth.onAuthStateChange(listener);

    auth.destroy();

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ACCESS_TOKEN_STORAGE_KEY,
        oldValue: 'tok',
        newValue: null,
      }),
    );

    expect(listener).not.toHaveBeenCalled();
  });
});
