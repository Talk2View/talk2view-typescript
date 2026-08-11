import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import { NetworkError } from '../../src/errors';
import * as storage from '../../src/storage';
import type { T2VConfig } from '../../src/types';

function newClient(overrides: Partial<T2VConfig> = {}): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test', ...overrides });
}

/**
 * A fetch that never resolves on its own — it settles only when its abort
 * signal fires, rejecting with the signal's reason (mirroring real fetch). Lets
 * fake timers drive the connect timeout deterministically.
 */
function abortableFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        signal.addEventListener('abort', () =>
          reject(signal.reason ?? new DOMException('aborted', 'AbortError')),
        );
      }),
  );
}

describe('streamRequest connect timeout (regression: opaque abort message)', () => {
  beforeEach(() => {
    storage.setAccessToken('a');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // streamRequest builds its OWN AbortController (separate from makeTimeoutSignal),
  // so its timeout must abort with a TimeoutError reason. Otherwise a connect
  // timeout surfaced the platform's opaque "The operation was aborted." string.
  it('surfaces a helpful timeout message, not "The operation was aborted."', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const client = newClient();

    const gen = client.streamRequest('/v1/chat/completions', { messages: [] });
    const captured = gen.next().then(
      () => null as unknown,
      (e: unknown) => e,
    );

    await vi.advanceTimersByTimeAsync(30_001);
    const err = await captured;

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe('Request timed out after 30000ms');
    expect((err as Error).message).not.toBe('The operation was aborted.');
  });

  // A bare external abort (user pressed "stop" before the stream started) must
  // still yield a sensible NetworkError, never the opaque platform string.
  it('an external abort during connect still yields a sensible message', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const client = newClient();

    const external = new AbortController();
    const gen = client.streamRequest('/v1/chat/completions', { messages: [] }, external.signal);
    const captured = gen.next().then(
      () => null as unknown,
      (e: unknown) => e,
    );

    external.abort();
    await vi.advanceTimersByTimeAsync(0);
    const err = await captured;

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).not.toBe('The operation was aborted.');
  });
});
