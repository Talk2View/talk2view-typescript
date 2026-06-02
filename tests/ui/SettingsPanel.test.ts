import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { SettingsPanel } from '../../src/ui/components/SettingsPanel';
import type { Model } from '../../src/types';

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

vi.mock('../../src/ui/context', () => ({
  useTalk2View: () => ({
    t2v: {
      config: { model: '' },
      listModels: () => Promise.resolve({ object: 'list', data: MODELS }),
      listAudioModels: () => Promise.resolve({ object: 'list', data: [] }),
    },
  }),
}));

vi.mock('../../src/react/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: { model: 'anthropic/claude-opus-4-7' },
    updatePreferences,
  }),
}));

vi.mock('../../src/react/usePartnerConfig', () => ({
  usePartnerConfig: () => ({ config: { default_llm_model: '', default_stt_model: '' } }),
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
