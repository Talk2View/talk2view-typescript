import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { T2VClient } from '../../src/client';
import { NetworkError } from '../../src/errors';
import * as storage from '../../src/storage';
import type { T2VConfig } from '../../src/types';

function newClient(overrides: Partial<T2VConfig> = {}): T2VClient {
  return new T2VClient({ partnerKey: 'pk_test', baseUrl: 'https://api.test', ...overrides });
}

/**
 * A fetch that never resolves on its own — it only settles when its abort
 * signal fires, rejecting with the signal's reason (mirroring how the platform
 * aborts a real fetch). This lets fake timers drive the timeout deterministically.
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

describe('request timeouts', () => {
  beforeEach(() => {
    storage.setAccessToken('a');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Regression: a 5MB PDF attachment used to die at the 30s API timeout. Uploads
  // must get the wider 120s budget — and survive past 30s to prove it.
  it('uploads survive past 30s and abort at 120s, naming the real budget', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const client = newClient();

    const p = client.uploadRequest('/v1/attachments', new FormData());
    let settled = false;
    const captured = p.then(
      () => {
        settled = true;
        return null as unknown;
      },
      (e: unknown) => {
        settled = true;
        return e;
      },
    );

    // Past the old 30s budget — a normal API request would have aborted here.
    await vi.advanceTimersByTimeAsync(30_001);
    expect(settled).toBe(false);

    // At the 120s upload budget it aborts, and the error names the real timeout
    // (not the hardcoded 30s default).
    await vi.advanceTimersByTimeAsync(90_000);
    const err = await captured;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe('Request timed out after 120000ms');
  });

  // Guard: the upload bump must not have widened the default for normal requests.
  it('regular requests still abort at the 30s default', async () => {
    vi.stubGlobal('fetch', abortableFetch());
    const client = newClient();

    const p = client.request('/v1/thing');
    const captured = p.then(
      () => null as unknown,
      (e: unknown) => e,
    );

    await vi.advanceTimersByTimeAsync(30_001);
    const err = await captured;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toBe('Request timed out after 30000ms');
  });
});
