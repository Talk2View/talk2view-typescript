import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import { AuthenticationError, NetworkError } from '../../src/errors';
import * as storage from '../../src/storage';
import type { T2VConfig } from '../../src/types';

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

function newClient(overrides: Partial<T2VConfig> = {}): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test', ...overrides });
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

  it('fails fast (transient) when /refresh hangs past the timeout, then can retry', async () => {
    vi.useFakeTimers();
    try {
      // /refresh never resolves on its own — only its AbortSignal can settle it.
      let refreshCalls = 0;
      const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/v1/auth/refresh')) {
          refreshCalls += 1;
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            // Mirror fetch's behaviour: reject with an AbortError when aborted.
            signal?.addEventListener('abort', () => {
              reject(
                new DOMException('The operation was aborted.', 'AbortError'),
              );
            });
          });
        }
        return Promise.resolve(res(401, { error: { message: 'expired' } }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const client = newClient({ requestTimeout: 5_000 });

      // First attempt: the hung refresh must reject within the timeout window
      // (NetworkError surfaced as "temporarily unavailable") rather than hang.
      const firstAttempt = client.request('/v1/thing');
      const firstAssertion = expect(firstAttempt).rejects.toBeInstanceOf(NetworkError);
      await vi.advanceTimersByTimeAsync(5_000);
      await firstAssertion;

      // Session preserved: a timeout is transient, not a logout.
      expect(storage.getAccessToken()).toBe('old_a');
      expect(storage.getRefreshToken()).toBe('old_r');

      // The shared refreshPromise was cleared, so a subsequent call refreshes
      // again (a second /refresh fires) instead of re-awaiting the dead one.
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.endsWith('/v1/auth/refresh')) {
          refreshCalls += 1;
          return Promise.resolve(res(200, REFRESH_OK));
        }
        const auth = (init?.headers as Record<string, string>)?.['Authorization'];
        return Promise.resolve(
          auth === 'Bearer new_a'
            ? res(200, { ok: true })
            : res(401, { error: { message: 'expired' } }),
        );
      });

      const second = await client.request('/v1/thing');
      expect(second).toEqual({ ok: true });
      expect(refreshCalls).toBe(2);
      expect(storage.getAccessToken()).toBe('new_a');
    } finally {
      vi.useRealTimers();
    }
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
