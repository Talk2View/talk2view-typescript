import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import { T2VError } from '../../src/errors';
import type { T2VConfig } from '../../src/types';

/** Minimal Response stand-in — the client only touches .ok / .status / .json(). */
function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A non-JSON / opaque error response (e.g. an HTML 502 page from a proxy). */
function opaqueRes(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
    text: async () => text,
  } as unknown as Response;
}

function newClient(overrides: Partial<T2VConfig> = {}): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test', ...overrides });
}

const FAKE_STACK =
  'Traceback (most recent call last):\n  File "/srv/app/db.py", line 42, in query\n' +
  '    raise OperationalError("FATAL: password authentication failed for user \'t2v\'")\n' +
  'psycopg2.OperationalError: connection to 10.0.0.5:5432 failed';

describe('T2VClient error sanitization (SEC-20 / #106)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces structured type+message+status but NOT the raw detail/stack trace', async () => {
    const fetchMock = vi.fn(async () =>
      res(500, {
        error: {
          type: 'internal_error',
          message: 'Something went wrong on our end.',
          detail: FAKE_STACK,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const err = await newClient()
      .request('/v1/thing', {}, false)
      .then(() => null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(T2VError);
    // User-facing fields are surfaced.
    expect(err.type).toBe('internal_error');
    expect(err.message).toBe('Something went wrong on our end.');
    expect(err.statusCode).toBe(500);
    // The raw detail (stack trace, DB error, file paths) must NOT leak into the
    // user-facing message.
    expect(err.message).not.toContain('Traceback');
    expect(err.message).not.toContain('OperationalError');
    expect(err.message).not.toContain('/srv/app/db.py');
    expect(err.message).not.toContain('password authentication failed');
    expect(err.message).not.toContain('10.0.0.5');
    // ...but it stays available on a separate property for debugging.
    expect(err.detail).toBe(FAKE_STACK);
  });

  it('falls back to a generic message + status for a non-JSON / opaque error body', async () => {
    const html = '<html><body>502 Bad Gateway — nginx/1.25.3 at db-internal.svc</body></html>';
    const fetchMock = vi.fn(async () => opaqueRes(502, html));
    vi.stubGlobal('fetch', fetchMock);

    const err = await newClient()
      .request('/v1/thing', {}, false)
      .then(() => null)
      .catch((e) => e);

    expect(err).toBeInstanceOf(T2VError);
    expect(err.statusCode).toBe(502);
    // A generic, status-only message — never the raw HTML / internal hostnames.
    expect(err.message).toBe('Request failed (HTTP 502)');
    expect(err.message).not.toContain('nginx');
    expect(err.message).not.toContain('db-internal');
    expect(err.message).not.toContain('<html>');
    expect(err.detail).toBeUndefined();
  });
});
