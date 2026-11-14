/**
 * The packaged chat's model choice: what it sends with each message, and the
 * Settings view that lets the end-user pick a model and its reasoning effort.
 *
 * The engine answers by path from per-test fixtures, so each test states the
 * catalogue (/v1/models) and the partner config (/v1/config) it runs against.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  models: [] as unknown[],
  config: {} as Record<string, unknown>,
  failModels: false,
}));

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(function () { return {
    request: vi.fn().mockImplementation(async (path: string) => {
      if (path === '/v1/models') {
        if (engine.failModels) throw new Error('models unavailable');
        return { object: 'list', data: engine.models };
      }
      if (path === '/v1/config') return engine.config;
      return { data: [] };
    }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  }; }),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(function () { return {
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    startAnonymous: vi.fn().mockResolvedValue(null),
    // listen()/destroy() are an inverse pair; the chat provider calls both.
    listen: vi.fn(),
    destroy: vi.fn(),
  }; }),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(function () { return {
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  }; }),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({
  // A stub that answers the whole surface the client uses: createSession
  // re-registers the end-user's skills, so a bare {} breaks every test
  // that starts a session.
  T2VSkills: vi.fn().mockImplementation(function () { return {
    getAll: () => [],
    load: () => [],
    add: () => {},
    remove: () => false,
    save: () => {},
    clear: () => {},
    register: async () => ({ registered: [], count: 0 }),
  }; }),
}));

import { Talk2View } from '../../src/index';
import { Talk2ViewChat } from '../../src/chat/chat';
import { getUserPreferences, setUserPreferences } from '../../src/storage';
import type { Model } from '../../src/types';

// ── jsdom lacks the layout APIs the primitives observe ──────────────────────
beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
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

// ── Catalogue fixtures ──────────────────────────────────────────────────────
const base = { object: 'model', created: 0, owned_by: 'gemini' };
const hydrogen: Model = { ...base, id: 'gemini-4-hydrogen', name: 'Google: Gemini 4 Hydrogen',
  reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'low', gated_reasoning_efforts: ['medium', 'high'] };
const hydrogenPrivate: Model = { ...hydrogen, id: 'gemini-4-hydrogen-private', gated_reasoning_efforts: [] };
const sol: Model = { ...base, id: 'gpt-6-sol', reasoning_efforts: null, default_reasoning_effort: null, gated_reasoning_efforts: null };
const oldEngineRow: Model = { ...base, id: 'gemini-4-hydrogen-thinking' }; // none of the three keys

beforeEach(() => {
  engine.models = [];
  engine.failModels = false;
  engine.config = { default_llm_model: null, default_stt_model: null, default_image_model: null, system_prompt: null };
  localStorage.clear();
});

afterEach(() => {
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
});

/** Everything stored in talk2view_preferences. */
const stored = (): Record<string, unknown> => JSON.parse(getUserPreferences() ?? '{}');

type Emitting = { emitter: { emit: (name: string, payload: unknown) => void } };

describe('the packaged chat sends the stored model choice', () => {
  let t2v: Talk2View;
  let sendMessage: ReturnType<typeof vi.spyOn>;

  async function sendSuggestion() {
    t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    sendMessage = vi.spyOn(t2v, 'sendMessage').mockResolvedValue(undefined);
    render(<Talk2ViewChat client={t2v} welcome={{ suggestions: ['A'] }} />);
    const suggestion = await screen.findByRole('button', { name: /^A$/ });
    await act(async () => {
      fireEvent.click(suggestion);
    });
    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
  }

  const lastOptions = () => sendMessage.mock.calls.at(-1)![1] as Record<string, unknown>;

  it('sends a stored base model with its stored effort', async () => {
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' }));
    await sendSuggestion();
    expect(lastOptions()).toMatchObject({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  });

  it('sends a stored old id unchanged, with no effort', async () => {
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen-thinking-high' }));
    await sendSuggestion();
    expect(lastOptions().model).toBe('gemini-4-hydrogen-thinking-high');
    expect('reasoningEffort' in lastOptions()).toBe(false);
  });

  it('sends neither when no model is stored, even if an effort is', async () => {
    setUserPreferences(JSON.stringify({ reasoningEffort: 'high' }));
    await sendSuggestion();
    expect('model' in lastOptions()).toBe(false);
    expect('reasoningEffort' in lastOptions()).toBe(false);
  });

  it('clears the stored effort when the engine refuses it', async () => {
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen', reasoningEffort: 'high', sttLanguage: 'vi' }));
    await sendSuggestion();
    act(() => {
      (t2v as unknown as Emitting).emitter.emit(
        'reasoningEffortUnsupported', { model: 'gemini-4-hydrogen', reasoningEffort: 'high', supported: ['low'] });
    });
    await waitFor(() => expect(stored()).toEqual({ model: 'gemini-4-hydrogen', sttLanguage: 'vi' }));
  });

  it('moves a stored old id to its base model when its effort is gated, and ignores a gated model', async () => {
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen-thinking-high' }));
    await sendSuggestion();
    act(() => {
      (t2v as unknown as Emitting).emitter.emit('modelGated', { model: 'gemini-4-hydrogen', reasoningEffort: null });
    });
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen-thinking-high' });
    act(() => {
      (t2v as unknown as Emitting).emitter.emit('modelGated', { model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
    });
    await waitFor(() => expect(stored()).toEqual({ model: 'gemini-4-hydrogen' }));
  });
});
