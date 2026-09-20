import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { T2VAuth } from '../src/auth';
import { T2VClient } from '../src/client';
import { T2VError } from '../src/errors';

type Step = 'pending' | 'ready' | 'gone';

const READY = { access_token: 'at', refresh_token: 'rt', user: { id: 'u1' } };

/**
 * Build a T2VAuth whose /exchange returns a scripted sequence:
 *   'pending' -> 202 body { status: 'pending' }
 *   'ready'   -> 200 body with access_token
 *   'gone'    -> throws T2VError(410)
 * The internal `sleep` is stubbed to resolve immediately (but still reject when
 * the signal is aborted) so the poll loop runs fast and deterministically.
 */
function makeAuth(seq: Step[]) {
  const client = new T2VClient({ partnerKey: 'pk_test_x', baseUrl: 'https://eng.example' });
  let call = 0;
  vi.spyOn(client, 'request').mockImplementation(async () => {
    const step = seq[Math.min(call++, seq.length - 1)];
    if (step === 'gone') throw new T2VError('gone', 'sdk_error', 410);
    if (step === 'ready') return READY as any;
    return { status: 'pending' } as any;
  });
  const auth = new T2VAuth(client);
  vi.spyOn(auth as any, 'sleep').mockImplementation((_ms: number, signal: AbortSignal) =>
    signal?.aborted
      ? Promise.reject(new Error('cancelled'))
      : Promise.resolve(),
  );
  return { auth, client };
}

describe('signInWithGoogle', () => {
  const realOpen = globalThis.open;
  let seed = 0;
  beforeEach(() => {
    seed = 0;
    // Distinct nonce per call so unique-window-name behaviour is observable.
    // stubGlobal uses defineProperty, so it works even though `crypto` is a
    // getter-only global in the test environment.
    vi.stubGlobal('crypto', {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i++) a[i] = (seed + i) & 0xff;
        seed += 1;
        return a;
      },
    });
  });
  afterEach(() => {
    globalThis.open = realOpen;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubPopup(closed = false) {
    const popup = { closed, close: vi.fn() };
    // @ts-expect-error test stub
    globalThis.open = vi.fn(() => popup);
    return popup;
  }

  it('opens a popup and resolves once /exchange is ready', async () => {
    stubPopup();
    const { auth } = makeAuth(['pending', 'ready']);
    const user = await auth.signInWithGoogle();
    expect(globalThis.open).toHaveBeenCalledOnce();
    expect(user.id).toBe('u1');
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('signInWithApple opens the Apple start URL and resolves the same way', async () => {
    stubPopup();
    const { auth } = makeAuth(['pending', 'ready']);
    const user = await auth.signInWithApple();
    const url = String((globalThis.open as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(url).toContain('/v1/auth/oauth/apple/start');
    expect(user.id).toBe('u1');
  });

  it('throws if the popup is blocked', async () => {
    // @ts-expect-error test stub
    globalThis.open = vi.fn(() => null);
    const { auth } = makeAuth(['ready']);
    await expect(auth.signInWithGoogle()).rejects.toThrow(/popup/i);
  });

  it('keeps polling through an early 410 (txn not created yet) and then succeeds', async () => {
    stubPopup();
    // First polls race ahead of /start creating the txn -> 410. Must NOT be fatal.
    const { auth } = makeAuth(['gone', 'gone', 'pending', 'ready']);
    const user = await auth.signInWithGoogle();
    expect(user.id).toBe('u1');
  });

  it('gives up after 90 seconds on a sign-in that never started, and says so', async () => {
    // The popup was refused (a blocked Referer, a strict partner) or closed on
    // the check screen: the engine never creates the transaction, so every poll
    // is a 410. That used to spin for the full three minutes and then claim a
    // timeout.
    stubPopup();
    const { auth } = makeAuth(['gone']);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 1_000));
    await expect(auth.signInWithGoogle()).rejects.toThrow(/didn’t start/i);
    expect(now - 1_000_000).toBeLessThan(120_000);
  });

  it('treats a 410 AFTER the txn was seen as expired (terminal)', async () => {
    stubPopup();
    const { auth } = makeAuth(['pending', 'gone']);
    await expect(auth.signInWithGoogle()).rejects.toThrow(/expired/i);
  });

  it('ignores popup.closed (COOP severs the handle) and still retrieves the token', async () => {
    stubPopup(true); // popup.closed reports true mid-flow due to COOP — must NOT abort
    const { auth } = makeAuth(['pending', 'ready']);
    const user = await auth.signInWithGoogle();
    expect(user.id).toBe('u1');
  });

  it('uses a unique popup window name per attempt', async () => {
    stubPopup();
    const { auth } = makeAuth(['ready']);
    await auth.signInWithGoogle();
    await auth.signInWithGoogle();
    const open = globalThis.open as unknown as ReturnType<typeof vi.fn>;
    const name1 = open.mock.calls[0][1] as string;
    const name2 = open.mock.calls[1][1] as string;
    expect(name1).toMatch(/^t2v-oauth-/);
    expect(name2).toMatch(/^t2v-oauth-/);
    expect(name1).not.toBe(name2);
  });

  it('cancels a previous in-flight attempt when a new one starts', async () => {
    stubPopup();
    // Enough pendings to keep attempt #1 alive; attempt #2 reaches ready.
    const { auth } = makeAuth(['pending', 'pending', 'pending', 'ready']);
    const p1 = auth.signInWithGoogle();
    const p2 = auth.signInWithGoogle();
    await expect(p1).rejects.toThrow(/cancel/i);
    await expect(p2).resolves.toMatchObject({ id: 'u1' });
  });
});
