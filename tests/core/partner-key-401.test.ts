/**
 * A 401 caused by the PARTNER key is the integrator's configuration, not an
 * expired end-user session. The client used to treat every
 * 401 as an expired access token: it refreshed, the engine's refresh route
 * rejected the same partner key with the same 401, the client read that as "the
 * refresh token is dead" and cleared the session — so a bad or revoked partner
 * key signed the end-user out. The Python SDK already gets this right.
 *
 * The engine tells the two apart by `error.type`: `partner_key_error` for the
 * partner key, `authentication_error` for the user's token.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import { AuthenticationError, PartnerKeyError } from '../../src/errors';
import { Talk2View } from '../../src/index';
import * as storage from '../../src/storage';

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const PARTNER_KEY_401 = () =>
  res(401, { error: { type: 'partner_key_error', message: 'Invalid partner API key' } });
const TOKEN_401 = () =>
  res(401, { error: { type: 'authentication_error', message: 'Invalid or expired token' } });
const REFRESH_OK = () =>
  res(200, { access_token: 'new_a', refresh_token: 'new_r', token_type: 'bearer', expires_in: 3600 });

const USER = { id: 'u1', email: 'someone@example.com' };

function newClient(): T2VClient {
  return new T2VClient({ partnerKey: 'pk_revoked', baseUrl: 'https://api.test' });
}

/** Route the stubbed fetch: the refresh route gets `refresh`, everything else `other`. */
function stubFetch(other: () => Response, refresh: () => Response = REFRESH_OK) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/v1/auth/refresh') ? refresh() : other(),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function paths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([url]) => new URL(url as string).pathname);
}

/** The three ways the client sends an authenticated request. */
const SENDS: Array<[string, string, (c: T2VClient) => Promise<unknown>]> = [
  ['request', '/v1/models', (c) => c.request('/v1/models')],
  [
    'streamRequest',
    '/v1/sessions/s1/messages',
    (c) => c.streamRequest('/v1/sessions/s1/messages', { messages: [] }).next(),
  ],
  ['uploadRequest', '/v1/attachments', (c) => c.uploadRequest('/v1/attachments', new FormData())],
];

let authCleared: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage.clearAuth();
  storage.setAccessToken('old_a');
  storage.setRefreshToken('old_r');
  storage.setUser(USER);
  authCleared = vi.fn();
  window.addEventListener('talk2view_auth_cleared', authCleared);
});

afterEach(() => {
  window.removeEventListener('talk2view_auth_cleared', authCleared);
  vi.unstubAllGlobals();
  storage.clearAuth();
});

function expectSessionKept() {
  expect(storage.getAccessToken()).toBe('old_a');
  expect(storage.getRefreshToken()).toBe('old_r');
  expect(storage.getUser()).toBe(JSON.stringify(USER));
  expect(authCleared).not.toHaveBeenCalled();
}

describe('a partner-key 401 on a request', () => {
  it.each(SENDS)(
    '%s: never refreshes, keeps the session and throws the engine error',
    async (_name, endpoint, send) => {
      const fetchMock = stubFetch(PARTNER_KEY_401);

      const err = await send(newClient()).then(() => null, (e: unknown) => e);

      expect(err).toBeInstanceOf(PartnerKeyError);
      expect(err).toMatchObject({
        type: 'partner_key_error',
        statusCode: 401,
        message: 'Invalid partner API key',
      });
      expect(paths(fetchMock)).toEqual([endpoint]); // no /v1/auth/refresh
      expectSessionKept();
    },
  );
});

describe('a partner-key 401 from the refresh route', () => {
  it.each(SENDS)(
    '%s: is not "refresh token invalid" — the session is kept and the error surfaces',
    async (_name, endpoint, send) => {
      // The request's own 401 names the user's token (e.g. the key was revoked
      // between the two calls, or the engine's partner-key cache still held it).
      const fetchMock = stubFetch(TOKEN_401, PARTNER_KEY_401);

      const err = await send(newClient()).then(() => null, (e: unknown) => e);

      expect(err).toBeInstanceOf(PartnerKeyError);
      expect(err).toMatchObject({ type: 'partner_key_error', statusCode: 401 });
      expect(paths(fetchMock)).toEqual([endpoint, '/v1/auth/refresh']); // no retry
      expectSessionKept();
    },
  );

  it('getValidAccessToken: keeps the session and throws instead of returning null', async () => {
    const fetchMock = stubFetch(TOKEN_401, PARTNER_KEY_401);
    const auth = new T2VAuth(newClient());
    const seen: unknown[] = [];
    auth.onAuthStateChange((u) => seen.push(u));

    await expect(auth.getValidAccessToken({ forceRefresh: true })).rejects.toBeInstanceOf(
      PartnerKeyError,
    );

    expect(paths(fetchMock)).toEqual(['/v1/auth/refresh']);
    expect(seen).not.toContain(null); // the app is not told the user signed out
    expectSessionKept();
    auth.destroy();
  });
});

describe('the user-token 401 paths are unchanged', () => {
  it('an authentication_error 401 still refreshes and retries', async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => (++calls === 1 ? TOKEN_401() : res(200, { ok: true })));

    await expect(newClient().request('/v1/models')).resolves.toEqual({ ok: true });

    expect(paths(fetchMock)).toEqual(['/v1/models', '/v1/auth/refresh', '/v1/models']);
    expect(storage.getAccessToken()).toBe('new_a');
    expect(storage.getRefreshToken()).toBe('new_r');
  });

  it('a genuinely rejected refresh token still signs out and broadcasts it', async () => {
    stubFetch(TOKEN_401, TOKEN_401);

    await expect(newClient().request('/v1/models')).rejects.toBeInstanceOf(AuthenticationError);

    expect(storage.getAccessToken()).toBeNull();
    expect(storage.getRefreshToken()).toBeNull();
    expect(storage.getUser()).toBeNull();
    expect(authCleared).toHaveBeenCalledTimes(1); // same-tab event; storage removal reaches other tabs
  });
});

describe('through Talk2View', () => {
  function createT2V(): Talk2View {
    return new Talk2View({
      partnerKey: 'pk_revoked',
      baseUrl: 'https://api.test',
      anonymousAutoStart: false,
    });
  }

  it('chat(): a partner-key 401 on the message stream keeps the user signed in', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new URL(url).pathname === '/v1/sessions'
        ? res(200, { session_id: 's1', thread_id: 't1', model: 'm' })
        : PARTNER_KEY_401(),
    );
    vi.stubGlobal('fetch', fetchMock);
    const t2v = createT2V();
    const seen: unknown[] = [];
    t2v.auth.onAuthStateChange((u) => seen.push(u));

    const drain = async () => {
      for await (const _event of t2v.chat('hello')) {
        // drain
      }
    };
    await expect(drain()).rejects.toBeInstanceOf(PartnerKeyError);

    expect(paths(fetchMock)).toEqual(['/v1/sessions', '/v1/sessions/s1/messages']);
    expect(seen).not.toContain(null);
    expectSessionKept();
    t2v.destroy();
  });

  it('uploadAttachment(): a partner-key 401 keeps the user signed in', async () => {
    const fetchMock = stubFetch(PARTNER_KEY_401);
    const t2v = createT2V();

    await expect(
      t2v.uploadAttachment(new Blob(['x'], { type: 'image/png' }), 'x.png'),
    ).rejects.toBeInstanceOf(PartnerKeyError);

    expect(paths(fetchMock)).toEqual(['/v1/attachments']);
    expectSessionKept();
    t2v.destroy();
  });
});
