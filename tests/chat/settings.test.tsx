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

describe('Settings — reasoning effort', () => {
  /** Opens the chat's Settings view; by default waits for the model list to load. */
  async function openSettings({ waitForModels = true } = {}) {
    render(<Talk2ViewChat partnerKey="pk_test_x" />);
    const settings = await screen.findByRole('button', { name: 'Settings' });
    await act(async () => {
      fireEvent.click(settings);
    });
    if (waitForModels) await waitFor(() => expect(modelSelect().disabled).toBe(false));
  }
  const modelSelect = () => screen.getByLabelText('AI model') as HTMLSelectElement;
  const effortSelect = () => screen.queryByLabelText('Thinking level') as HTMLSelectElement | null;

  it('shows no effort control when the engine sends no efforts', async () => {
    engine.models = [oldEngineRow, { ...oldEngineRow, id: 'gemini-4-hydrogen' }];
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen-thinking' }));
    await openSettings();
    expect(modelSelect().value).toBe('gemini-4-hydrogen-thinking');
    expect(effortSelect()).toBeNull();
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen-thinking' });
  });

  it('shows no effort control for Default or for a model without efforts', async () => {
    engine.models = [hydrogen, sol];
    await openSettings();
    expect(effortSelect()).toBeNull(); // Default
    fireEvent.change(modelSelect(), { target: { value: 'gpt-6-sol' } });
    expect(effortSelect()).toBeNull();
  });

  it('offers the model\'s efforts with its default selected, and stores a pick as (base id, effort)', async () => {
    engine.models = [hydrogen, sol];
    await openSettings();
    fireEvent.change(modelSelect(), { target: { value: 'gemini-4-hydrogen' } });
    const effort = effortSelect()!;
    expect(Array.from(effort.options).map((o) => [o.value, o.textContent])).toEqual([
      ['low', 'Low'], ['medium', 'Medium (paid plan)'], ['high', 'High (paid plan)'],
    ]);
    expect(effort.value).toBe('low');
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen' });
    fireEvent.change(effort, { target: { value: 'high' } });
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
    expect(screen.getByText('High needs a paid plan.')).toBeTruthy();
  });

  it('keeps gated efforts selectable', async () => {
    engine.models = [hydrogen];
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen' }));
    await openSettings();
    expect(Array.from(effortSelect()!.options).every((o) => !o.disabled)).toBe(true);
  });

  it('shows a stored old id as its base row and effort without rewriting it', async () => {
    engine.models = [hydrogen, hydrogenPrivate];
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen-thinking-high' }));
    await openSettings();
    expect(modelSelect().value).toBe('gemini-4-hydrogen');
    expect(effortSelect()!.value).toBe('high');
    expect(screen.queryByText(/no longer offered/)).toBeNull();
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen-thinking-high' });
    fireEvent.change(effortSelect()!, { target: { value: 'medium' } });
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: 'medium' });
  });

  it('still marks an id the catalogue cannot place as no longer offered', async () => {
    engine.models = [hydrogen];
    setUserPreferences(JSON.stringify({ model: 'retired-model' }));
    await openSettings();
    expect(screen.getByText('retired-model (no longer offered)')).toBeTruthy();
    expect(effortSelect()).toBeNull();
  });

  it('clears the stored effort when the model changes', async () => {
    engine.models = [hydrogen, sol];
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen', reasoningEffort: 'high', sttLanguage: 'vi' }));
    await openSettings();
    fireEvent.change(modelSelect(), { target: { value: 'gpt-6-sol' } });
    expect(stored()).toEqual({ model: 'gpt-6-sol', sttLanguage: 'vi' });
  });

  it('clears a stored effort the partner no longer allows', async () => {
    engine.models = [{ ...hydrogen, reasoning_efforts: ['low'], gated_reasoning_efforts: [] }];
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' }));
    await openSettings();
    await waitFor(() => expect(stored()).toEqual({ model: 'gemini-4-hydrogen' }));
    expect(effortSelect()!.value).toBe('low');
  });

  it('offers and stores an effort it has no label for', async () => {
    engine.models = [{ ...hydrogen, reasoning_efforts: ['low', 'xhigh'], gated_reasoning_efforts: [] }];
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen' }));
    await openSettings();
    expect(Array.from(effortSelect()!.options).map((o) => o.textContent)).toEqual(['Low', 'Xhigh']);
    fireEvent.change(effortSelect()!, { target: { value: 'xhigh' } });
    expect(stored().reasoningEffort).toBe('xhigh');
  });

  it('names the partner default with its effort', async () => {
    engine.models = [hydrogen];
    engine.config = {
      ...engine.config,
      default_llm_model: 'gemini-4-hydrogen-thinking',
      default_llm_base_model: 'gemini-4-hydrogen',
      default_llm_reasoning_effort: 'medium',
    };
    await openSettings();
    await waitFor(() => expect(modelSelect().options[0]!.textContent).toBe('Default — Google: Gemini 4 Hydrogen (Medium)'));
  });

  it('names the partner default as before when /v1/config has no base model', async () => {
    engine.models = [sol];
    engine.config = { ...engine.config, default_llm_model: 'gpt-6-sol' };
    await openSettings();
    await waitFor(() => expect(modelSelect().options[0]!.textContent).toBe('Default — gpt-6-sol'));
  });

  it('leaves stored preferences alone when the model list fails to load', async () => {
    engine.failModels = true;
    setUserPreferences(JSON.stringify({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' }));
    await openSettings({ waitForModels: false });
    await screen.findByText('Couldn’t load the list — the default will be used.');
    expect(effortSelect()).toBeNull();
    expect(stored()).toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  });
});
