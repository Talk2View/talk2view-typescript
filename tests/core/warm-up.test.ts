/**
 * A new end-user's first AI call used to pay 2-5 s for the engine to mint their
 * virtual key. warmUp() asks the engine to mint it early — at the first
 * keystroke or mic tap — so it overlaps the typing instead of following it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VError } from '../../src/errors';

const request = vi.fn();
const startAnonymous = vi.fn();
let authListener: (user: { id: string } | null) => void = () => {};

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({ request, streamRequest: vi.fn(), uploadRequest: vi.fn() })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn((cb) => { authListener = cb; }),
    getUser: vi.fn().mockReturnValue(null),
    startAnonymous,
  })),
}));

import { Talk2View } from '../../src/index';

beforeEach(() => {
  localStorage.clear();
  request.mockReset().mockResolvedValue({ ready: true });
  startAnonymous.mockReset().mockResolvedValue(undefined);
});

describe('Talk2View.warmUp', () => {
  it('starts the session, then asks the engine to warm the key', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    const order: string[] = [];
    startAnonymous.mockImplementation(async () => { order.push('anonymous'); });
    request.mockImplementation(async (path: string) => { order.push(path); return { ready: true }; });

    await t2v.warmUp();

    expect(order).toEqual(['anonymous', '/v1/account/warm']);
    expect(request).toHaveBeenCalledWith('/v1/account/warm', { method: 'POST' });
  });

  it('asks once for a logged-out visitor, whose own anonymous sign-in is an identity change', async () => {
    // The real startAnonymous() notifies auth listeners. That is this client's
    // own doing, not a different end-user, and must not re-open the warm-up.
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    startAnonymous.mockImplementation(async () => {
      await Promise.resolve(); // the real one answers after a network round trip
      authListener({ id: 'anon-1' });
    });

    await Promise.all([t2v.warmUp(), t2v.warmUp()]);
    await t2v.warmUp();

    expect(startAnonymous).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks once, however many times it is called', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    await Promise.all([t2v.warmUp(), t2v.warmUp()]);
    await t2v.warmUp();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('asks again after the identity changes', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    await t2v.warmUp();
    authListener({ id: 'someone-else' });
    await t2v.warmUp();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never rejects — an older engine, a rate limit or a dead network is a no-op', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    request.mockRejectedValue(new T2VError('Not found', 'not_found', 404));
    await expect(t2v.warmUp()).resolves.toBeUndefined();
  });

  it('sends nothing when the partner refuses anonymous access', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test' });
    startAnonymous.mockRejectedValue(new T2VError('off', 'anonymous_access_disabled', 403));
    await expect(t2v.warmUp()).resolves.toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it('does nothing when auto-start is off and nobody is signed in', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', anonymousAutoStart: false });
    await t2v.warmUp();
    expect(startAnonymous).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});
