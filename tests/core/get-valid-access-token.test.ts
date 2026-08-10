// Unit tests for T2VAuth.getValidAccessToken() — the public accessor that
// DIRECT (non-SDK-transport) callers use to get a guaranteed-valid token,
// proactively refreshing (deduped with the client's 401 path) when needed.
//
// Note: these reset state via the storage API (clearAuth/setters), never
// `localStorage.clear()`. Node 25 ships a broken native `localStorage` global
// that shadows jsdom's; storage.ts falls back to an in-memory store, so going
// through the storage API keeps the tests green regardless of Node version.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VClient } from '../../src/client';
import * as storage from '../../src/storage';

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const REFRESH_OK = res(200, {
  access_token: 'new_a',
  refresh_token: 'new_r',
  token_type: 'bearer',
  expires_in: 3600,
});

// Build a JWT whose payload carries the given `exp` (seconds since epoch). Only
// the payload segment matters to decodeJwtExp; header/signature are filler.
function jwt(exp: number): string {
  const b64url = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ exp })}.sig`;
}

const nowS = () => Date.now() / 1000;

function newAuth(): { auth: T2VAuth } {
  const client = new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test' });
  return { auth: new T2VAuth(client) };
}

describe('T2VAuth.getValidAccessToken', () => {
  beforeEach(() => {
    storage.clearAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    storage.clearAuth();
  });

  it('returns the current token without refreshing when it is comfortably valid', async () => {
    const token = jwt(nowS() + 3600);
    storage.setAccessToken(token);
    storage.setRefreshToken('r');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    await expect(auth.getValidAccessToken()).resolves.toBe(token);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proactively refreshes when the token is within the expiry skew window', async () => {
    storage.setAccessToken(jwt(nowS() + 10)); // < 30s skew → stale
    storage.setRefreshToken('old_r');
    const fetchMock = vi.fn(async () => REFRESH_OK);
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    await expect(auth.getValidAccessToken()).resolves.toBe('new_a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/v1/auth/refresh');
    expect(storage.getAccessToken()).toBe('new_a');
    expect(storage.getRefreshToken()).toBe('new_r');
  });

  it('refreshes an already-expired token', async () => {
    storage.setAccessToken(jwt(nowS() - 60));
    storage.setRefreshToken('old_r');
    const fetchMock = vi.fn(async () => REFRESH_OK);
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    await expect(auth.getValidAccessToken()).resolves.toBe('new_a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh refreshes even when the current token is still valid', async () => {
    storage.setAccessToken(jwt(nowS() + 3600));
    storage.setRefreshToken('old_r');
    const fetchMock = vi.fn(async () => REFRESH_OK);
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    await expect(auth.getValidAccessToken({ forceRefresh: true })).resolves.toBe('new_a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null and clears auth when the refresh token is genuinely dead (401)', async () => {
    storage.setAccessToken(jwt(nowS() - 60));
    storage.setRefreshToken('dead_r');
    const fetchMock = vi.fn(async () => res(401, { error: 'invalid refresh token' }));
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    const seen: Array<unknown> = [];
    auth.onAuthStateChange((u) => seen.push(u));

    await expect(auth.getValidAccessToken()).resolves.toBeNull();
    expect(storage.getAccessToken()).toBeNull(); // auth cleared
    expect(seen).toContain(null); // listeners notified → app logs out
  });

  it('keeps the session and returns the current token on a transient refresh failure (503)', async () => {
    const stale = jwt(nowS() + 10);
    storage.setAccessToken(stale);
    storage.setRefreshToken('old_r');
    const fetchMock = vi.fn(async () => res(503, { error: 'upstream down' }));
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    await expect(auth.getValidAccessToken()).resolves.toBe(stale);
    expect(storage.getAccessToken()).toBe(stale); // session NOT cleared
  });

  it('de-dupes concurrent calls into a single /v1/auth/refresh', async () => {
    storage.setAccessToken(jwt(nowS() - 60));
    storage.setRefreshToken('old_r');
    let resolveFetch: (r: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { auth } = newAuth();
    const a = auth.getValidAccessToken({ forceRefresh: true });
    const b = auth.getValidAccessToken({ forceRefresh: true });
    resolveFetch(REFRESH_OK);
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).toBe('new_a');
    expect(rb).toBe('new_a');
    expect(fetchMock).toHaveBeenCalledTimes(1); // shared refresh authority
  });
});
