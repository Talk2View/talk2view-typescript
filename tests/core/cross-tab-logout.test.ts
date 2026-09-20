import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import { ACCESS_TOKEN_STORAGE_KEY } from '../../src/storage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeAuth(): T2VAuth {
  const request = vi.fn().mockResolvedValue(undefined);
  return new T2VAuth({ request } as unknown as T2VClient);
}

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

  it('ignores access-token writes (a login in another tab sets a non-null value)', () => {
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
