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
  it('converts in place — no re-login, session stays anonymous until confirmed', async () => {
    const requestMock = vi.fn()
      .mockResolvedValueOnce({  // startAnonymous
        access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        user: { id: 'anon-1', email: '' }, is_anonymous: true,
      })
      .mockResolvedValueOnce({  // convert → pending
        id: 'anon-1', email: null, user_metadata: {}, confirmation_pending: true,
      });
    const client = { request: requestMock } as unknown as T2VClient;
    const auth = new T2VAuth(client);

    await auth.startAnonymous();
    const outcome = await auth.signup('me@x.com', 'supersecret');

    expect(outcome.confirmationRequired).toBe(true);
    expect(outcome.user).toBeNull();
    expect(requestMock).toHaveBeenCalledTimes(2);      // no login call
    expect(requestMock).toHaveBeenLastCalledWith(
      '/v1/auth/convert', expect.objectContaining({ method: 'POST' }), true,
    );
    expect(auth.isAnonymous()).toBe(true);             // upgrades on confirmation
  });

  it('falls back to login when convert returns 409 (email already exists)', async () => {
    const requestMock = vi.fn()
      .mockResolvedValueOnce({  // startAnonymous
        access_token: 'a', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
        user: { id: 'anon-1', email: '' }, is_anonymous: true,
      })
      .mockRejectedValueOnce(new T2VError('Email already exists', 'conflict', 409))
      .mockResolvedValueOnce({
        access_token: 'a2', refresh_token: 'r2', token_type: 'bearer', expires_in: 3600,
        user: { id: 'real-1', email: 'me@x.com' }, is_anonymous: false,
      });
    const client = { request: requestMock } as unknown as T2VClient;
    const auth = new T2VAuth(client);

    await auth.startAnonymous();
    const outcome = await auth.signup('me@x.com', 'supersecret');

    expect(outcome.confirmationRequired).toBe(false);
    expect(outcome.user?.id).toBe('real-1');
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

describe('Talk2View anonymous auto-start refused by the partner', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits anonymousUnavailable and sends nothing', async () => {
    vi.spyOn(storage, 'hasValidTokens').mockReturnValue(false);
    const t2v = new Talk2View({ partnerKey: 'pk_test_123' });
    vi.spyOn(t2v.auth, 'startAnonymous').mockRejectedValue(
      new T2VError("This app doesn't offer anonymous access.", 'anonymous_access_disabled', 403),
    );
    const createSession = vi.spyOn(t2v, 'createSession');
    const reasons: string[] = [];
    t2v.on('anonymousUnavailable', (reason) => { reasons.push(reason); });

    const events: ChatEvent[] = [];
    for await (const event of t2v.chat('hi')) events.push(event);

    expect(reasons).toEqual(['anonymous_access_disabled']);
    expect(events).toEqual([]);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('still sends when auto-start fails for another reason', async () => {
    vi.spyOn(storage, 'hasValidTokens').mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t2v = new Talk2View({ partnerKey: 'pk_test_123' });
    vi.spyOn(t2v.auth, 'startAnonymous').mockRejectedValue(new Error('network down'));
    const createSession = vi
      .spyOn(t2v, 'createSession')
      .mockRejectedValue(new Error('reached createSession'));
    const reasons: string[] = [];
    t2v.on('anonymousUnavailable', (reason) => { reasons.push(reason); });

    await expect(t2v.chat('hi').next()).rejects.toThrow('reached createSession');
    expect(createSession).toHaveBeenCalled();
    expect(reasons).toEqual([]);
  });

  it('retries instead of sticking on a transient anonymous_unavailable 503', async () => {
    // Minor #6: anonymous_unavailable is the claim RPC failing transiently —
    // it must not flip the SDK to the sign-in form for the rest of the session.
    vi.spyOn(storage, 'hasValidTokens').mockReturnValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t2v = new Talk2View({ partnerKey: 'pk_test_123' });
    vi.spyOn(t2v.auth, 'startAnonymous').mockRejectedValue(
      new T2VError('Anonymous sign-in is temporarily unavailable.', 'anonymous_unavailable', 503),
    );
    const createSession = vi
      .spyOn(t2v, 'createSession')
      .mockRejectedValue(new Error('reached createSession'));
    const reasons: string[] = [];
    t2v.on('anonymousUnavailable', (reason) => { reasons.push(reason); });

    await expect(t2v.chat('hi').next()).rejects.toThrow('reached createSession');
    expect(createSession).toHaveBeenCalled();
    expect(reasons).toEqual([]);
  });
});
