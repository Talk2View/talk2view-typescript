import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import { AuthenticationError, NetworkError } from '../../src/errors';
import * as storage from '../../src/storage';

/** Minimal Response stand-in — the client only touches .ok / .status / .json(). */
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const REFRESH_OK = {
  access_token: 'new_a',
  refresh_token: 'new_r',
  token_type: 'bearer',
  expires_in: 3600,
};

function newClient(): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test' });
}

describe('T2VClient token refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    storage.setAccessToken('old_a');
    storage.setRefreshToken('old_r');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refreshes on 401 and retries the original request', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/auth/refresh')) return res(200, REFRESH_OK);
      const auth = (init?.headers as Record<string, string>)?.['Authorization'];
      return auth === 'Bearer new_a'
        ? res(200, { ok: true })
        : res(401, { error: { message: 'expired' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await newClient().request('/v1/thing');

    expect(result).toEqual({ ok: true });
    expect(storage.getAccessToken()).toBe('new_a');
    expect(storage.getRefreshToken()).toBe('new_r');
  });

  it.each([409, 429, 503])(
    'treats a %i from /refresh as transient: NetworkError, keeps the session',
    async (refreshStatus) => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith('/v1/auth/refresh')) return res(refreshStatus, { error: {} });
        return res(401, { error: { message: 'expired' } });
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(newClient().request('/v1/thing')).rejects.toBeInstanceOf(NetworkError);
      // Session preserved — the next attempt picks up the latest token.
      expect(storage.getAccessToken()).toBe('old_a');
      expect(storage.getRefreshToken()).toBe('old_r');
    },
  );

  it('logs out on a 401 from /refresh (token genuinely dead)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/auth/refresh')) return res(401, { error: { message: 'bad token' } });
      return res(401, { error: { message: 'expired' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(newClient().request('/v1/thing')).rejects.toBeInstanceOf(AuthenticationError);
    expect(storage.getAccessToken()).toBeNull();
    expect(storage.getRefreshToken()).toBeNull();
  });

  it('de-dupes concurrent refreshes: many 401s trigger a single /refresh', async () => {
    let refreshCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls += 1;
        return res(200, REFRESH_OK);
      }
      const auth = (init?.headers as Record<string, string>)?.['Authorization'];
      return auth === 'Bearer new_a'
        ? res(200, { ok: true })
        : res(401, { error: { message: 'expired' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = newClient();
    const results = await Promise.all([
      client.request('/v1/a'),
      client.request('/v1/b'),
      client.request('/v1/c'),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });
});
