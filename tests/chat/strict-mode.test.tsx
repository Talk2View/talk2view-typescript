/**
 * The chat under React StrictMode — the default in Vite, CRA and Next.js, and
 * therefore what a partner's developer runs all day.
 *
 * StrictMode does two things that a client with a lifecycle has to survive. It
 * invokes the component body twice, so `useMemo` builds two `Talk2View`
 * instances per mount and React keeps one — the other is unreachable for ever.
 * And it runs every effect as setup → cleanup → setup, so a cleanup that
 * disposes of something must have a setup that brings it back.
 *
 * Get either wrong and nothing throws: the chat keeps working, and only
 * cross-tab sign-out and `clearAuth()` stop reaching it, in development builds
 * only. Hence the real React here — `createRoot` with `<StrictMode>`, not
 * testing-library's plain render, which double-invokes nothing.
 */
import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  })),
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
// `../../src/auth` is deliberately NOT mocked: its listeners are the subject.

import { Talk2View } from '../../src/index';
import { ChatProvider, useTalk2ViewChatClient } from '../../src/chat/provider';
import { ACCESS_TOKEN_STORAGE_KEY } from '../../src/storage';

const AUTH_EVENTS = ['talk2view_auth_cleared', 'storage'] as const;

/**
 * The `window` listeners for the two auth events that are actually live.
 *
 * Tracked by handler identity, not as a running total: a `removeEventListener`
 * for a handler that was never added is a no-op, so counting calls would report
 * zero while an orphan instance's listener was still attached — precisely the
 * leak this file is here to catch.
 */
function liveAuthListeners() {
  const live: Record<string, Set<unknown>> = {
    talk2view_auth_cleared: new Set(),
    storage: new Set(),
  };
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  const addSpy = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation(((type: string, handler: unknown, ...rest: unknown[]) => {
      live[type]?.add(handler);
      return (add as (...a: unknown[]) => void)(type, handler, ...rest);
    }) as typeof window.addEventListener);
  const removeSpy = vi
    .spyOn(window, 'removeEventListener')
    .mockImplementation(((type: string, handler: unknown, ...rest: unknown[]) => {
      live[type]?.delete(handler);
      return (remove as (...a: unknown[]) => void)(type, handler, ...rest);
    }) as typeof window.removeEventListener);
  return {
    count: (type: string) => live[type]!.size,
    stop: () => {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  window.matchMedia = (() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
});

/** Mount under StrictMode and hand back the client the chat settled on. */
async function mount(props: Record<string, unknown> = {}): Promise<Talk2View> {
  let client!: Talk2View;
  const Probe = () => {
    client = useTalk2ViewChatClient();
    return null;
  };
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StrictMode>
        <ChatProvider partnerKey="pk_test_x" anonymousAutoStart={false} {...props}>
          <Probe />
        </ChatProvider>
      </StrictMode>,
    );
  });
  return client;
}

describe('a chat that owns its client', () => {
  it('leaves exactly one set of auth listeners on window, not two', async () => {
    const listeners = liveAuthListeners();
    try {
      await mount();
      // Two clients were built; one is unreachable. It must hold nothing.
      for (const event of AUTH_EVENTS) expect(listeners.count(event)).toBe(1);
    } finally {
      listeners.stop();
    }
  });

  it('still hears `clearAuth()` after StrictMode has torn the effect down once', async () => {
    const client = await mount();
    const onAuth = vi.fn();
    client.auth.onAuthStateChange(onAuth);

    // What a 401 does in this tab.
    await act(async () => {
      window.dispatchEvent(new Event('talk2view_auth_cleared'));
    });
    expect(onAuth).toHaveBeenCalledWith(null);
  });

  it('still hears a sign-out in another tab', async () => {
    const client = await mount();
    const onAuth = vi.fn();
    client.auth.onAuthStateChange(onAuth);

    // What the browser fires in THIS tab when a sibling clears the token.
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: ACCESS_TOKEN_STORAGE_KEY, newValue: null }),
      );
    });
    expect(onAuth).toHaveBeenCalledWith(null);
  });

  it('takes its listeners off when the chat unmounts', async () => {
    const listeners = liveAuthListeners();
    try {
      await mount();
      await act(async () => {
        root.unmount();
      });
      for (const event of AUTH_EVENTS) expect(listeners.count(event)).toBe(0);
    } finally {
      listeners.stop();
    }
  });
});

describe('a client the integrator passed in', () => {
  it('is left listening, and is never destroyed by the chat', async () => {
    const theirs = new Talk2View({ partnerKey: 'pk_test_x', anonymousAutoStart: false });
    const destroy = vi.spyOn(theirs, 'destroy');

    const client = await mount({ client: theirs });
    expect(client).toBe(theirs);
    await act(async () => {
      root.unmount();
    });
    expect(destroy).not.toHaveBeenCalled();

    // …and it is still the working client it was before the chat borrowed it.
    const onAuth = vi.fn();
    theirs.auth.onAuthStateChange(onAuth);
    window.dispatchEvent(new Event('talk2view_auth_cleared'));
    expect(onAuth).toHaveBeenCalledWith(null);
    theirs.destroy();
  });
});
