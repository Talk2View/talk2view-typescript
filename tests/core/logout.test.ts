import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import * as storage from '../../src/storage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('T2VAuth.logout', () => {
  it('skips the server logout call when there is no token to revoke, but still clears locally', async () => {
    vi.spyOn(storage, 'getAccessToken').mockReturnValue(null);
    const request = vi.fn().mockResolvedValue(undefined);
    const auth = new T2VAuth({ request } as unknown as T2VClient);

    let notified: unknown = 'unset';
    auth.onAuthStateChange((u) => { notified = u; });

    await auth.logout();

    expect(request).not.toHaveBeenCalled(); // nothing to revoke → don't 401 the server
    expect(notified).toBeNull();            // local session still cleared + listeners notified
  });

  it('calls the logout endpoint when a token exists', async () => {
    vi.spyOn(storage, 'getAccessToken').mockReturnValue('tok');
    const request = vi.fn().mockResolvedValue(undefined);
    const auth = new T2VAuth({ request } as unknown as T2VClient);

    await auth.logout();

    expect(request).toHaveBeenCalledWith(
      '/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('T2VClient.request — 204 No Content', () => {
  it('resolves (does not throw on the empty body) when the server returns 204', async () => {
    vi.spyOn(storage, 'getAccessToken').mockReturnValue('tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const client = new T2VClient({ partnerKey: 'pk_test_123' });

    await expect(
      client.request('/v1/auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });
});

describe('T2VAuth.signingOut', () => {
  it('is true while logout() announces the sign-out, and false otherwise', async () => {
    vi.spyOn(storage, 'getAccessToken').mockReturnValue('tok');
    const request = vi.fn().mockResolvedValue(undefined);
    const auth = new T2VAuth({ request } as unknown as T2VClient);
    const seen: boolean[] = [];
    auth.onAuthStateChange(() => seen.push(auth.signingOut));

    expect(auth.signingOut).toBe(false);
    await auth.logout();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(auth.signingOut).toBe(false);

    // A session that dies on its own is not a sign-out.
    seen.length = 0;
    window.dispatchEvent(new Event('talk2view_auth_cleared'));
    expect(seen).toEqual([false]);
  });
});
