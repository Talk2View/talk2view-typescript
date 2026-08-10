import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Talk2View } from '../../src/index';

// Capture the auth-state callback the Talk2View core registers, so tests can
// drive identity changes (anonymous start, login, convert, logout) directly.
const h = vi.hoisted(() => ({ cb: null as null | ((user: unknown) => void) }));

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ session_id: 'S1', thread_id: 'T1', model: 'm' }),
  })),
}));

vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn((fn: (user: unknown) => void) => {
      h.cb = fn;
      return () => {};
    }),
    getUser: vi.fn().mockReturnValue(null),
    isAnonymous: vi.fn().mockReturnValue(false),
  })),
}));

vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    reRegister: vi.fn().mockResolvedValue(null),
  })),
}));

function createT2V(): Talk2View {
  return new Talk2View({ partnerKey: 'pk_test', baseUrl: 'http://localhost' });
}

describe('session reset on identity change', () => {
  beforeEach(() => {
    h.cb = null;
  });

  it('clears the cached session when the signed-in user id changes (anonymous -> login)', async () => {
    const t2v = createT2V();
    h.cb!({ id: 'anon-1', email: '' }); // anonymous session starts
    await t2v.createSession(); // currentSession = S1, owned by anon-1

    const cleared = vi.fn();
    t2v.onSessionClear(cleared);

    h.cb!({ id: 'real-1', email: 'e@x.com' }); // logs into a different account

    // The orphaned anonymous session must be dropped so the next chat() opens a
    // fresh one owned by real-1 — otherwise the server 404s "Session not found".
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(t2v.threadId).toBeNull();
  });

  it('keeps the session when the same user id re-authenticates (convert preserves the id)', async () => {
    const t2v = createT2V();
    h.cb!({ id: 'anon-1', email: '' });
    await t2v.createSession();

    const cleared = vi.fn();
    t2v.onSessionClear(cleared);

    h.cb!({ id: 'anon-1', email: 'e@x.com' }); // anonymous -> permanent convert keeps the id

    expect(cleared).not.toHaveBeenCalled();
  });

  it('clears the session on logout (id -> null)', async () => {
    const t2v = createT2V();
    h.cb!({ id: 'anon-1', email: '' });
    await t2v.createSession();

    const cleared = vi.fn();
    t2v.onSessionClear(cleared);

    h.cb!(null); // logout

    expect(cleared).toHaveBeenCalledTimes(1);
  });

  it('does not fire session-clear on an identity change when no session exists', () => {
    const t2v = createT2V();
    h.cb!({ id: 'anon-1', email: '' });

    const cleared = vi.fn();
    t2v.onSessionClear(cleared);

    h.cb!({ id: 'real-1', email: 'e@x.com' }); // identity changed, but no session to drop

    expect(cleared).not.toHaveBeenCalled();
  });
});
