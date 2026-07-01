import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { T2VAuth } from '../src/auth';
import { T2VClient } from '../src/client';

function makeAuth(exchangeResults: Array<{ status: number; body: any }>) {
  const client = new T2VClient({ partnerKey: 'pk', baseUrl: 'https://eng.example' });
  let call = 0;
  vi.spyOn(client, 'request').mockImplementation(async () => {
    const r = exchangeResults[Math.min(call++, exchangeResults.length - 1)];
    return r.body; // request() resolves 2xx bodies; pending body lacks access_token
  });
  return { auth: new T2VAuth(client), client };
}

describe('signInWithGoogle', () => {
  const realOpen = globalThis.open;
  beforeEach(() => {
    if (!globalThis.crypto) {
      // @ts-expect-error test stub
      globalThis.crypto = { getRandomValues: (a: Uint8Array) => a.fill(7) };
    }
  });
  afterEach(() => { globalThis.open = realOpen; vi.restoreAllMocks(); });

  it('opens a popup and resolves once /exchange is ready', async () => {
    const popup = { closed: false, close: vi.fn() };
    // @ts-expect-error test stub
    globalThis.open = vi.fn(() => popup);
    const { auth } = makeAuth([
      { status: 202, body: { status: 'pending' } },
      { status: 200, body: { access_token: 'at', refresh_token: 'rt', user: { id: 'u1' } } },
    ]);
    const user = await auth.signInWithGoogle();
    expect(globalThis.open).toHaveBeenCalledOnce();
    expect(user.id).toBe('u1');
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('throws if the popup is blocked', async () => {
    // @ts-expect-error test stub
    globalThis.open = vi.fn(() => null);
    const { auth } = makeAuth([{ status: 200, body: {} }]);
    await expect(auth.signInWithGoogle()).rejects.toThrow(/popup/i);
  });
});
