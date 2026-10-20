/**
 * A failed request tells the developer what to quote to support (`requestId`)
 * and, when the engine says, how long to wait (`retryAfter`). Every request
 * names this SDK and its version in `X-T2V-Client`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import { T2VError, parseRetryAfter } from '../../src/errors';
import * as storage from '../../src/storage';
import { CLIENT_HEADER, SDK_VERSION } from '../../src/version';

function res(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function newClient(): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test' });
}

async function thrownFor(response: Response): Promise<T2VError> {
  vi.stubGlobal('fetch', vi.fn(async () => response));
  return newClient()
    .request('/v1/thing', {}, false)
    .then(() => null as never)
    .catch((e) => e);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestId', () => {
  it('comes from the error body', async () => {
    const err = await thrownFor(
      res(404, { error: { type: 'not_found', message: 'Not Found', request_id: 'req-body' } }),
    );
    expect(err.requestId).toBe('req-body');
  });

  it('falls back to the X-Request-Id header', async () => {
    const err = await thrownFor(
      res(502, { error: { type: 'upstream_error', message: 'Down' } }, { 'X-Request-Id': 'req-hdr' }),
    );
    expect(err.requestId).toBe('req-hdr');
  });

  it('is undefined when the engine sent neither', async () => {
    const err = await thrownFor(res(500, { error: { type: 'internal_error', message: 'x' } }));
    expect(err.requestId).toBeUndefined();
  });

  it('survives the mapping to a specific class', async () => {
    const err = await thrownFor(
      res(401, { error: { type: 'partner_key_error', message: 'No', request_id: 'req-pk' } }),
    );
    expect(err.name).toBe('PartnerKeyError');
    expect(err.requestId).toBe('req-pk');
  });
});

describe('retryAfter', () => {
  it('reads seconds from Retry-After', async () => {
    const err = await thrownFor(
      res(429, { error: { type: 'rate_limit_exceeded', message: 'Slow down' } }, { 'Retry-After': '60' }),
    );
    expect(err.retryAfter).toBe(60);
    expect(err.statusCode).toBe(429);
  });

  it('is undefined without the header', async () => {
    const err = await thrownFor(res(429, { error: { type: 'rate_limit_exceeded', message: 'x' } }));
    expect(err.retryAfter).toBeUndefined();
  });

  it('parses an HTTP date and rejects nonsense', () => {
    const now = Date.parse('2026-10-20T10:00:00Z');
    expect(parseRetryAfter('Tue, 20 Oct 2026 10:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Tue, 20 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });
});

describe('X-T2V-Client', () => {
  it('names this SDK and the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8'));
    expect(SDK_VERSION).toBe(pkg.version);
    expect(CLIENT_HEADER).toBe(`talk2view-typescript/${pkg.version}`);
  });

  it('is sent on every request, including the token refresh', async () => {
    localStorage.clear();
    storage.setAccessToken('old_a');
    storage.setRefreshToken('old_r');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/auth/refresh')) {
        return res(200, { access_token: 'new_a', refresh_token: 'new_r', expires_in: 3600 });
      }
      const auth = (init?.headers as Record<string, string>)?.['Authorization'];
      return auth === 'Bearer new_a' ? res(200, { ok: true }) : res(401, { error: { message: 'expired' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await newClient().request('/v1/thing');

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url.replace('https://api.test', ''))).toEqual([
      '/v1/thing',
      '/v1/auth/refresh',
      '/v1/thing',
    ]);
    for (const [, init] of calls) {
      expect((init.headers as Record<string, string>)['X-T2V-Client']).toBe(CLIENT_HEADER);
    }
    localStorage.clear();
  });
});
