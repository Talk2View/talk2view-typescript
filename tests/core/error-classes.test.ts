/**
 * The SDK exports AuthenticationError, PartnerKeyError and SessionError, and
 * the README tells partners to branch on them. Until now every failed request
 * threw a plain T2VError, so those branches never ran: a partner's "bad
 * credentials" handler silently fell through to the generic case. Map the
 * engine's own error types onto the classes we publish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import {
  AuthenticationError,
  PartnerKeyError,
  SessionError,
  T2VError,
} from '../../src/errors';
import type { T2VConfig } from '../../src/types';

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function newClient(overrides: Partial<T2VConfig> = {}): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test', ...overrides });
}

/** Fail one request with the given engine error body and return what was thrown. */
async function thrownFor(status: number, error: Record<string, unknown>): Promise<T2VError> {
  vi.stubGlobal('fetch', vi.fn(async () => res(status, { error })));
  return newClient()
    .request('/v1/thing', {}, false)
    .then(() => null as never)
    .catch((e) => e);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('engine error types map to the exported error classes', () => {
  it('authentication_error throws AuthenticationError', async () => {
    const err = await thrownFor(401, { type: 'authentication_error', message: 'Bad credentials' });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err).toBeInstanceOf(T2VError);
    expect(err.type).toBe('authentication_error');
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Bad credentials');
  });

  it('partner_key_error throws PartnerKeyError', async () => {
    const err = await thrownFor(401, { type: 'partner_key_error', message: 'Unknown partner key' });
    expect(err).toBeInstanceOf(PartnerKeyError);
    expect(err.type).toBe('partner_key_error');
  });

  it('session_not_found throws SessionError', async () => {
    const err = await thrownFor(404, { type: 'session_not_found', message: 'Session not found' });
    expect(err).toBeInstanceOf(SessionError);
    // The real status survives the mapping — SessionError used to hard-code none.
    expect(err.statusCode).toBe(404);
  });

  it('leaves the engine\'s generic not_found alone', async () => {
    // A dead chat session 404s as `not_found` today, but so does a missing
    // skill, attachment or partner. Mapping it to SessionError would fire that
    // class for unrelated failures; session loss is handled by the recovery
    // path in index.ts instead.
    const err = await thrownFor(404, { type: 'not_found', message: 'Session not found' });
    expect(err.constructor).toBe(T2VError);
    expect(err.type).toBe('not_found');
  });

  it('leaves a dashboard authorization_error as a plain T2VError', async () => {
    // 403 "lacks permission" is not an authentication failure: telling a
    // partner to prompt for re-login would loop them.
    const err = await thrownFor(403, { type: 'authorization_error', message: 'Admin access required' });
    expect(err.constructor).toBe(T2VError);
    expect(err.statusCode).toBe(403);
  });

  it('keeps the server code and detail on the subclass', async () => {
    const err = await thrownFor(401, {
      type: 'authentication_error',
      message: 'Token expired',
      code: 'token_expired',
      detail: 'jwt exp 1757980800',
    });
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.code).toBe('token_expired');
    expect(err.detail).toBe('jwt exp 1757980800');
  });

  it('leaves an unrecognised type as a plain T2VError', async () => {
    const err = await thrownFor(402, { type: 'budget_exceeded', message: 'Out of credit' });
    expect(err).toBeInstanceOf(T2VError);
    expect(err).not.toBeInstanceOf(AuthenticationError);
    expect(err).not.toBeInstanceOf(PartnerKeyError);
    expect(err).not.toBeInstanceOf(SessionError);
    expect(err.type).toBe('budget_exceeded');
  });

  it('leaves a typeless failure as a plain T2VError', async () => {
    const err = await thrownFor(500, { message: 'Something went wrong' });
    expect(err.constructor).toBe(T2VError);
  });
});
