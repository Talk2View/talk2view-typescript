import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import { Talk2View } from '../../src/index';
import * as storage from '../../src/storage';
import { ACCESS_TOKEN_STORAGE_KEY, USER_STORAGE_KEY } from '../../src/storage';
import type { ChatEvent } from '../../src/types';

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

describe('signing out, through the real auth layer', () => {
  const json = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  async function signedInWithAConversation(): Promise<Talk2View> {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/v1/auth/login') {
          return json({
            access_token: 'a',
            refresh_token: 'r',
            token_type: 'bearer',
            expires_in: 3600,
            user: { id: 'u1', email: 'a@example.com' },
          });
        }
        if (path === '/v1/auth/logout') return new Response(null, { status: 204 });
        throw new Error(`unexpected request to ${path}`);
      }),
    );
    const t2v = new Talk2View({ partnerKey: 'pk_test_123', baseUrl: 'https://engine.test' });
    await t2v.auth.login('a@example.com', 'password');
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* (): AsyncGenerator<ChatEvent> {
        yield { type: 'text', content: 'A private answer' };
        yield { type: 'done', threadId: 'th_1' };
      })()) as never);
    await t2v.sendMessage('A private question');
    expect(t2v.messages).toHaveLength(2);
    return t2v;
  }

  it('leaves no conversation behind for the next person', async () => {
    const t2v = await signedInWithAConversation();
    await t2v.auth.logout();
    expect(t2v.messages).toEqual([]);
    expect(t2v.exportConversation()).toEqual({ messages: [], history: [], threadId: null });
    t2v.destroy();
  });

  it('leaves none behind when the sign-out happened in another tab', async () => {
    const t2v = await signedInWithAConversation();
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: ACCESS_TOKEN_STORAGE_KEY, newValue: null }));
    expect(t2v.messages).toEqual([]);
    t2v.destroy();
    localStorage.clear();
  });

  it('leaves none behind when another tab signs a different account in over it', async () => {
    const t2v = await signedInWithAConversation();
    const before = localStorage.getItem(USER_STORAGE_KEY);

    // The other tab signs in as somebody else without signing out first: every
    // key is overwritten, none removed, so the access token never goes null.
    const other = JSON.stringify({ id: 'u2', email: 'b@example.com' });
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'b');
    localStorage.setItem(USER_STORAGE_KEY, other);
    window.dispatchEvent(
      new StorageEvent('storage', { key: ACCESS_TOKEN_STORAGE_KEY, oldValue: 'a', newValue: 'b' }),
    );
    window.dispatchEvent(
      new StorageEvent('storage', { key: USER_STORAGE_KEY, oldValue: before, newValue: other }),
    );

    // This tab now sends with the second account's token, so the first
    // account's conversation must not be on screen to be carried on.
    expect(t2v.messages).toEqual([]);
    expect(t2v.exportConversation()).toEqual({ messages: [], history: [], threadId: null });
    expect(t2v.error).toBeNull();
    t2v.destroy();
    localStorage.clear();
  });
});

describe('a session that dies in the middle of a turn, through the real client', () => {
  const json = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
  const refused = () =>
    json({ detail: { error: { type: 'authentication_error', message: 'Invalid token' } } }, 401);

  /**
   * Signed in, then the message's request is refused and so is the refresh: the
   * refresh token was revoked or has expired. Nobody called logout().
   */
  async function aTurnWhoseSessionDies(): Promise<{ t2v: Talk2View; errors: (string | null)[] }> {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path === '/v1/auth/login') {
          return json({
            access_token: 'a',
            refresh_token: 'r',
            token_type: 'bearer',
            expires_in: 3600,
            user: { id: 'u1', email: 'a@example.com' },
          });
        }
        if (path === '/v1/sessions') return json({ session_id: 's1', thread_id: 't1', model: 'm' });
        if (path === '/v1/sessions/s1/messages') return refused();
        if (path === '/v1/auth/refresh') return refused();
        throw new Error(`unexpected request to ${path}`);
      }),
    );
    const t2v = new Talk2View({ partnerKey: 'pk_test_123', baseUrl: 'https://engine.test' });
    await t2v.auth.login('a@example.com', 'password');
    const errors: (string | null)[] = [];
    t2v.on('errorChange', (error) => errors.push(error));
    await t2v.sendMessage('A private question');
    return { t2v, errors };
  }

  afterEach(() => localStorage.clear());

  it('takes the conversation off the screen and says why', async () => {
    const { t2v, errors } = await aTurnWhoseSessionDies();

    // Dropped, as for any account whose session ends: the next person on this
    // page must not see it, nor replay it under their own account…
    expect(t2v.messages).toEqual([]);
    expect(t2v.exportConversation()).toEqual({ messages: [], history: [], threadId: null });
    expect(t2v.isLoading).toBe(false);
    expect(t2v.auth.getUser()).toBeNull();
    // …but not in silence. The end-user's message vanished; this is the reason.
    expect(t2v.error).toBe('Session expired. Please log in again.');
    expect(errors.at(-1)).toBe('Session expired. Please log in again.');
    t2v.destroy();
  });
});
