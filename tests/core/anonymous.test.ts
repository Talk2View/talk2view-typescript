import { describe, expect, it, vi } from 'vitest';
import { T2VAuth } from '../../src/auth';
import * as storage from '../../src/storage';
import type { T2VClient } from '../../src/client';
import type { TokenResponse } from '../../src/types';

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
});
