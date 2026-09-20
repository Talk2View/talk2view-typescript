/**
 * Tests for stop()/cancel of an in-flight response stream.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Talk2View } from '../../src/index';
import type { ChatEvent } from '../../src/types';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({ request: vi.fn(), streamRequest: vi.fn() })),
}));
vi.mock('../../src/auth', () => ({ T2VAuth: vi.fn().mockImplementation(() => ({ onAuthStateChange: vi.fn() })) }));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({ reRegister: vi.fn().mockResolvedValue(null) })),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({
  // A stub that answers the whole surface the client uses: createSession
  // re-registers the end-user's skills, so a bare {} breaks every test
  // that starts a session.
  T2VSkills: vi.fn().mockImplementation(() => ({
    getAll: () => [],
    load: () => [],
    add: () => {},
    remove: () => false,
    save: () => {},
    clear: () => {},
    register: async () => ({ registered: [], count: 0 }),
  })),
}));

const text = (content: string): ChatEvent => ({ type: 'text', content });

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('stop generation', () => {
  let t2v: Talk2View;

  beforeEach(() => {
    t2v = new Talk2View({ partnerKey: 'pk_test_123' });
  });

  it('halts the stream on stop(), keeps the partial response, and sets no error', async () => {
    // chat() yields two chunks then parks until the abort signal fires — modelling
    // a real stream whose underlying fetch is cancelled by stop().
    vi.spyOn(t2v, 'chat' as never).mockImplementation(((_msg: string, opts?: { signal?: AbortSignal }) => {
      const signal = opts?.signal;
      return (async function* () {
        yield text('Partial ');
        yield text('answer');
        await new Promise<void>((resolve) => {
          if (signal?.aborted) return resolve();
          signal?.addEventListener('abort', () => resolve());
        });
      })();
    }) as never);

    const p = t2v.sendMessage('hi');
    await flush(); // let the two chunks process; generator now parks on abort
    expect(t2v.isLoading).toBe(true);

    t2v.stop();
    await p;

    expect(t2v.isLoading).toBe(false);
    expect(t2v.error).toBeNull();
    const assistant = t2v.messages.find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('Partial answer');
    expect(assistant?.isStreaming).toBe(false);
  });

  it('stop() is a no-op when nothing is generating', () => {
    expect(() => t2v.stop()).not.toThrow();
    expect(t2v.isLoading).toBe(false);
    expect(t2v.error).toBeNull();
  });
});
