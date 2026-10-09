import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import { Talk2View } from '../../src/index';
import * as storage from '../../src/storage';
import { ACCESS_TOKEN_STORAGE_KEY } from '../../src/storage';
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
});
