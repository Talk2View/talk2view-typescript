import { describe, expect, it, vi } from 'vitest';
import { Talk2View } from '../../src/index';

// Mock the modules that Talk2View's constructor depends on
vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
  })),
}));

function createT2V(): Talk2View {
  return new Talk2View({ partnerKey: 'pk_test_123', baseUrl: 'http://localhost' });
}

describe('Talk2View.onSessionClear', () => {
  it('calls listener when clearSession is invoked', () => {
    const t2v = createT2V();
    const listener = vi.fn();

    t2v.onSessionClear(listener);
    t2v.clearSession();

    expect(listener).toHaveBeenCalledOnce();
  });

  it('calls listener even when there is no active session', () => {
    const t2v = createT2V();
    const listener = vi.fn();

    t2v.onSessionClear(listener);
    // No session was created, but clearSession should still notify
    t2v.clearSession();

    expect(listener).toHaveBeenCalledOnce();
  });

  it('calls multiple listeners', () => {
    const t2v = createT2V();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    t2v.onSessionClear(listener1);
    t2v.onSessionClear(listener2);
    t2v.clearSession();

    expect(listener1).toHaveBeenCalledOnce();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it('returns an unsubscribe function that removes the listener', () => {
    const t2v = createT2V();
    const listener = vi.fn();

    const unsubscribe = t2v.onSessionClear(listener);
    unsubscribe();
    t2v.clearSession();

    expect(listener).not.toHaveBeenCalled();
  });

  it('only removes the unsubscribed listener, others still fire', () => {
    const t2v = createT2V();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = t2v.onSessionClear(listener1);
    t2v.onSessionClear(listener2);

    unsub1();
    t2v.clearSession();

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledOnce();
  });

  it('fires on every clearSession call', () => {
    const t2v = createT2V();
    const listener = vi.fn();

    t2v.onSessionClear(listener);
    t2v.clearSession();
    t2v.clearSession();
    t2v.clearSession();

    expect(listener).toHaveBeenCalledTimes(3);
  });
});
