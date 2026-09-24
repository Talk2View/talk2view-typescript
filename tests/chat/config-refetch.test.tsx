/**
 * The chat's partner-config request, for a visitor with no session.
 *
 * `/v1/config` needs a session, so a brand-new visitor's request 401s. The
 * client answers a 401 it cannot refresh by clearing auth, and clearing auth
 * announces a `null` user to every auth listener. A provider that asked for the
 * config again on EVERY auth change turned that into a loop: request, 401,
 * clear, `null`, request… — for every sessionless visitor of every packaged
 * chat. Hence the real client and the real `T2VAuth` here, with only `fetch`
 * scripted: the loop lives in how those two talk to each other.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  })),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({
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
// `../../src/client` and `../../src/auth` are deliberately NOT mocked.

import { ChatProvider } from '../../src/chat/provider';

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

let container: HTMLDivElement;
let root: Root | null = null;
let configRequests = 0;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  configRequests = 0;
  // Every request 401s, as the engine answers a visitor with no session.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/v1/config')) {
        configRequests += 1;
        // A loop, if there is one, stops here and fails the assertion below,
        // rather than running the test worker out of memory.
        if (configRequests > 10) return new Promise<Response>(() => {});
      }
      return new Response(
        JSON.stringify({ error: { type: 'authentication_error', message: 'Not authenticated' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      );
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

describe('the partner config, for a visitor with no session', () => {
  it('is asked for once, not again every time the 401 clears auth', async () => {
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <ChatProvider partnerKey="pk_test_x" anonymousAutoStart={false}>
          <div />
        </ChatProvider>,
      );
    });
    // Long enough for a loop to have gone round many times (the reviewer's
    // reproduction made 26 requests in 300 ms).
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(configRequests).toBeGreaterThanOrEqual(1);
    expect(configRequests).toBeLessThanOrEqual(2);
  });
});
