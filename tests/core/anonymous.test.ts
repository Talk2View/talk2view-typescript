import { afterEach, describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import { T2VError } from '../../src/errors';
import * as storage from '../../src/storage';
import { Talk2View } from '../../src/index';
import type { T2VClient } from '../../src/client';
import type { ChatEvent, TokenResponse } from '../../src/types';

function mockClient(response: Partial<TokenResponse>): T2VClient {
  return {
    request: vi.fn().mockResolvedValue({
      access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      user: { id: 'anon-1', email: '' }, is_anonymous: true, ...response,
    }),
  } as unknown as T2VClient;
}

describe('T2VAuth.startAnonymous', () => {
  it('stores tokens and marks the session anonymous', async () => {
    const client = mockClient({});
    const auth = new T2VAuth(client);

    const user = await auth.startAnonymous();

    expect(user.id).toBe('anon-1');
    expect(storage.getAccessToken()).toBe('a');
    expect(auth.isAnonymous()).toBe(true);
  });

  it('passes the captcha token to the endpoint', async () => {
    const client = mockClient({});
    const auth = new T2VAuth(client);

    await auth.startAnonymous({ captchaToken: 'cf-token' });

    expect(client.request).toHaveBeenCalledWith(
      '/v1/auth/anonymous',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ captcha_token: 'cf-token' }) }),
      false,
    );
  });
});

describe('T2VAuth.signup when anonymous', () => {
  it('calls /v1/auth/convert instead of /v1/auth/signup', async () => {
    const requestMock = vi.fn()
      .mockResolvedValueOnce({  // startAnonymous
        access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        user: { id: 'anon-1', email: '' }, is_anonymous: true,
      })
      .mockResolvedValueOnce({ id: 'anon-1', email: 'me@x.com' });  // convert returns UserInfo
    const client = { request: requestMock } as unknown as T2VClient;
    const auth = new T2VAuth(client);

    await auth.startAnonymous();
    const user = await auth.signup('me@x.com', 'supersecret');

    expect(user.email).toBe('me@x.com');
    expect(requestMock).toHaveBeenLastCalledWith(
      '/v1/auth/convert',
      expect.objectContaining({ method: 'POST' }),
      true,
    );
    expect(auth.isAnonymous()).toBe(false);
  });

  it('falls back to login when convert returns 409 (email already exists)', async () => {
    const requestMock = vi.fn()
      .mockResolvedValueOnce({  // startAnonymous
        access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        user: { id: 'anon-1', email: '' }, is_anonymous: true,
      })
      .mockRejectedValueOnce(  // convert → 409 conflict
        new T2VError('Email already exists', 'conflict', 409),
      )
      .mockResolvedValueOnce({  // login
        access_token: 'a2', refresh_token: 'r2', token_type: 'bearer', expires_in: 3600,
        user: { id: 'real-1', email: 'me@x.com' }, is_anonymous: false,
      });
    const client = { request: requestMock } as unknown as T2VClient;
    const auth = new T2VAuth(client);

    await auth.startAnonymous();
    const user = await auth.signup('me@x.com', 'supersecret');

    expect(user.id).toBe('real-1');
    expect(user.email).toBe('me@x.com');
    // Last call should be the login fallback, not signup.
    expect(requestMock).toHaveBeenLastCalledWith(
      '/v1/auth/login',
      expect.objectContaining({ method: 'POST' }),
      false,
    );
    expect(auth.isAnonymous()).toBe(false);
  });

  it('rethrows non-409 convert errors instead of logging in', async () => {
    const requestMock = vi.fn()
      .mockResolvedValueOnce({
        access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        user: { id: 'anon-1', email: '' }, is_anonymous: true,
      })
      .mockRejectedValueOnce(new T2VError('Bad password', 'validation_error', 422));
    const client = { request: requestMock } as unknown as T2VClient;
    const auth = new T2VAuth(client);

    await auth.startAnonymous();
    await expect(auth.signup('me@x.com', 'short')).rejects.toThrow('Bad password');
  });
});

describe('Talk2View demo-limit gate (budget_exceeded error chunk)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function budgetErrorChunk(): ChatEvent {
    return { type: 'error', message: 'You have reached your usage limit.', errorType: 'budget_exceeded' };
  }

  function mockChatStream(t2v: Talk2View, events: ChatEvent[]): void {
    vi.spyOn(t2v, 'chat' as never).mockImplementation((() =>
      (async function* () {
        for (const e of events) yield e;
      })()
    ) as never);
  }

  it('emits demoLimitReached (and does not setError) while anonymous', async () => {
    vi.spyOn(storage, 'getIsAnonymous').mockReturnValue(true);
    const t2v = new Talk2View({ partnerKey: 'pk_test_123' });
    let demoLimitFired = false;
    t2v.on('demoLimitReached', () => { demoLimitFired = true; });

    mockChatStream(t2v, [budgetErrorChunk()]);
    await t2v.sendMessage('hi');

    expect(demoLimitFired).toBe(true);
    expect(t2v.error).toBeNull();
  });

  it('calls setError and does NOT emit demoLimitReached when not anonymous', async () => {
    vi.spyOn(storage, 'getIsAnonymous').mockReturnValue(false);
    const t2v = new Talk2View({ partnerKey: 'pk_test_123' });
    let demoLimitFired = false;
    t2v.on('demoLimitReached', () => { demoLimitFired = true; });

    mockChatStream(t2v, [budgetErrorChunk()]);
    await t2v.sendMessage('hi');

    expect(demoLimitFired).toBe(false);
    expect(t2v.error).toBe('You have reached your usage limit.');
  });
});
