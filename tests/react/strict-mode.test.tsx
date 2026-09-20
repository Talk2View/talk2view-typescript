/**
 * `T2VProvider` and `useTalk2ViewRuntime` under React StrictMode — the default
 * in Vite, CRA and Next.js, and therefore what a partner's developer runs all
 * day.
 *
 * Both own the client they build, and both dispose of it in an effect cleanup.
 * StrictMode invokes a component body twice, so `useMemo` builds two clients per
 * mount and React keeps one — the other is unreachable for ever and must hold
 * no `window` listeners. And it runs every effect as setup → cleanup → setup,
 * so a cleanup that disposes of something needs a setup that brings it back.
 *
 * Get either wrong and nothing throws: the app keeps working, and only
 * cross-tab sign-out and `clearAuth()` stop reaching it, in development builds
 * only — which makes it the worst kind of bug to chase. Hence real React here:
 * `createRoot` with `<StrictMode>`, not testing-library's plain render, which
 * double-invokes nothing.
 */
import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { T2VProvider, useT2V } from '../../src/react/T2VProvider';
import { useTalk2ViewRuntime } from '../../src/assistant-ui/index';
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
});

/** Mount a tree under StrictMode and hand back the client it settled on. */
async function mount(render: (report: (c: Talk2View) => void) => React.ReactElement): Promise<Talk2View> {
  let client!: Talk2View;
  root = createRoot(container);
  await act(async () => {
    root.render(<StrictMode>{render((c) => (client = c))}</StrictMode>);
  });
  return client;
}

function mountProvider(): Promise<Talk2View> {
  const Probe = ({ report }: { report: (c: Talk2View) => void }) => {
    report(useT2V().t2v);
    return null;
  };
  return mount((report) => (
    <T2VProvider partnerKey="pk_test_x" anonymousAutoStart={false}>
      <Probe report={report} />
    </T2VProvider>
  ));
}

describe('T2VProvider under StrictMode', () => {
  it('leaves exactly one set of auth listeners on window, not two', async () => {
    const listeners = liveAuthListeners();
    try {
      await mountProvider();
      // Two clients were built; the one React discarded must hold nothing.
      for (const event of AUTH_EVENTS) expect(listeners.count(event)).toBe(1);
    } finally {
      listeners.stop();
    }
  });

  it('still hears `clearAuth()` after StrictMode has torn the effect down once', async () => {
    const client = await mountProvider();
    const onAuth = vi.fn();
    client.auth.onAuthStateChange(onAuth);

    // What a 401 does in this tab.
    await act(async () => {
      window.dispatchEvent(new Event('talk2view_auth_cleared'));
    });
    expect(onAuth).toHaveBeenCalledWith(null);
  });

  it('still hears a sign-out in another tab', async () => {
    const client = await mountProvider();
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

  it('takes its listeners off when the provider unmounts', async () => {
    const listeners = liveAuthListeners();
    try {
      await mountProvider();
      await act(async () => {
        root.unmount();
      });
      for (const event of AUTH_EVENTS) expect(listeners.count(event)).toBe(0);
    } finally {
      listeners.stop();
    }
  });
});

describe('useTalk2ViewRuntime under StrictMode', () => {
  function mountRuntime(): Promise<Talk2View> {
    const Probe = ({ report }: { report: (c: Talk2View) => void }) => {
      useTalk2ViewRuntime({ partnerKey: 'pk_test_x', anonymousAutoStart: false });
      // The hook builds the client itself and does not hand it back, so reach it
      // the only way a test can: through the listeners it leaves on `window`.
      report(undefined as unknown as Talk2View);
      return null;
    };
    return mount((report) => <Probe report={report} />);
  }

  it('leaves exactly one set of auth listeners on window, not two', async () => {
    const listeners = liveAuthListeners();
    try {
      await mountRuntime();
      for (const event of AUTH_EVENTS) expect(listeners.count(event)).toBe(1);
    } finally {
      listeners.stop();
    }
  });

  it('takes its listeners off when the component unmounts', async () => {
    const listeners = liveAuthListeners();
    try {
      await mountRuntime();
      await act(async () => {
        root.unmount();
      });
      for (const event of AUTH_EVENTS) expect(listeners.count(event)).toBe(0);
    } finally {
      listeners.stop();
    }
  });
});
