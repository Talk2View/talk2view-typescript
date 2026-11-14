import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SettingsPanel } from '../../src/ui/components/SettingsPanel';
import type { Model, PartnerConfig, UserPreferences } from '../../src/types';

function model(id: string, ownedBy: string): Model {
  return { id, object: 'model', created: 0, owned_by: ownedBy };
}

// Sample list spanning providers, including a direct anthropic model AND the
// same model proxied through OpenRouter — the case the change exists to fix.
const MODELS: Model[] = [
  model('gpt-5.5', 'openai'),
  model('anthropic/claude-opus-4-7', 'anthropic'),
  model('openrouter/anthropic/claude-opus-4-7', 'openrouter'),
  model('gemini-2.5-pro', 'gemini'),
];

const updatePreferences = vi.fn();

// What the mocked hooks answer; each test starts from these values.
let MODELS_NOW: Model[];
let PREFS: Partial<UserPreferences>;
let PARTNER: Partial<PartnerConfig>;

beforeEach(() => {
  MODELS_NOW = MODELS;
  PREFS = { model: 'anthropic/claude-opus-4-7' };
  PARTNER = { default_llm_model: '', default_stt_model: '' };
  updatePreferences.mockClear();
});

vi.mock('../../src/ui/context', () => ({
  useTalk2View: () => ({
    t2v: {
      config: { model: '' },
      listModels: () => Promise.resolve({ object: 'list', data: MODELS_NOW }),
      listAudioModels: () => Promise.resolve({ object: 'list', data: [] }),
    },
  }),
}));

vi.mock('../../src/react/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: PREFS,
    updatePreferences,
  }),
}));

vi.mock('../../src/react/usePartnerConfig', () => ({
  usePartnerConfig: () => ({ config: PARTNER }),
}));

async function renderModelSelect(): Promise<HTMLSelectElement> {
  const { container } = render(React.createElement(SettingsPanel, { hideHeader: true }));
  // The model picker is the only grouped <select>; it appears once the async
  // listModels effect resolves.
  await waitFor(() => {
    if (!container.querySelector('optgroup')) throw new Error('not yet');
  });
  return container.querySelector('optgroup')!.closest('select') as HTMLSelectElement;
}

/** The <select> in the section labelled Thinking Level, in the same panel as `select`. */
function effortSelectIn(select: HTMLSelectElement): HTMLSelectElement {
  const panel = select.closest('div')!.parentElement!;
  const heading = Array.from(panel.querySelectorAll('div')).find((d) => d.textContent === 'Thinking Level');
  if (!heading) throw new Error('no Thinking Level section');
  return heading.parentElement!.querySelector('select') as HTMLSelectElement;
}

describe('SettingsPanel model picker', () => {
  it('groups LLM models into provider <optgroup> sections', async () => {
    const select = await renderModelSelect();
    const labels = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(labels).toEqual(['OpenAI', 'Anthropic', 'OpenRouter', 'Google']);
  });

  it('shows model ids verbatim — does NOT strip openrouter/', async () => {
    const select = await renderModelSelect();
    const optionTexts = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);

    expect(optionTexts).toContain('openrouter/anthropic/claude-opus-4-7');
    expect(optionTexts).toContain('anthropic/claude-opus-4-7');
    // the proxied id must NOT collapse to the bare direct id
    expect(optionTexts.filter((t) => t === 'anthropic/claude-opus-4-7')).toHaveLength(1);
  });

  it('keeps the full id as the option value and reflects the current selection', async () => {
    const select = await renderModelSelect();
    const orGroup = Array.from(select.querySelectorAll('optgroup')).find(
      (g) => g.label === 'OpenRouter',
    )!;
    const values = Array.from(orGroup.querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['openrouter/anthropic/claude-opus-4-7']);
    expect(select.value).toBe('anthropic/claude-opus-4-7');
  });
});

describe('SettingsPanel reasoning effort', () => {
  it('shows the partner default pair from /v1/config and an effort select for it', async () => {
    MODELS_NOW = [{
      ...model('gemini-4-hydrogen', 'gemini'),
      reasoning_efforts: ['low', 'medium', 'high'],
      default_reasoning_effort: 'low',
      gated_reasoning_efforts: ['high'],
    }];
    PREFS = {};
    PARTNER = {
      default_llm_model: 'gemini-4-hydrogen-thinking',
      default_llm_base_model: 'gemini-4-hydrogen',
      default_llm_reasoning_effort: 'medium',
      default_stt_model: '',
    };
    const select = await renderModelSelect();
    expect(select.value).toBe('gemini-4-hydrogen');
    const effort = effortSelectIn(select);
    expect(Array.from(effort.options).map((o) => o.textContent)).toEqual(['Low', 'Medium', 'High (paid plan)']);
    expect(effort.value).toBe('medium');
    fireEvent.change(effort, { target: { value: 'low' } });
    expect(updatePreferences).toHaveBeenLastCalledWith({ model: 'gemini-4-hydrogen', reasoningEffort: 'low' });
  });

  it('has no effort select when the model lists none, and clears the effort on a model change', async () => {
    PREFS = { model: 'anthropic/claude-opus-4-7' };
    const select = await renderModelSelect();
    expect(document.body.textContent).not.toContain('Thinking Level');
    fireEvent.change(select, { target: { value: 'gpt-5.5' } });
    expect(updatePreferences).toHaveBeenLastCalledWith({ model: 'gpt-5.5', reasoningEffort: undefined });
  });
});
